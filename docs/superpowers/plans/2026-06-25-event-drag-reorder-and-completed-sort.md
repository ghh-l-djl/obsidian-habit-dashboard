# Event Drag-Reorder and Completed-Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users manually reorder daily events (drag on desktop, up/down buttons on mobile) and have completed events always render below uncompleted ones in the main dashboard panel.

**Architecture:** All changes live in `lib/sections/calendar.js`. Two new pure functions (`orderEventsForDisplay`, `reorderEvents`) carry the actual logic and get unit tests; the rest is wiring those functions into the existing `renderDayEvents`/`renderEventRow` render path plus new CSS/i18n. No new data fields — everything reuses the existing `order` field already maintained by `setEventList`.

**Tech Stack:** Plain JS (no framework), Obsidian Plugin API, `node:test` for unit tests (see `tests/check-in.test.js` for the obsidian-mocking pattern this project already uses).

## Global Constraints

- Scope is **only** the main dashboard panel's daily events list (`renderDayEvents` → `.yd-events-list`). The weekly view (`renderWeeklyView`, opened via the "More" button) is explicitly out of scope — it keeps rendering events in raw `order` sequence with no drag/sort grouping.
- No new fields on the event object. Reuse the existing `order` field; `setEventList` already rewrites `order = idx` for the array passed to it.
- "Completed events sort to the bottom" is a **render-time-only** transformation. Never call `setEventList` just to apply this ordering — only call it when the user actually drags/clicks to reorder.
- Desktop reordering uses native HTML5 drag-and-drop, matching the existing pattern in `lib/sections/task-box.js` `renderTaskBoxSettings` (drag handle icon `grip-vertical`, `is-dragging`/`is-drop-target` classes).
- Mobile (`Platform.isMobile` from the `obsidian` package, already imported in `calendar.js` as `Platform`) gets up/down chevron buttons instead of a drag handle — HTML5 drag does not work on touch.
- Cross-group reordering is forbidden: an uncompleted event can never be dropped into the completed block or vice versa.

---

### Task 1: `orderEventsForDisplay` pure function + test

**Files:**
- Modify: `lib/sections/calendar.js` (add function near `getEventList`/`setEventList`, around line 84; add to `module.exports` at lines 745-756)
- Test: `tests/calendar.test.js` (new file)

**Interfaces:**
- Produces: `orderEventsForDisplay(events: Array<{id, completed}>) => Array` — returns a new array with all `!completed` events first (original relative order preserved), then all `completed` events (original relative order preserved). Exported from `lib/sections/calendar.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/calendar.test.js`:

```js
"use strict";

// Mock obsidian before any require — same pattern as tests/check-in.test.js
const Module = require("node:module");
const realLoad = Module._load.bind(Module);
Module._load = function (id, parent, isMain) {
  if (id === "obsidian") {
    return {
      Notice: class {},
      Menu: class { addItem() { return this; } setTitle() { return this; } onClick() { return this; } showAtMouseEvent() {} },
      Modal: class { constructor() {} open() {} close() {} },
      FuzzySuggestModal: class {},
      TFile: class {},
      Platform: { isMobile: false },
      setIcon: () => {},
      normalizePath: (p) => p
    };
  }
  return realLoad(id, parent, isMain);
};

const test = require("node:test");
const assert = require("node:assert/strict");
const calendar = require("../lib/sections/calendar");

test("orderEventsForDisplay puts undone events before completed events", () => {
  const events = [
    { id: "a", completed: true },
    { id: "b", completed: false },
    { id: "c", completed: true },
    { id: "d", completed: false }
  ];
  const result = calendar.orderEventsForDisplay(events);
  assert.deepEqual(result.map((e) => e.id), ["b", "d", "a", "c"]);
});

test("orderEventsForDisplay preserves relative order within each group", () => {
  const events = [
    { id: "a", completed: false },
    { id: "b", completed: false },
    { id: "c", completed: true },
    { id: "d", completed: true }
  ];
  const result = calendar.orderEventsForDisplay(events);
  assert.deepEqual(result.map((e) => e.id), ["a", "b", "c", "d"]);
});

test("orderEventsForDisplay returns a new array, does not mutate input", () => {
  const events = [{ id: "a", completed: true }, { id: "b", completed: false }];
  const original = events.slice();
  calendar.orderEventsForDisplay(events);
  assert.deepEqual(events, original);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/calendar.test.js`
Expected: FAIL — `calendar.orderEventsForDisplay is not a function`

- [ ] **Step 3: Implement `orderEventsForDisplay`**

In `lib/sections/calendar.js`, add this function directly after `setEventList` (after the closing `}` currently at line 84):

```js
function orderEventsForDisplay(events) {
  const undone = events.filter((e) => !e.completed);
  const done = events.filter((e) => e.completed);
  return [...undone, ...done];
}
```

Then update `module.exports` at the bottom of the file (currently lines 745-756) to include it:

```js
module.exports = {
  render: renderCalendarSection,
  openWeeklyModal,
  getEventList,
  setEventList,
  createEvent,
  updateEvent,
  deleteEvent,
  copyEvent,
  pasteEvent,
  postponeUndoneTomorrow,
  orderEventsForDisplay
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/calendar.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sections/calendar.js tests/calendar.test.js
git commit -m "feat: add orderEventsForDisplay for completed-last rendering"
```

---

### Task 2: `reorderEvents` pure function + tests

**Files:**
- Modify: `lib/sections/calendar.js` (add function next to `orderEventsForDisplay`; add to `module.exports`)
- Test: `tests/calendar.test.js` (append)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `reorderEvents(events: Array<{id, completed}>, completed: boolean, newOrderIds: string[]) => Array` — returns a **new** full event array where the bucket matching `completed` is reordered to follow `newOrderIds`, and the other bucket is left untouched and appended/prepended so the overall array still has the uncompleted bucket before the completed bucket. If `newOrderIds` doesn't contain exactly the same ids as the target bucket (mismatch/corruption guard), returns the original `events` array unchanged (`.slice()` copy). Exported from `lib/sections/calendar.js`. Used by Task 4 and Task 5 to compute the array to pass into the existing `setEventList(settings, dateKey, list)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/calendar.test.js`:

```js
test("reorderEvents reorders only the matching completed-bucket", () => {
  const events = [
    { id: "a", completed: false },
    { id: "b", completed: false },
    { id: "c", completed: true }
  ];
  const result = calendar.reorderEvents(events, false, ["b", "a"]);
  assert.deepEqual(result.map((e) => e.id), ["b", "a", "c"]);
});

test("reorderEvents keeps uncompleted bucket before completed bucket when reordering completed", () => {
  const events = [
    { id: "a", completed: false },
    { id: "b", completed: true },
    { id: "c", completed: true }
  ];
  const result = calendar.reorderEvents(events, true, ["c", "b"]);
  assert.deepEqual(result.map((e) => e.id), ["a", "c", "b"]);
});

test("reorderEvents falls back to original array when newOrderIds doesn't match the bucket", () => {
  const events = [
    { id: "a", completed: false },
    { id: "b", completed: false }
  ];
  const result = calendar.reorderEvents(events, false, ["a", "z"]);
  assert.deepEqual(result.map((e) => e.id), ["a", "b"]);
});

test("reorderEvents does not mutate the input array", () => {
  const events = [
    { id: "a", completed: false },
    { id: "b", completed: false }
  ];
  const original = events.slice();
  calendar.reorderEvents(events, false, ["b", "a"]);
  assert.deepEqual(events, original);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/calendar.test.js`
Expected: FAIL — `calendar.reorderEvents is not a function`

- [ ] **Step 3: Implement `reorderEvents`**

In `lib/sections/calendar.js`, add this function directly after `orderEventsForDisplay`:

```js
function reorderEvents(events, completed, newOrderIds) {
  const bucket = events.filter((e) => !!e.completed === completed);
  const other = events.filter((e) => !!e.completed !== completed);
  const byId = new Map(bucket.map((e) => [e.id, e]));
  const reordered = newOrderIds.map((id) => byId.get(id)).filter(Boolean);
  if (reordered.length !== bucket.length) return events.slice();
  return completed ? [...other, ...reordered] : [...reordered, ...other];
}
```

Add `reorderEvents` to `module.exports`:

```js
module.exports = {
  render: renderCalendarSection,
  openWeeklyModal,
  getEventList,
  setEventList,
  createEvent,
  updateEvent,
  deleteEvent,
  copyEvent,
  pasteEvent,
  postponeUndoneTomorrow,
  orderEventsForDisplay,
  reorderEvents
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/calendar.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sections/calendar.js tests/calendar.test.js
git commit -m "feat: add reorderEvents for group-scoped manual reordering"
```

---

### Task 3: Wire `orderEventsForDisplay` into `renderDayEvents`

**Files:**
- Modify: `lib/sections/calendar.js:293-295`

**Interfaces:**
- Consumes: `orderEventsForDisplay` (Task 1).
- Produces: each call to `renderEventRow` now receives a 5th `meta` argument `{ groupIds }`, which Task 4/5 will read. `renderEventRow`'s signature changes from `(parent, event, dateKey, ctx)` to `(parent, event, dateKey, ctx, meta)` with `meta` optional (defaults to `{}`), so the existing call site in `renderWeeklyView` (`lib/sections/calendar.js:615`, `renderEventRow(list, event, dateKey, modalCtx)`) keeps working unchanged — it simply gets `meta = {}` and Task 4/5's drag/move UI won't render there.

- [ ] **Step 1: Update the render loop in `renderDayEvents`**

In `lib/sections/calendar.js`, replace (currently lines 293-295):

```js
  events.forEach((event) => {
    renderEventRow(list, event, dateKey, ctx);
  });
```

with:

```js
  const ordered = orderEventsForDisplay(events);
  const undoneIds = ordered.filter((e) => !e.completed).map((e) => e.id);
  const doneIds = ordered.filter((e) => e.completed).map((e) => e.id);
  ordered.forEach((event) => {
    renderEventRow(list, event, dateKey, ctx, { groupIds: event.completed ? doneIds : undoneIds });
  });
```

- [ ] **Step 2: Update `renderEventRow`'s signature to accept and default `meta`**

In `lib/sections/calendar.js:341`, change:

```js
function renderEventRow(parent, event, dateKey, ctx) {
```

to:

```js
function renderEventRow(parent, event, dateKey, ctx, meta) {
  const reorderMeta = meta || {};
```

(`reorderMeta` will be used by Task 4/5; unused for now, so add a no-op reference to avoid an unused-variable lint warning if the project lints for that — check by running the existing lint/build step in Step 3 below.)

- [ ] **Step 3: Run the full test suite and build to confirm nothing broke**

Run: `npm test`
Expected: all existing tests still PASS, plus the 7 new `calendar.test.js` tests.

Run: `npm run build`
Expected: bundles without error.

- [ ] **Step 4: Manual verification in Obsidian**

This step has no automated test — `renderDayEvents`/`renderEventRow` render real DOM via the Obsidian API, which isn't exercised by `node:test`.

1. Build the plugin (`npm run build`) and reload it in an Obsidian vault (or use `npm run build` output copied into `.obsidian/plugins/habit-dashboard/`).
2. On today's date, add 3 events: "A", "B", "C". Mark "B" completed.
3. Confirm the panel shows "A", "C" (uncompleted) above "B" (completed) — completed sorted to the bottom.
4. Mark "C" completed too. Confirm it now appears below "B" or above it according to whichever became completed — order among completed items should match the order they had before completion (not completion time).
5. Uncheck "B". Confirm it returns to its original position relative to "A"/"C" among the uncompleted group (not appended at the end) — this confirms `order` was never mutated by the display grouping.

- [ ] **Step 5: Commit**

```bash
git add lib/sections/calendar.js
git commit -m "feat: render completed events below uncompleted ones in daily panel"
```

---

### Task 4: Desktop drag-and-drop handle

**Files:**
- Modify: `lib/sections/calendar.js` (new `renderReorderControl` function; call it from `renderEventRow`; add to `module.exports` only if needed for testing — not needed, it's DOM-only)
- Modify: `styles.css` (new rules near the existing `.yd-event-row` block, around line 700, and near the existing `.yd-drag-handle`/`.is-dragging`/`.is-drop-target` rules around lines 2249-2271)

**Interfaces:**
- Consumes: `getEventList`, `setEventList`, `reorderEvents` (Task 2), `createIconButton` (already imported in `calendar.js` from `../dom-utils`), `meta.groupIds` (Task 3).
- Produces: nothing new consumed by later tasks — Task 5 adds a sibling branch in the same `renderReorderControl` function.

- [ ] **Step 1: Add `renderReorderControl` (desktop branch only for now) and call it from `renderEventRow`**

In `lib/sections/calendar.js`, add this new function directly before `renderEventRow` (currently at line 341):

```js
function renderReorderControl(row, event, dateKey, ctx, groupIds) {
  const { settings } = ctx;
  const commit = async (newGroupIds) => {
    const events = getEventList(settings, dateKey);
    const merged = reorderEvents(events, !!event.completed, newGroupIds);
    setEventList(settings, dateKey, merged);
    await ctx.save();
    ctx.refresh();
  };

  const drag = row.createDiv({ cls: "yd-drag-handle yd-event-drag-handle" });
  createIconButton(drag, "grip-vertical", { cls: "yd-drag-handle-icon", fallback: "⋮⋮" });
  drag.setAttribute("draggable", "true");
  drag.addEventListener("dragstart", (e) => {
    e.dataTransfer?.setData("text/plain", event.id);
    row.addClass("is-dragging");
  });
  drag.addEventListener("dragend", () => row.removeClass("is-dragging"));
  row.addEventListener("dragover", (e) => {
    e.preventDefault();
    row.addClass("is-drop-target");
  });
  row.addEventListener("dragleave", () => row.removeClass("is-drop-target"));
  row.addEventListener("drop", async (e) => {
    e.preventDefault();
    row.removeClass("is-drop-target");
    const fromId = e.dataTransfer?.getData("text/plain");
    if (!fromId || fromId === event.id || !groupIds.includes(fromId)) return;
    const next = groupIds.slice();
    const fromIdx = next.indexOf(fromId);
    const toIdx = next.indexOf(event.id);
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromId);
    await commit(next);
  });
}
```

Then, in `renderEventRow` (signature already updated in Task 3 Step 2), add the call right after `const row = parent.createDiv({ cls: "yd-event-row" });`:

```js
  if (reorderMeta.groupIds) {
    renderReorderControl(row, event, dateKey, ctx, reorderMeta.groupIds);
  }
```

- [ ] **Step 2: Add CSS for the drag handle visibility and drag states**

In `styles.css`, add directly after the existing `.yd-event-row:hover, ... { background-color: ... }` rule (currently ending at line 692):

```css
.yd-event-drag-handle {
  opacity: 0;
  flex-shrink: 0;
}

.yd-event-row:hover .yd-event-drag-handle {
  opacity: 1;
}

.yd-event-row.is-dragging {
  opacity: 0.5;
}

.yd-event-row.is-drop-target {
  border-top: 2px solid var(--yd-accent-deep);
}
```

(`.yd-drag-handle`/`.yd-drag-handle-icon` base styles already exist globally at `styles.css:2258-2271` and apply as-is — no change needed there.)

- [ ] **Step 3: Run the full test suite and build**

Run: `npm test`
Expected: all tests PASS (no new tests added in this task — it's DOM wiring).

Run: `npm run build`
Expected: bundles without error.

- [ ] **Step 4: Manual verification in Obsidian (desktop)**

1. Reload the built plugin in Obsidian desktop.
2. On today's events list, hover a row — confirm a `⋮⋮` drag handle fades in on the left.
3. Drag an uncompleted event below another uncompleted event — confirm the order updates and persists after closing/reopening the vault (reload Obsidian or switch dates and back).
4. Mark one event completed. Confirm its drag handle still works to reorder it among other *completed* events.
5. Try dragging an uncompleted event's handle and dropping it onto a completed row (or vice versa) — confirm nothing happens (no reorder, no crash) since `groupIds.includes(fromId)` guards cross-group drops.

- [ ] **Step 5: Commit**

```bash
git add lib/sections/calendar.js styles.css
git commit -m "feat: add desktop drag-and-drop reordering for daily events"
```

---

### Task 5: Mobile up/down move buttons + i18n

**Files:**
- Modify: `lib/sections/calendar.js` (extend `renderReorderControl` with a mobile branch)
- Modify: `lib/i18n.js:56` (Chinese block) and `lib/i18n.js:238` (English block)
- Modify: `styles.css` (new `.yd-event-move-buttons`/`.yd-event-move-btn` rules)

**Interfaces:**
- Consumes: `Platform` (already imported in `calendar.js` from `obsidian`), `t` (translation function, already available via `ctx.t` in other parts of `calendar.js`), `createIconButton`.
- Produces: nothing consumed by later tasks (this plan's final task).

- [ ] **Step 1: Add the i18n keys**

In `lib/i18n.js`, in the Chinese block, insert directly after the line `"calendar.startTask": "开始任务",` (currently line 56):

```js
    "calendar.moveUp": "上移",
    "calendar.moveDown": "下移",
```

In the English block, insert directly after the line `"calendar.startTask": "Start task",` (currently line 238):

```js
    "calendar.moveUp": "Move up",
    "calendar.moveDown": "Move down",
```

- [ ] **Step 2: Run the i18n test to confirm no key/structure issues**

Run: `node --test tests/i18n.test.js`
Expected: PASS

- [ ] **Step 3: Extend `renderReorderControl` with the mobile branch**

In `lib/sections/calendar.js`, replace the `renderReorderControl` function body added in Task 4 with:

```js
function renderReorderControl(row, event, dateKey, ctx, groupIds) {
  const { settings, t } = ctx;
  const commit = async (newGroupIds) => {
    const events = getEventList(settings, dateKey);
    const merged = reorderEvents(events, !!event.completed, newGroupIds);
    setEventList(settings, dateKey, merged);
    await ctx.save();
    ctx.refresh();
  };

  if (Platform?.isMobile) {
    const idx = groupIds.indexOf(event.id);
    const wrap = row.createDiv({ cls: "yd-event-move-buttons" });
    if (idx > 0) {
      createIconButton(wrap, "chevron-up", {
        cls: "yd-event-move-btn",
        label: t("calendar.moveUp"),
        fallback: "↑",
        onClick: async () => {
          const next = groupIds.slice();
          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
          await commit(next);
        }
      });
    }
    if (idx !== -1 && idx < groupIds.length - 1) {
      createIconButton(wrap, "chevron-down", {
        cls: "yd-event-move-btn",
        label: t("calendar.moveDown"),
        fallback: "↓",
        onClick: async () => {
          const next = groupIds.slice();
          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
          await commit(next);
        }
      });
    }
    return;
  }

  const drag = row.createDiv({ cls: "yd-drag-handle yd-event-drag-handle" });
  createIconButton(drag, "grip-vertical", { cls: "yd-drag-handle-icon", fallback: "⋮⋮" });
  drag.setAttribute("draggable", "true");
  drag.addEventListener("dragstart", (e) => {
    e.dataTransfer?.setData("text/plain", event.id);
    row.addClass("is-dragging");
  });
  drag.addEventListener("dragend", () => row.removeClass("is-dragging"));
  row.addEventListener("dragover", (e) => {
    e.preventDefault();
    row.addClass("is-drop-target");
  });
  row.addEventListener("dragleave", () => row.removeClass("is-drop-target"));
  row.addEventListener("drop", async (e) => {
    e.preventDefault();
    row.removeClass("is-drop-target");
    const fromId = e.dataTransfer?.getData("text/plain");
    if (!fromId || fromId === event.id || !groupIds.includes(fromId)) return;
    const next = groupIds.slice();
    const fromIdx = next.indexOf(fromId);
    const toIdx = next.indexOf(event.id);
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromId);
    await commit(next);
  });
}
```

- [ ] **Step 4: Add CSS for the mobile move buttons**

In `styles.css`, add directly after the `.yd-event-row.is-drop-target { ... }` rule added in Task 4:

```css
.yd-event-move-buttons {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 0;
}

.yd-event-move-btn {
  width: 18px;
  height: 14px;
  padding: 0;
}
```

- [ ] **Step 5: Run the full test suite and build**

Run: `npm test`
Expected: all tests PASS.

Run: `npm run build`
Expected: bundles without error.

- [ ] **Step 6: Manual verification on mobile (or desktop with mobile emulation)**

Obsidian desktop doesn't let you flip `Platform.isMobile` at runtime easily; verify by either:
- Installing the built plugin in Obsidian Mobile (iOS/Android) and checking the daily events list, or
- Temporarily checking `lib/sections/calendar.js` renders `chevron-up`/`chevron-down` buttons by reading the rendered DOM in the Obsidian desktop dev console: `app.plugins.plugins["habit-dashboard"]` then inspecting, OR simplest — trust the existing project convention (`task-box.js` already branches the same way on `Platform.isMobile` for its add-button visibility and is not separately emulated in this repo's manual test notes either).

1. On mobile, confirm each event row shows up/down chevrons instead of a drag handle.
2. Tap "down" on the first uncompleted event — confirm it swaps with the second uncompleted event and the change persists.
3. Confirm the topmost item in a group has no "up" button, and the bottommost item in a group has no "down" button.
4. Confirm completed events' up/down buttons only reorder within the completed group.

- [ ] **Step 7: Commit**

```bash
git add lib/sections/calendar.js lib/i18n.js styles.css
git commit -m "feat: add mobile up/down reordering for daily events"
```

---

## Plan Self-Review Notes

- Spec coverage: drag reorder (desktop) → Task 4; mobile fallback (up/down buttons) → Task 5; completed-sort-to-bottom (render-only, order untouched) → Tasks 1 & 3; scope limited to main panel only (weekly view untouched) → Task 3's `meta` defaulting keeps `renderWeeklyView`'s existing call site unchanged.
- Cross-group drag/move guarded in both the desktop `drop` handler (`groupIds.includes(fromId)`) and inherently in the mobile branch (buttons only ever swap within the same `groupIds` array).
- `reorderEvents`' mismatch fallback (Task 2, test 3) covers the defensive case where `newOrderIds` somehow doesn't match the bucket exactly (e.g., a stale `groupIds` closure from a concurrent edit) — falls back to the unmodified array rather than corrupting data.
