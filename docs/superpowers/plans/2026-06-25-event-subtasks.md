# Event Subtasks Implementation Plan

**Status:** Implemented. This is a historical execution plan; unchecked boxes preserve the original sequence and are not open work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-level child events to daily and weekly event views, with independent notes/status/timers, sibling-scoped ordering, orphan detachment during postponement, and archive origin labels.

**Architecture:** Keep each date's events in the existing flat `dailyEvents[dateKey]` array and use nullable `parentId` to define sibling groups. Pure calendar helpers own grouping, display order, and orphan detection; UI rendering flattens each parent followed by its children. Postponement becomes asynchronous so detached children can persist origin metadata to linked-note frontmatter before the dashboard saves.

**Tech Stack:** Plain CommonJS JavaScript, Obsidian Plugin API, CSS, project i18n dictionary, `node:test`.

---

## File Structure

- `lib/sections/calendar.js`: event grouping/order helpers, child creation, sibling-scoped reorder, day/week rendering, asynchronous postponement, archive line formatting.
- `lib/note-manager.js`: read/write `detachedFromTitle` and `detachedFromDate` frontmatter.
- `lib/date-utils.js`: resolve detached origin fields for archive output.
- `lib/store.js`: preserve `parentId` and detached-origin fields while normalizing saved settings.
- `lib/i18n.js`: child-add and detached-origin labels in Chinese and English.
- `styles.css`: child indentation and hover-only add-child button.
- `main.js`: generated plugin bundle produced by `npm run build`.
- `tests/calendar.test.js`: flat data model, grouped ordering, sibling reorder, orphan detachment, and archive text tests.
- `tests/note-manager.test.js`: detached origin frontmatter read/write tests.
- `tests/date-utils.test.js`: detached origin resolution tests.

## Global Constraints

- Only one child level is exposed in the UI. Child rows never render an add-child button.
- Missing `parentId` is treated as `null`.
- Completion never propagates between parent and child.
- Reordering is restricted to events sharing both normalized `parentId` and completion status.
- Weekly view preserves manual sibling order and does not apply completed-last sorting.
- Existing unrelated `.gitignore` changes remain untouched.

### Task 1: Grouped event data model

**Files:**
- Modify: `tests/calendar.test.js`
- Modify: `lib/sections/calendar.js`
- Modify: `tests/store.test.js`
- Modify: `lib/store.js`

- [ ] **Step 1: Add failing tests for grouped order and creation**

Add tests proving:

```js
const settings = {
  data: {
    dailyEvents: {
      "2026-06-25": [
        { id: "p1", title: "Parent", order: 7 },
        { id: "c1", title: "Child 1", parentId: "p1", order: 8 },
        { id: "c2", title: "Child 2", parentId: "p1", order: 9 },
        { id: "p2", title: "Other", parentId: null, order: 10 }
      ]
    }
  }
};

calendar.setEventList(settings, "2026-06-25", settings.data.dailyEvents["2026-06-25"]);
assert.deepEqual(
  settings.data.dailyEvents["2026-06-25"].map((event) => [event.id, event.order]),
  [["p1", 0], ["c1", 0], ["c2", 1], ["p2", 1]]
);
assert.deepEqual(calendar.getTopLevelEvents(settings, "2026-06-25").map((event) => event.id), ["p1", "p2"]);
assert.deepEqual(calendar.getChildEvents(settings, "2026-06-25", "p1").map((event) => event.id), ["c1", "c2"]);
```

Add a creation test that calls `createEvent(settings, dateKey, "Child 3", "p1")` and asserts `parentId === "p1"` and `order === 2`. Add a legacy-data test proving an event without `parentId` is top-level.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/calendar.test.js`

Expected: failures because `getTopLevelEvents`/`getChildEvents` are missing and `createEvent` ignores `parentId`.

- [ ] **Step 3: Implement grouped storage helpers**

Update `setEventList` to normalize `event.parentId || null` and rewrite `order` independently per sibling group. Add:

```js
function normalizeParentId(event) {
  return event?.parentId || null;
}

function getTopLevelEvents(settings, dateKey) {
  return getEventList(settings, dateKey)
    .filter((event) => normalizeParentId(event) === null)
    .sort((a, b) => a.order - b.order);
}

function getChildEvents(settings, dateKey, parentId) {
  return getEventList(settings, dateKey)
    .filter((event) => normalizeParentId(event) === parentId)
    .sort((a, b) => a.order - b.order);
}
```

Change `createEvent(settings, dateKey, title, parentId = null)` so `order` equals the current sibling count and the new object stores normalized `parentId`.

Extend `normalizeDailyEvents` to retain `parentId`, `detachedFromTitle`, and
`detachedFromDate`, and to reindex `order` independently per sibling group.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/calendar.test.js`

Expected: all calendar tests pass.

### Task 2: Hierarchical display and sibling-scoped reorder

**Files:**
- Modify: `tests/calendar.test.js`
- Modify: `lib/sections/calendar.js`

- [ ] **Step 1: Add failing tests for day/week flattening and reorder isolation**

Add tests for:

```js
calendar.flattenEventHierarchy(settings, dateKey, { completedLast: true });
// top-level undone parents first, then completed parents;
// each parent is immediately followed by its own undone children then completed children.

calendar.flattenEventHierarchy(settings, dateKey, { completedLast: false });
// top-level and child sibling groups retain order regardless of completion.

calendar.reorderEvents(events, "p1", false, ["c2", "c1"]);
// only unfinished children of p1 change order; p2 children and top-level events remain unchanged.
```

Also test that an id from another parent causes the reorder helper to return an unchanged copy.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/calendar.test.js`

Expected: failures for missing `flattenEventHierarchy` and the old `reorderEvents` signature/behavior.

- [ ] **Step 3: Implement hierarchy flattening and scoped reorder**

Add:

```js
function flattenEventHierarchy(settings, dateKey, options) {
  const completedLast = options?.completedLast !== false;
  const orderGroup = completedLast ? orderEventsForDisplay : (events) => events.slice();
  const result = [];
  orderGroup(getTopLevelEvents(settings, dateKey)).forEach((parent) => {
    result.push(parent);
    result.push(...orderGroup(getChildEvents(settings, dateKey, parent.id)));
  });
  return result;
}
```

Change `reorderEvents` to accept `(events, parentId, completed, newOrderIds)`, validate that ids exactly match the target sibling/completion bucket, replace only that bucket, and preserve every event's `parentId`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/calendar.test.js`

Expected: all calendar tests pass.

### Task 3: Orphan detachment during postponement

**Files:**
- Modify: `tests/calendar.test.js`
- Modify: `lib/sections/calendar.js`

- [ ] **Step 1: Add failing tests for split parent/child dates**

Test both split directions:

- completed parent stays today while unfinished child moves tomorrow;
- unfinished parent moves tomorrow while completed child stays today.

For each orphan assert:

```js
assert.equal(orphan.parentId, null);
assert.equal(orphan.detachedFromTitle, "Parent title");
assert.equal(orphan.detachedFromDate, "2026-06-25");
```

Pass a fake `app` and linked `filePath`, then assert `noteManager.updateEventFrontmatter` is called with the two detached fields. Also verify intact parent/child pairs keep their relationship.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/calendar.test.js`

Expected: orphan assertions fail and no detached frontmatter write occurs.

- [ ] **Step 3: Implement detachment and asynchronous postponement**

Add pure `detachOrphans(list, allEventsById, dateKey)` that clears orphan `parentId` and records origin fields. Change:

```js
async function postponeUndoneTomorrow(settings, dateKey, app)
```

Build the original id map before splitting, detach both destination lists, write detached fields for linked files through `noteManager.updateEventFrontmatter`, then call `setEventList` for today and tomorrow. Return `{ moved, nextDateKey, detached }`.

Update both day and week call sites to `await postponeUndoneTomorrow(settings, dateKey, ctx.app)`. Continue updating `date` frontmatter for moved events.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/calendar.test.js`

Expected: all calendar tests pass.

### Task 4: Detached frontmatter and archive resolution

**Files:**
- Modify: `tests/note-manager.test.js`
- Modify: `lib/note-manager.js`
- Modify: `tests/date-utils.test.js`
- Modify: `lib/date-utils.js`

- [ ] **Step 1: Add failing frontmatter tests**

Extend the existing `getEventFrontmatter` expected object with:

```js
detachedFromTitle: "Parent title",
detachedFromDate: "2026-06-25"
```

Add a test using a fake `processFrontMatter` callback to prove:

```js
await noteManager.updateEventFrontmatter(app, file.path, {
  detachedFromTitle: "Parent title",
  detachedFromDate: "2026-06-25"
});
```

writes both keys, and `null` clears them to YAML `null`.

- [ ] **Step 2: Add failing archive-resolution tests**

Extend `resolveArchivedEventFields` tests so frontmatter values win per field and event values are fallback values for `detachedFromTitle` and `detachedFromDate`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test tests/note-manager.test.js tests/date-utils.test.js`

Expected: detached fields are absent.

- [ ] **Step 4: Implement frontmatter read/write and resolution**

Add the two guarded assignments to `updateEventFrontmatter`, return both fields from `getEventFrontmatter`, and include both fallback-resolved fields in `resolveArchivedEventFields`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test tests/note-manager.test.js tests/date-utils.test.js`

Expected: all selected tests pass.

### Task 5: Archive origin label

**Files:**
- Modify: `tests/calendar.test.js`
- Modify: `lib/sections/calendar.js`
- Modify: `tests/i18n.test.js`
- Modify: `lib/i18n.js`

- [ ] **Step 1: Add failing archive-line and translation tests**

Add an exported pure helper test:

```js
const line = calendar.formatArchivedEventLine({
  event: { title: "Child", filePath: null },
  hasNotes: false,
  resolved: {
    completed: false,
    startedAt: null,
    completedAt: null,
    detachedFromTitle: "Parent",
    detachedFromDate: "2026-06-25"
  },
  t: (key, vars) => key === "calendar.detachedFromLabel"
    ? `originally part of "${vars.title}" (${vars.date})`
    : key
});
assert.equal(line, '- [ ] Child ⤷ originally part of "Parent" (2026-06-25)');
```

Add i18n assertions for `calendar.addSubEvent` and `calendar.detachedFromLabel`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/calendar.test.js tests/i18n.test.js`

Expected: helper/translation failures.

- [ ] **Step 3: Implement archive formatting and translations**

Extract the archive row construction into `formatArchivedEventLine`, append the translated origin suffix only when `resolved.detachedFromTitle` exists, and use it from `archiveWeek`. Add both Chinese and English keys from the design document.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/calendar.test.js tests/i18n.test.js`

Expected: all selected tests pass.

### Task 6: Day and weekly rendering

**Files:**
- Modify: `lib/sections/calendar.js`

- [ ] **Step 1: Render the hierarchy in both views**

In `renderDayEvents`, replace raw event ordering with:

```js
const ordered = flattenEventHierarchy(settings, dateKey, { completedLast: true });
```

For every row compute group ids from events sharing normalized `parentId` and completion status. Pass:

```js
{
  isChild: normalizeParentId(event) !== null,
  groupIds
}
```

In `renderWeeklyView`, use `flattenEventHierarchy(settings, dateKey, { completedLast: false })` and render the same child class. Do not add reorder controls to weekly rows.

- [ ] **Step 2: Add child-row class and parent-only add button**

In `renderEventRow`, add `yd-event-row--child` when `meta.isChild`. For top-level rows only, create an icon button with `calendar.addSubEvent`, hide it while editing, and call:

```js
renderInlineEditor(row.parentElement, "", async (value) => {
  const child = createEvent(settings, dateKey, value, event.id);
  // create linked event note, rollback on failure, save, refresh
});
```

Insert the editor immediately after the current row so it appears before existing child rows. Child rows do not render this button.

- [ ] **Step 3: Restrict drag/mobile movement to sibling groups**

Pass `parentId` into `renderReorderControl` and call:

```js
reorderEvents(events, normalizeParentId(event), !!event.completed, newGroupIds)
```

The existing `groupIds.includes(fromId)` guard remains the cross-group drop protection.

- [ ] **Step 4: Run calendar tests**

Run: `node --test tests/calendar.test.js`

Expected: all calendar tests pass.

### Task 7: CSS and final integration

**Files:**
- Modify: `styles.css`
- Modify: `lib/i18n.js`

- [ ] **Step 1: Add child indentation and add-button styling**

Add:

```css
.yd-event-row--child {
  margin-left: 20px;
}

.yd-event-add-child {
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.yd-event-row:hover .yd-event-add-child,
.yd-event-row:focus-within .yd-event-add-child {
  opacity: 1;
  pointer-events: auto;
}
```

Use existing icon-button sizing/color variables so the new control matches drag handles and works in dark mode.

- [ ] **Step 2: Run full automated verification**

Run:

```bash
npm test
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 3: Review spec coverage and diff**

Run:

```bash
git diff --check
git diff --stat
git status --short
```

Confirm all design requirements are represented and `.gitignore` remains an unrelated user change.

- [ ] **Step 4: Commit implementation**

```bash
git add docs/superpowers/plans/2026-06-25-event-subtasks.md \
  lib/sections/calendar.js lib/note-manager.js lib/date-utils.js lib/store.js lib/i18n.js \
  main.js styles.css tests/calendar.test.js tests/note-manager.test.js \
  tests/date-utils.test.js tests/store.test.js tests/i18n.test.js
git commit -m "feat: add one-level event subtasks"
```
