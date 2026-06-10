# Archive Duration & startedAt Sync Fix

**Date:** 2026-06-10
**Status:** Approved

## Overview

Weekly archive lines are missing the task duration suffix (e.g. `(47分钟)`) for events where `startedAt` was recorded. Root-cause investigation found three related issues, all stemming from `startedAt` not being treated with the same care as `completed`/`completedAt` throughout the data lifecycle. This spec addresses all three.

## Background / Root Causes

1. **`normalizeDailyEvents` strips `startedAt` (lib/store.js:135-143)** — the per-event mapping in `normalizeDailyEvents`, run on every plugin load via `loadSettings()` → `normalizeSettings()`, copies `completedAt` but has no `startedAt` key at all. Every plugin reload (Obsidian restart, plugin update, dev hot-reload) silently drops `startedAt` from in-memory `dailyEvents`, and the next `ctx.save()` persists that loss to `data.json`. This is the most likely deterministic cause of the missing duration.

2. **Archive reads only `dailyEvents`, not file frontmatter (lib/sections/calendar.js:699)** — `archiveWeek` calls `formatDuration(event.startedAt, event.completedAt)` using values from `settings.data.dailyEvents` (the local plugin cache), even though the associated `.md` file's frontmatter is the more durable record (per the original timer-behavior design intent: archive duration should be derived from the note's recorded timestamps).

3. **No file → dashboard sync for `startedAt` (lib/note-manager.js:223-262)** — `handleEventMetadataChanged` syncs `completed`/`completedAt` from file frontmatter back into `dailyEvents`, but never reads `fm.startedAt`. If the file's `startedAt` is the correct value and `dailyEvents`'s copy is stale/missing, the ▶ button UI state never self-heals.

## Architecture

### Fix 0 — `lib/store.js`, `normalizeDailyEvents` (~line 142)

Add `startedAt` to the per-event object literal, mirroring `completedAt`:

```js
.map((event, idx) => ({
  id: ...,
  title: ...,
  completed: !!event?.completed,
  order: ...,
  filePath: ...,
  createdAt: ...,
  completedAt: typeof event?.completedAt === "string" ? event.completedAt : null,
  startedAt: typeof event?.startedAt === "string" ? event.startedAt : null
}))
```

### Shared helpers — `lib/note-manager.js`

Add two new exported functions, placed near the existing `formatLocalDateTime`:

```js
function coerceFrontmatterDate(value) {
  if (typeof value === "string") return value;
  if (value instanceof Date) return formatLocalDateTime(value);
  return null;
}

function getEventFrontmatter(app, filePath) {
  if (!filePath) return null;
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return null;
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm) return null;
  return {
    completed: typeof fm.completed === "boolean" ? fm.completed : undefined,
    completedAt: coerceFrontmatterDate(fm.completedAt),
    startedAt: coerceFrontmatterDate(fm.startedAt)
  };
}
```

`coerceFrontmatterDate` handles the case where Obsidian's YAML parser returns a `Date` instance for an unquoted `YYYY-MM-DD HH:mm:ss` timestamp instead of a string, normalizing it to the same string format used elsewhere (`formatLocalDateTime`).

`getEventFrontmatter` returns `null` when there's no associated file, the file doesn't exist, or it has no frontmatter — callers treat `null` as "no override, use dailyEvents values".

Both functions are added to `module.exports`.

### Fix 1 — `lib/sections/calendar.js`, `archiveWeek` (~lines 682-706)

New pure helper, exported for testing:

```js
function resolveArchivedEventFields(event, frontmatter) {
  const fm = frontmatter || {};
  return {
    completed: fm.completed !== undefined ? fm.completed : event.completed,
    completedAt: fm.completedAt != null ? fm.completedAt : event.completedAt,
    startedAt: fm.startedAt != null ? fm.startedAt : event.startedAt
  };
}
```

File frontmatter wins per-field when present and non-null; `dailyEvents` (`event`) is the fallback for missing fields and for events with no associated file.

In the `events.map(async (event) => {...})` block inside `archiveWeek`:

```js
const enriched = await Promise.all(events.map(async (event) => {
  const hasNotes = event.filePath
    ? await noteManager.hasExtraContent(ctx.app, event.filePath)
    : false;
  const frontmatter = event.filePath
    ? noteManager.getEventFrontmatter(ctx.app, event.filePath)
    : null;
  const resolved = resolveArchivedEventFields(event, frontmatter);
  return { event, dateKey, hasNotes, resolved };
}));
```

And in the line-rendering step (currently lines 696-705), replace `event.completed` / `event.startedAt` / `event.completedAt` with `resolved.completed` / `resolved.startedAt` / `resolved.completedAt`. `formatDuration` itself is unchanged.

### Fix 2 — `lib/note-manager.js`, `handleEventMetadataChanged` (lines 223-262)

Restructure so the function doesn't bail out early just because `completed` is unchanged — it now independently tracks two possible changes and syncs whichever applies:

```js
async function handleEventMetadataChanged(plugin, file) {
  if (!(file instanceof TFile)) return;
  const filePath = file.path;
  if (!isYoriEventFile(filePath)) return;
  if (_consumePendingWrite(filePath)) return;

  const cache = plugin.app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter;
  if (!fm) return;

  const dailyEvents = plugin.settings.data.dailyEvents || {};
  let matchedEvent = null;
  for (const dateKey of Object.keys(dailyEvents)) {
    const list = dailyEvents[dateKey];
    if (!Array.isArray(list)) continue;
    const found = list.find((e) => e.filePath === filePath);
    if (found) { matchedEvent = found; break; }
  }
  if (!matchedEvent) return;

  const fileCompleted = !!fm.completed;
  const completedChanged = fileCompleted !== matchedEvent.completed;

  const fileStartedAt = coerceFrontmatterDate(fm.startedAt);
  const startedAtChanged = fileStartedAt !== (matchedEvent.startedAt ?? null);

  if (!completedChanged && !startedAtChanged) return;

  let newCompletedAt = matchedEvent.completedAt;
  if (completedChanged) {
    newCompletedAt = fileCompleted ? formatLocalDateTime(new Date()) : null;
    _addPendingWrite(filePath);
    try {
      await plugin.app.fileManager.processFrontMatter(file, (fmObj) => {
        fmObj.completedAt = newCompletedAt;
      });
    } catch (e) {
      _consumePendingWrite(filePath);
      return; // File write failed — don't persist inconsistent state
    }
    matchedEvent.completed = fileCompleted;
    matchedEvent.completedAt = newCompletedAt;
  }

  if (startedAtChanged) {
    matchedEvent.startedAt = fileStartedAt;
  }

  await plugin.saveData(plugin.settings);
  plugin.refreshAllViews();
}
```

Notes:
- `startedAt` syncs file → `dailyEvents` only; no write-back to the file, since the file is already authoritative for this field.
- If the user removes `startedAt` from the file's frontmatter entirely, `fileStartedAt` becomes `null` and `matchedEvent.startedAt` is cleared too — consistent with treating the file as authoritative for externally-triggered changes (same principle as `completed`/`completedAt`).
- Both `completedChanged` and `startedAtChanged` can be true in the same event (e.g. user edits both fields at once); both are applied and persisted in one `saveData` call.

## Testing

- `tests/store.test.js`: extend the `normalizeDailyEvents` test to assert `startedAt` (string and missing/non-string cases) round-trips correctly.
- New tests for `resolveArchivedEventFields` and `coerceFrontmatterDate` (pure functions, no Obsidian stub required): frontmatter present/absent/partial, `Date`-typed frontmatter values, events with no `filePath`.
- New or extended note-manager tests for `handleEventMetadataChanged`, using the stub-`app`/`plugin` pattern from `tests/note-search.test.js`: startedAt-only change, completed-only change, both changed, neither changed (early return), no matching event.

## Out of Scope

- Manually correcting the already-archived `WeeklyEvents-2026-06-08-2026-06-14.md` line — the user will do this themselves.
- Any further multi-device `data.json` sync-conflict handling beyond the per-field frontmatter-priority merge in Fix 1.
