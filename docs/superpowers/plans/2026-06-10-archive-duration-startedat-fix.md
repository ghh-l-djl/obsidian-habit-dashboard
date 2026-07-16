# Archive Duration & startedAt Sync Fix Implementation Plan

**Status:** Implemented. This is a historical execution plan; unchecked boxes preserve the original sequence and are not open work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `startedAt` from being silently dropped on plugin reload, and make weekly archive duration/completion lines authoritative from each event's `.md` frontmatter when available.

**Architecture:** Three independent fixes. Fix 0 (`lib/store.js`) preserves `startedAt` through settings normalization. Two new pure helpers in `lib/date-utils.js` (`coerceFrontmatterDate`, `resolveArchivedEventFields`) merge `dailyEvents` with file frontmatter, file-wins-per-field. `lib/note-manager.js` gets a new `getEventFrontmatter` reader and an extended `handleEventMetadataChanged` that also syncs `startedAt` file→dashboard. `lib/sections/calendar.js`'s `archiveWeek` uses the new helpers to resolve `completed`/`completedAt`/`startedAt` per event before rendering archive lines.

**Tech Stack:** Plain Node.js (CommonJS), `node:test` + `node:assert/strict` for unit tests, Obsidian plugin API (stubbed in tests via `Module._resolveFilename` patching).

**Note on file placement vs. spec:** The approved spec (`docs/superpowers/specs/2026-06-10-archive-duration-startedat-fix-design.md`) places `coerceFrontmatterDate` and `resolveArchivedEventFields` in `lib/note-manager.js` / `lib/sections/calendar.js`. This plan instead places both in `lib/date-utils.js` because they are pure functions with zero Obsidian dependencies — `lib/sections/calendar.js` and `lib/note-manager.js` both `require("obsidian")` at module load time, which would force a much heavier Obsidian stub just to unit-test these two pure functions. `lib/date-utils.js` already has zero Obsidian dependencies and an existing test file (`tests/date-utils.test.js`) with no stubbing required. Behavior is identical to the spec; only the home module changes.

---

### Task 1: Fix 0 — preserve `startedAt` through `normalizeDailyEvents`

**Files:**
- Modify: `lib/store.js:135-143`
- Test: `tests/store.test.js`

- [ ] **Step 1: Write the failing test**

Append this test to `tests/store.test.js`, immediately after the `"normalizeDailyEvents sorts and reindexes order"` test (after line 72):

```js
test("normalizeDailyEvents preserves startedAt and defaults missing values to null", () => {
  const out = store.normalizeDailyEvents({
    "2026-06-10": [
      { id: "a", title: "A", order: 0, startedAt: "2026-06-10 14:42:32", completedAt: "2026-06-10 15:29:17" },
      { id: "b", title: "B", order: 1 }
    ]
  });
  assert.equal(out["2026-06-10"][0].startedAt, "2026-06-10 14:42:32");
  assert.equal(out["2026-06-10"][1].startedAt, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/store.test.js`
Expected: FAIL — `out["2026-06-10"][0].startedAt` is `undefined`, `AssertionError [ERR_ASSERTION]: undefined == '2026-06-10 14:42:32'`

- [ ] **Step 3: Write minimal implementation**

In `lib/store.js`, the `normalizeDailyEvents` mapping currently reads (lines 135-143):

```js
      .map((event, idx) => ({
        id: event && typeof event.id === "string" && event.id ? event.id : `evt_${Date.now()}_${idx}`,
        title: typeof event?.title === "string" ? event.title : "",
        completed: !!event?.completed,
        order: Number.isFinite(event?.order) ? event.order : idx,
        filePath: typeof event?.filePath === "string" ? event.filePath : null,
        createdAt: typeof event?.createdAt === "string" ? event.createdAt : null,
        completedAt: typeof event?.completedAt === "string" ? event.completedAt : null
      }))
```

Change line 142 to add a trailing comma and a new `startedAt` line:

```js
      .map((event, idx) => ({
        id: event && typeof event.id === "string" && event.id ? event.id : `evt_${Date.now()}_${idx}`,
        title: typeof event?.title === "string" ? event.title : "",
        completed: !!event?.completed,
        order: Number.isFinite(event?.order) ? event.order : idx,
        filePath: typeof event?.filePath === "string" ? event.filePath : null,
        createdAt: typeof event?.createdAt === "string" ? event.createdAt : null,
        completedAt: typeof event?.completedAt === "string" ? event.completedAt : null,
        startedAt: typeof event?.startedAt === "string" ? event.startedAt : null
      }))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/store.test.js`
Expected: PASS — all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add lib/store.js tests/store.test.js
git commit -m "fix: preserve startedAt through normalizeDailyEvents"
```

---

### Task 2: `coerceFrontmatterDate` helper in `lib/date-utils.js`

**Files:**
- Modify: `lib/date-utils.js`
- Test: `tests/date-utils.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/date-utils.test.js`, after the last existing test (`"shiftMonth wraps year correctly"`):

```js
test("coerceFrontmatterDate passes strings through unchanged", () => {
  assert.equal(dateUtils.coerceFrontmatterDate("2026-06-10 14:42:32"), "2026-06-10 14:42:32");
});

test("coerceFrontmatterDate formats Date instances as local datetime strings", () => {
  const date = new Date(2026, 5, 10, 14, 42, 32);
  assert.equal(dateUtils.coerceFrontmatterDate(date), "2026-06-10 14:42:32");
});

test("coerceFrontmatterDate returns null for null/undefined", () => {
  assert.equal(dateUtils.coerceFrontmatterDate(null), null);
  assert.equal(dateUtils.coerceFrontmatterDate(undefined), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/date-utils.test.js`
Expected: FAIL — `TypeError: dateUtils.coerceFrontmatterDate is not a function`

- [ ] **Step 3: Write minimal implementation**

In `lib/date-utils.js`, add the new function after `timeKey` (after line 134, before `module.exports` on line 136):

```js
function coerceFrontmatterDate(value) {
  if (typeof value === "string") return value;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())} ${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`;
  }
  return null;
}
```

Add `coerceFrontmatterDate` to `module.exports` (currently lines 136-157):

```js
module.exports = {
  pad2,
  startOfDay,
  todayKey,
  formatDateKey,
  parseDateKey,
  formatMonthKey,
  parseMonthKey,
  formatYearKey,
  getMondayOf,
  getWeekKey,
  getWeekRange,
  getDaysInMonth,
  getMonthMatrix,
  shiftMonth,
  shiftYear,
  diffDaysSince,
  formatTimeDigits,
  formatTimeDisplay,
  nowTimeParts,
  timeKey,
  coerceFrontmatterDate
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/date-utils.test.js`
Expected: PASS — all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add lib/date-utils.js tests/date-utils.test.js
git commit -m "feat: add coerceFrontmatterDate helper for normalizing frontmatter timestamps"
```

---

### Task 3: `resolveArchivedEventFields` helper in `lib/date-utils.js`

**Files:**
- Modify: `lib/date-utils.js`
- Test: `tests/date-utils.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/date-utils.test.js`:

```js
test("resolveArchivedEventFields prefers frontmatter values when present", () => {
  const event = { completed: false, completedAt: null, startedAt: null };
  const frontmatter = { completed: true, completedAt: "2026-06-10 15:29:17", startedAt: "2026-06-10 14:42:32" };
  assert.deepEqual(dateUtils.resolveArchivedEventFields(event, frontmatter), {
    completed: true,
    completedAt: "2026-06-10 15:29:17",
    startedAt: "2026-06-10 14:42:32"
  });
});

test("resolveArchivedEventFields falls back to event values when frontmatter is null", () => {
  const event = { completed: true, completedAt: "2026-06-10 15:29:17", startedAt: "2026-06-10 14:42:32" };
  assert.deepEqual(dateUtils.resolveArchivedEventFields(event, null), {
    completed: true,
    completedAt: "2026-06-10 15:29:17",
    startedAt: "2026-06-10 14:42:32"
  });
});

test("resolveArchivedEventFields falls back per-field for partial frontmatter", () => {
  const event = { completed: true, completedAt: "2026-06-10 15:29:17", startedAt: "2026-06-10 14:00:00" };
  const frontmatter = { completedAt: null, startedAt: "2026-06-10 14:42:32" };
  assert.deepEqual(dateUtils.resolveArchivedEventFields(event, frontmatter), {
    completed: true,
    completedAt: "2026-06-10 15:29:17",
    startedAt: "2026-06-10 14:42:32"
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/date-utils.test.js`
Expected: FAIL — `TypeError: dateUtils.resolveArchivedEventFields is not a function`

- [ ] **Step 3: Write minimal implementation**

In `lib/date-utils.js`, add the new function directly after `coerceFrontmatterDate`:

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

Add `resolveArchivedEventFields` to `module.exports`:

```js
module.exports = {
  pad2,
  startOfDay,
  todayKey,
  formatDateKey,
  parseDateKey,
  formatMonthKey,
  parseMonthKey,
  formatYearKey,
  getMondayOf,
  getWeekKey,
  getWeekRange,
  getDaysInMonth,
  getMonthMatrix,
  shiftMonth,
  shiftYear,
  diffDaysSince,
  formatTimeDigits,
  formatTimeDisplay,
  nowTimeParts,
  timeKey,
  coerceFrontmatterDate,
  resolveArchivedEventFields
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/date-utils.test.js`
Expected: PASS — all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add lib/date-utils.js tests/date-utils.test.js
git commit -m "feat: add resolveArchivedEventFields helper for frontmatter-priority merging"
```

---

### Task 4: `getEventFrontmatter` reader in `lib/note-manager.js`

**Files:**
- Modify: `lib/note-manager.js`
- Test: `tests/note-manager.test.js` (new file)

- [ ] **Step 1: Create the test file with the obsidian stub and failing tests**

Create `tests/note-manager.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patched(request, parent, ...rest) {
  if (request === "obsidian") return "obsidian-stub";
  return originalResolve.call(this, request, parent, ...rest);
};

class TFile {
  constructor(path) {
    this.path = path;
  }
}

require.cache["obsidian-stub"] = {
  id: "obsidian-stub",
  filename: "obsidian-stub",
  loaded: true,
  exports: { TFile },
  paths: [],
  children: []
};

const noteManager = require("../lib/note-manager");

test("getEventFrontmatter returns null when filePath is empty", () => {
  const app = {
    vault: { getAbstractFileByPath: () => null },
    metadataCache: { getFileCache: () => null }
  };
  assert.equal(noteManager.getEventFrontmatter(app, null), null);
  assert.equal(noteManager.getEventFrontmatter(app, ""), null);
});

test("getEventFrontmatter returns null when file does not exist", () => {
  const app = {
    vault: { getAbstractFileByPath: () => null },
    metadataCache: { getFileCache: () => null }
  };
  assert.equal(noteManager.getEventFrontmatter(app, "Habit Dashboard/Events/missing.md"), null);
});

test("getEventFrontmatter returns null when file has no frontmatter", () => {
  const file = new TFile("Habit Dashboard/Events/a.md");
  const app = {
    vault: { getAbstractFileByPath: () => file },
    metadataCache: { getFileCache: () => ({}) }
  };
  assert.equal(noteManager.getEventFrontmatter(app, file.path), null);
});

test("getEventFrontmatter normalizes completed/completedAt/startedAt", () => {
  const file = new TFile("Habit Dashboard/Events/a.md");
  const app = {
    vault: { getAbstractFileByPath: () => file },
    metadataCache: {
      getFileCache: () => ({
        frontmatter: {
          completed: true,
          completedAt: "2026-06-10 15:29:17",
          startedAt: new Date(2026, 5, 10, 14, 42, 32)
        }
      })
    }
  };
  assert.deepEqual(noteManager.getEventFrontmatter(app, file.path), {
    completed: true,
    completedAt: "2026-06-10 15:29:17",
    startedAt: "2026-06-10 14:42:32"
  });
});

test("getEventFrontmatter treats non-boolean completed as undefined", () => {
  const file = new TFile("Habit Dashboard/Events/a.md");
  const app = {
    vault: { getAbstractFileByPath: () => file },
    metadataCache: { getFileCache: () => ({ frontmatter: { startedAt: null, completedAt: null } }) }
  };
  const fm = noteManager.getEventFrontmatter(app, file.path);
  assert.equal(fm.completed, undefined);
  assert.equal(fm.startedAt, null);
  assert.equal(fm.completedAt, null);
});

Module._resolveFilename = originalResolve;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/note-manager.test.js`
Expected: FAIL — `TypeError: noteManager.getEventFrontmatter is not a function`

- [ ] **Step 3: Write minimal implementation**

In `lib/note-manager.js`, add the import for `coerceFrontmatterDate`. Current line 24:

```js
const { makeId } = require("./store");
```

Change to:

```js
const { makeId } = require("./store");
const { coerceFrontmatterDate } = require("./date-utils");
```

Add the new `getEventFrontmatter` function directly after `updateEventFrontmatter` and before `writeBoxChecklist`. Current (lines 119-125):

```js
  } catch (e) {
    _consumePendingWrite(filePath);
    throw e;
  }
}

async function writeBoxChecklist(app, filePath, tasks) {
```

Change to:

```js
  } catch (e) {
    _consumePendingWrite(filePath);
    throw e;
  }
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

async function writeBoxChecklist(app, filePath, tasks) {
```

Add `getEventFrontmatter` to `module.exports` (currently lines 397-414):

```js
module.exports = {
  formatLocalDateTime,
  createEventNote,
  createBoxNote,
  openNote,
  trashNote,
  updateEventFrontmatter,
  getEventFrontmatter,
  writeBoxChecklist,
  parseBoxChecklist,
  isYoriEventFile,
  isYoriBoxFile,
  handleFileRename,
  handleFileModify,
  handleEventMetadataChanged,
  handleFileDelete,
  hasExtraContent,
  disassociateAndDeleteNote
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/note-manager.test.js`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/note-manager.js tests/note-manager.test.js
git commit -m "feat: add getEventFrontmatter to read normalized event note frontmatter"
```

---

### Task 5: Extend `handleEventMetadataChanged` to sync `startedAt`

**Files:**
- Modify: `lib/note-manager.js:222-262`
- Test: `tests/note-manager.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/note-manager.test.js`, add a `makePlugin` helper and 5 new tests. Insert these **before** the final `Module._resolveFilename = originalResolve;` line:

```js
function makePlugin({ frontmatter, event }) {
  const file = new TFile(event.filePath);
  const dailyEvents = { "2026-06-10": [event] };
  const processFrontMatterCalls = [];
  const plugin = {
    app: {
      metadataCache: {
        getFileCache: () => ({ frontmatter })
      },
      fileManager: {
        processFrontMatter: async (f, fn) => {
          processFrontMatterCalls.push(f.path);
          fn(frontmatter);
        }
      }
    },
    settings: { data: { dailyEvents } },
    saveDataCalls: 0,
    refreshCalls: 0,
    saveData: async function () { this.saveDataCalls += 1; },
    refreshAllViews: function () { this.refreshCalls += 1; }
  };
  return { plugin, file, processFrontMatterCalls };
}

test("handleEventMetadataChanged syncs startedAt-only change without writing the file", async () => {
  const event = {
    id: "evt_1",
    filePath: "Habit Dashboard/Events/2026-06-10-a.md",
    completed: false,
    completedAt: null,
    startedAt: null
  };
  const { plugin, file, processFrontMatterCalls } = makePlugin({
    frontmatter: { completed: false, completedAt: null, startedAt: "2026-06-10 14:42:32" },
    event
  });

  await noteManager.handleEventMetadataChanged(plugin, file);

  assert.equal(event.startedAt, "2026-06-10 14:42:32");
  assert.equal(event.completed, false);
  assert.equal(event.completedAt, null);
  assert.equal(processFrontMatterCalls.length, 0);
  assert.equal(plugin.saveDataCalls, 1);
  assert.equal(plugin.refreshCalls, 1);
});

test("handleEventMetadataChanged recomputes completedAt on completed change", async () => {
  const event = {
    id: "evt_2",
    filePath: "Habit Dashboard/Events/2026-06-10-b.md",
    completed: false,
    completedAt: null,
    startedAt: "2026-06-10 14:42:32"
  };
  const { plugin, file, processFrontMatterCalls } = makePlugin({
    frontmatter: { completed: true, completedAt: null, startedAt: "2026-06-10 14:42:32" },
    event
  });

  await noteManager.handleEventMetadataChanged(plugin, file);

  assert.equal(event.completed, true);
  assert.match(event.completedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(event.startedAt, "2026-06-10 14:42:32");
  assert.equal(processFrontMatterCalls.length, 1);
  assert.equal(plugin.saveDataCalls, 1);
});

test("handleEventMetadataChanged syncs both completed and startedAt together", async () => {
  const event = {
    id: "evt_3",
    filePath: "Habit Dashboard/Events/2026-06-10-c.md",
    completed: false,
    completedAt: null,
    startedAt: null
  };
  const { plugin, file } = makePlugin({
    frontmatter: { completed: true, completedAt: null, startedAt: "2026-06-10 14:42:32" },
    event
  });

  await noteManager.handleEventMetadataChanged(plugin, file);

  assert.equal(event.completed, true);
  assert.equal(event.startedAt, "2026-06-10 14:42:32");
  assert.ok(event.completedAt);
  assert.equal(plugin.saveDataCalls, 1);
});

test("handleEventMetadataChanged is a no-op when nothing changed", async () => {
  const event = {
    id: "evt_4",
    filePath: "Habit Dashboard/Events/2026-06-10-d.md",
    completed: false,
    completedAt: null,
    startedAt: "2026-06-10 14:42:32"
  };
  const { plugin, file } = makePlugin({
    frontmatter: { completed: false, completedAt: null, startedAt: "2026-06-10 14:42:32" },
    event
  });

  await noteManager.handleEventMetadataChanged(plugin, file);

  assert.equal(plugin.saveDataCalls, 0);
  assert.equal(plugin.refreshCalls, 0);
});

test("handleEventMetadataChanged clears startedAt when removed from frontmatter", async () => {
  const event = {
    id: "evt_5",
    filePath: "Habit Dashboard/Events/2026-06-10-e.md",
    completed: false,
    completedAt: null,
    startedAt: "2026-06-10 14:42:32"
  };
  const { plugin, file } = makePlugin({
    frontmatter: { completed: false, completedAt: null },
    event
  });

  await noteManager.handleEventMetadataChanged(plugin, file);

  assert.equal(event.startedAt, null);
  assert.equal(plugin.saveDataCalls, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/note-manager.test.js`
Expected: FAIL — 3 of the 5 new tests fail:
- `"syncs startedAt-only change..."` — fails because `plugin.saveDataCalls` is `0` (current code returns early when `completed` is unchanged, never looking at `startedAt`)
- `"syncs both completed and startedAt together"` — fails because `event.startedAt` stays `null` (current code never copies `fm.startedAt`)
- `"clears startedAt when removed from frontmatter"` — fails because `plugin.saveDataCalls` is `0` and `event.startedAt` stays `"2026-06-10 14:42:32"`

The other 2 new tests (`"recomputes completedAt..."` and `"is a no-op..."`) already PASS — they exercise the existing `completed`/`completedAt` logic, which is unchanged.

- [ ] **Step 3: Write minimal implementation**

In `lib/note-manager.js`, replace `handleEventMetadataChanged`. Current (lines 222-262):

```js
// Called via metadataCache.on('changed') so frontmatter is already up-to-date.
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
  if (fileCompleted === matchedEvent.completed) return;

  const newCompletedAt = fileCompleted ? formatLocalDateTime(new Date()) : null;

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
  await plugin.saveData(plugin.settings);
  plugin.refreshAllViews();
}
```

Change to:

```js
// Called via metadataCache.on('changed') so frontmatter is already up-to-date.
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

  if (completedChanged) {
    const newCompletedAt = fileCompleted ? formatLocalDateTime(new Date()) : null;
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

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/note-manager.test.js`
Expected: PASS — all 10 tests in the file pass.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all test files pass.

- [ ] **Step 6: Commit**

```bash
git add lib/note-manager.js tests/note-manager.test.js
git commit -m "fix: sync startedAt from event note frontmatter back into dailyEvents"
```

---

### Task 6: Wire `archiveWeek` to use frontmatter-priority resolution

**Files:**
- Modify: `lib/sections/calendar.js:5-12, 663-738`

- [ ] **Step 1: Add `resolveArchivedEventFields` to the date-utils import**

Current `lib/sections/calendar.js:5-12`:

```js
const {
  formatDateKey,
  parseDateKey,
  getMonthMatrix,
  shiftMonth,
  getMondayOf,
  formatYearKey
} = require("../date-utils");
```

Change to:

```js
const {
  formatDateKey,
  parseDateKey,
  getMonthMatrix,
  shiftMonth,
  getMondayOf,
  formatYearKey,
  resolveArchivedEventFields
} = require("../date-utils");
```

- [ ] **Step 2: Resolve frontmatter-merged fields per event in `archiveWeek`**

Current `lib/sections/calendar.js:676-689` (inside `archiveWeek`'s `onConfirm`):

```js
      // Collect events + check for extra content in associated MD files
      const weekData = [];
      for (let i = 0; i < 7; i += 1) {
        const day = new Date(monday);
        day.setDate(monday.getDate() + i);
        const dateKey = formatDateKey(day);
        const events = getEventList(ctx.settings, dateKey);
        const enriched = await Promise.all(events.map(async (event) => {
          const hasNotes = event.filePath
            ? await noteManager.hasExtraContent(ctx.app, event.filePath)
            : false;
          return { event, dateKey, hasNotes };
        }));
        weekData.push({ dateKey, enriched });
      }
```

Change the `events.map` body to also fetch frontmatter and resolve fields:

```js
      // Collect events + check for extra content in associated MD files
      const weekData = [];
      for (let i = 0; i < 7; i += 1) {
        const day = new Date(monday);
        day.setDate(monday.getDate() + i);
        const dateKey = formatDateKey(day);
        const events = getEventList(ctx.settings, dateKey);
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
        weekData.push({ dateKey, enriched });
      }
```

- [ ] **Step 3: Use resolved fields when rendering archive lines**

Current `lib/sections/calendar.js:691-706`:

```js
      // Build archive sections
      const sections = weekData.map(({ dateKey, enriched }) => ({
        heading: dateKey,
        lines: enriched.length === 0
          ? ["(空)"]
          : enriched.map(({ event, hasNotes }) => {
              const check = event.completed ? "x" : " ";
              const title = event.title || "";
              const duration = formatDuration(event.startedAt, event.completedAt);
              if (hasNotes && event.filePath) {
                const linkPath = event.filePath.replace(/\.md$/, "");
                return `- [${check}] [[${linkPath}|${title}]]${duration}`;
              }
              return `- [${check}] ${title}${duration}`;
            })
      }));
```

Change to use `resolved` instead of reading `completed`/`startedAt`/`completedAt` directly off `event`:

```js
      // Build archive sections
      const sections = weekData.map(({ dateKey, enriched }) => ({
        heading: dateKey,
        lines: enriched.length === 0
          ? ["(空)"]
          : enriched.map(({ event, hasNotes, resolved }) => {
              const check = resolved.completed ? "x" : " ";
              const title = event.title || "";
              const duration = formatDuration(resolved.startedAt, resolved.completedAt);
              if (hasNotes && event.filePath) {
                const linkPath = event.filePath.replace(/\.md$/, "");
                return `- [${check}] [[${linkPath}|${title}]]${duration}`;
              }
              return `- [${check}] ${title}${duration}`;
            })
      }));
```

- [ ] **Step 4: Use resolved `completed` for the cleanup-eligibility check**

Current `lib/sections/calendar.js:723-726`:

```js
      // Clean up MD files only when completed and no extra content
      const toClean = weekData.flatMap(({ enriched }) =>
        enriched.filter(({ hasNotes, event }) => !hasNotes && event.completed && event.filePath)
      );
```

Change to use `resolved.completed`, consistent with the line rendering above (same merged value, already computed):

```js
      // Clean up MD files only when completed and no extra content
      const toClean = weekData.flatMap(({ enriched }) =>
        enriched.filter(({ hasNotes, event, resolved }) => !hasNotes && resolved.completed && event.filePath)
      );
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all test files pass (this change has no dedicated unit test; `lib/sections/calendar.js` requires `obsidian` at module load and has no existing test coverage or stub. The full suite confirms nothing else broke).

- [ ] **Step 6: Commit**

```bash
git add lib/sections/calendar.js
git commit -m "fix: prefer event note frontmatter over dailyEvents when archiving weekly events"
```

---

### Task 7: Manual verification in a real vault

**Files:** none (manual QA pass)

- [ ] **Step 1: Build the plugin**

Run: `npm run build`
Expected: bundle written to `main.js` with no errors.

- [ ] **Step 2: Verify Fix 0 — startedAt survives a reload**

1. In your test vault, reload the Habit Dashboard plugin (or restart Obsidian) to load the freshly built `main.js`.
2. On today's calendar, add a new event and click the ▶ start button.
3. Open `.obsidian/plugins/habit-dashboard/data.json` and confirm the event in `data.dailyEvents` has a non-null `startedAt` string.
4. Reload the plugin again (Obsidian → disable/enable the plugin, or restart Obsidian).
5. Re-open `data.json` and confirm `startedAt` is **still present** (previously it would disappear after this reload).

- [ ] **Step 3: Verify Fix 1 — archive duration uses frontmatter**

1. Mark the event from Step 2 as completed (check its checkbox).
2. Open the event's `.md` file and confirm `startedAt` and `completedAt` are both set in the frontmatter.
3. In the dashboard, manually edit `data.json` to remove (or null out) that event's `startedAt`/`completed`/`completedAt` fields, simulating the data-loss scenario from the original bug report. Reload the dashboard.
4. Open the weekly view and archive the current week.
5. Confirm the archived line for this event shows `[x]` and includes a duration suffix like `(Nm)`, derived from the `.md` file's frontmatter even though `data.json` was missing the fields.

- [ ] **Step 4: Verify Fix 2 — startedAt syncs back from manual frontmatter edits**

1. Create a new event, do **not** click ▶.
2. Open the event's `.md` file and manually add `startedAt: 2026-06-10 09:00:00` to the frontmatter via Obsidian's Properties UI (or by editing the YAML directly and triggering a save).
3. Without reloading the plugin, refresh the dashboard (or wait for the next render).
4. Confirm the event's ▶ button now shows the "started" state (filled/checked icon) with the tooltip showing `2026-06-10 09:00:00`.
5. Confirm `data.json`'s `dailyEvents` entry for this event now has `startedAt: "2026-06-10 09:00:00"`.

---

## Self-Review Notes

- **Spec coverage:** Fix 0 → Task 1. Shared helpers (`coerceFrontmatterDate`, `getEventFrontmatter`, `resolveArchivedEventFields`) → Tasks 2-4. Fix 1 (archive-time merge, extended to `completed`) → Task 6. Fix 2 (`startedAt` bidirectional sync) → Task 5. Manual archive correction explicitly out of scope per spec (user will do it themselves).
- **Placeholder scan:** No TBD/TODO; every step has complete code or exact commands.
- **Type/name consistency:** `coerceFrontmatterDate`, `getEventFrontmatter`, `resolveArchivedEventFields` are named identically across their definition (Tasks 2-4) and usage (Tasks 5-6). `resolved.completed` / `resolved.completedAt` / `resolved.startedAt` field names match the `resolveArchivedEventFields` return shape from Task 3.
