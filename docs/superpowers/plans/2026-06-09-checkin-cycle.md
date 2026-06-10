# Check-in Cycle Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-item `cycleDays` field to check-in items so that an item only appears on the main dashboard after `cycleDays` days have elapsed since the last check-in; settings UI lets the user configure it.

**Architecture:** Pure-logic functions (`getLastCheckInDateKey`, `isItemDueToday`, `getVisibleItems`) are added to `check-in.js` and driven by existing `records` data — no extra stored state. `store.js` normalizes the new field. The settings row gains a compact number input. Build is `node scripts/bundle.js`.

**Tech Stack:** Node.js CommonJS, Obsidian Plugin API (UI only), custom bundler (`scripts/bundle.js`), Node built-in test runner.

---

## File Map

| File | Change |
|------|--------|
| `lib/store.js` | `normalizeCheckIn` — preserve `cycleDays`, default to 1 |
| `lib/i18n.js` | Add `checkIn.cycleDays` in zh + en |
| `lib/sections/check-in.js` | Add 3 logic fns, update `renderCheckInSection`, update `renderCheckInSettings` |
| `styles.css` | Add `.yd-checkin-cycle-wrap`, `.yd-checkin-cycle-input`, `.yd-checkin-cycle-label` |
| `tests/store.test.js` | Add `cycleDays` normalization test |
| `tests/check-in.test.js` | New — tests for 3 logic fns |

---

### Task 1: Normalize cycleDays in store.js

**Files:**
- Modify: `lib/store.js:102-112` (inside `normalizeCheckIn`, the `items` map)
- Test: `tests/store.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/store.test.js`:

```js
test("normalizeCheckIn defaults cycleDays to 1 when missing", () => {
  const settings = store.normalizeSettings({
    data: {
      checkIn: {
        items: [{ id: "ci_1", name: "Run", color: "#af9165", order: 0 }],
        records: {}
      }
    }
  });
  assert.equal(settings.data.checkIn.items[0].cycleDays, 1);
});

test("normalizeCheckIn preserves valid cycleDays", () => {
  const settings = store.normalizeSettings({
    data: {
      checkIn: {
        items: [{ id: "ci_1", name: "Run", color: "#af9165", order: 0, cycleDays: 7 }],
        records: {}
      }
    }
  });
  assert.equal(settings.data.checkIn.items[0].cycleDays, 7);
});

test("normalizeCheckIn clamps invalid cycleDays to 1", () => {
  const settings = store.normalizeSettings({
    data: {
      checkIn: {
        items: [{ id: "ci_1", name: "Run", color: "#af9165", order: 0, cycleDays: 0 }],
        records: {}
      }
    }
  });
  assert.equal(settings.data.checkIn.items[0].cycleDays, 1);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test tests/store.test.js
```

Expected: 3 new tests fail with `cycleDays` undefined or wrong.

- [ ] **Step 3: Implement — add cycleDays to normalizeCheckIn item map**

In `lib/store.js`, find `normalizeCheckIn`. The items map currently reads:

```js
const items = ensureArray(block.items).map((item, idx) => ({
  id: item && typeof item.id === "string" && item.id ? item.id : `ci_${Date.now()}_${idx}`,
  name: typeof item?.name === "string" ? item.name : "",
  color: typeof item?.color === "string" ? item.color : "#af9165",
  order: Number.isFinite(item?.order) ? item.order : idx
}));
```

Replace with:

```js
const items = ensureArray(block.items).map((item, idx) => ({
  id: item && typeof item.id === "string" && item.id ? item.id : `ci_${Date.now()}_${idx}`,
  name: typeof item?.name === "string" ? item.name : "",
  color: typeof item?.color === "string" ? item.color : "#af9165",
  order: Number.isFinite(item?.order) ? item.order : idx,
  cycleDays: Number.isFinite(item?.cycleDays) && item.cycleDays >= 1 ? Math.floor(item.cycleDays) : 1
}));
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
node --test tests/store.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/store.js tests/store.test.js
git commit -m "feat: add cycleDays field to check-in item normalization"
```

---

### Task 2: Add i18n keys

**Files:**
- Modify: `lib/i18n.js`

- [ ] **Step 1: Add zh key**

In `lib/i18n.js`, inside the `zh` block, after `"checkIn.addActivity"`:

```js
"checkIn.cycleDays": "天",
```

- [ ] **Step 2: Add en key**

In `lib/i18n.js`, inside the `en` block, after `"checkIn.addActivity"`:

```js
"checkIn.cycleDays": "days",
```

- [ ] **Step 3: Run i18n tests to confirm no regression**

```bash
node --test tests/i18n.test.js
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add lib/i18n.js
git commit -m "feat: add checkIn.cycleDays i18n key"
```

---

### Task 3: Add pure logic functions to check-in.js

**Files:**
- Modify: `lib/sections/check-in.js`
- Test: `tests/check-in.test.js` (new file)

The three functions to add:

- `getLastCheckInDateKey(settings, itemId)` — returns the most recent `true` dateKey in records, or `null`
- `isItemDueToday(settings, item, now)` — returns `true` if the item is due today
- `getVisibleItems(settings, focusDateKey, now)` — returns items filtered by cycle when viewing today

- [ ] **Step 1: Create the test file with failing tests**

Create `tests/check-in.test.js`:

```js
"use strict";

// Mock obsidian and obsidian-dependent modules before any require
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
      setIcon: () => {}
    };
  }
  return realLoad(id, parent, isMain);
};

const test = require("node:test");
const assert = require("node:assert/strict");
const checkIn = require("../lib/sections/check-in");

function makeSettings(items, records) {
  return { data: { checkIn: { items, records } } };
}

// getLastCheckInDateKey

test("getLastCheckInDateKey returns null when no records for item", () => {
  const s = makeSettings([], {});
  assert.equal(checkIn.getLastCheckInDateKey(s, "ci_1"), null);
});

test("getLastCheckInDateKey returns the most recent true dateKey", () => {
  const s = makeSettings([], {
    ci_1: { "2026-06-01": true, "2026-06-05": true, "2026-06-03": true }
  });
  assert.equal(checkIn.getLastCheckInDateKey(s, "ci_1"), "2026-06-05");
});

test("getLastCheckInDateKey ignores false records", () => {
  const s = makeSettings([], {
    ci_1: { "2026-06-01": true, "2026-06-05": false }
  });
  assert.equal(checkIn.getLastCheckInDateKey(s, "ci_1"), "2026-06-01");
});

test("getLastCheckInDateKey returns null when all records are false", () => {
  const s = makeSettings([], {
    ci_1: { "2026-06-01": false, "2026-06-05": false }
  });
  assert.equal(checkIn.getLastCheckInDateKey(s, "ci_1"), null);
});

// isItemDueToday

test("isItemDueToday returns true for cycleDays=1 regardless of history", () => {
  const s = makeSettings([], { ci_1: { "2026-06-08": true } });
  const item = { id: "ci_1", cycleDays: 1 };
  assert.equal(checkIn.isItemDueToday(s, item, new Date("2026-06-09")), true);
});

test("isItemDueToday returns true when no check-in history (first time)", () => {
  const s = makeSettings([], {});
  const item = { id: "ci_1", cycleDays: 7 };
  assert.equal(checkIn.isItemDueToday(s, item, new Date("2026-06-09")), true);
});

test("isItemDueToday returns false when in cooldown", () => {
  // Last check-in Jun 1, cycleDays=7, next due Jun 8. Today is Jun 5.
  const s = makeSettings([], { ci_1: { "2026-06-01": true } });
  const item = { id: "ci_1", cycleDays: 7 };
  assert.equal(checkIn.isItemDueToday(s, item, new Date("2026-06-05")), false);
});

test("isItemDueToday returns true on exact due date", () => {
  // Last check-in Jun 1, cycleDays=7, next due Jun 8. Today is Jun 8.
  const s = makeSettings([], { ci_1: { "2026-06-01": true } });
  const item = { id: "ci_1", cycleDays: 7 };
  assert.equal(checkIn.isItemDueToday(s, item, new Date("2026-06-08")), true);
});

test("isItemDueToday returns true after due date has passed", () => {
  // Last check-in Jun 1, cycleDays=7, next due Jun 8. Today is Jun 10.
  const s = makeSettings([], { ci_1: { "2026-06-01": true } });
  const item = { id: "ci_1", cycleDays: 7 };
  assert.equal(checkIn.isItemDueToday(s, item, new Date("2026-06-10")), true);
});

// getVisibleItems

test("getVisibleItems shows all non-deleted items on a historical date", () => {
  const items = [
    { id: "ci_1", name: "A", color: "#fff", order: 0, cycleDays: 7 },
    { id: "ci_2", name: "B", color: "#fff", order: 1, cycleDays: 1 }
  ];
  const records = { ci_1: { "2026-06-01": true } };
  const s = makeSettings(items, records);
  // focusDate is May 15 (historical), now is June 9 (ci_1 would be in cooldown)
  const visible = checkIn.getVisibleItems(s, "2026-05-15", new Date("2026-06-09"));
  assert.equal(visible.length, 2);
});

test("getVisibleItems hides cooldown items when viewing today", () => {
  const items = [
    { id: "ci_1", name: "A", color: "#fff", order: 0, cycleDays: 7 },
    { id: "ci_2", name: "B", color: "#fff", order: 1, cycleDays: 1 }
  ];
  // ci_1 last checked Jun 1, next due Jun 8. Today is Jun 5 → ci_1 hidden.
  const records = { ci_1: { "2026-06-01": true } };
  const s = makeSettings(items, records);
  const now = new Date("2026-06-05");
  const visible = checkIn.getVisibleItems(s, "2026-06-05", now);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, "ci_2");
});

test("getVisibleItems shows due item on today", () => {
  const items = [
    { id: "ci_1", name: "A", color: "#fff", order: 0, cycleDays: 7 },
    { id: "ci_2", name: "B", color: "#fff", order: 1, cycleDays: 1 }
  ];
  // ci_1 last checked Jun 1, next due Jun 8. Today is Jun 8 → both shown.
  const records = { ci_1: { "2026-06-01": true } };
  const s = makeSettings(items, records);
  const now = new Date("2026-06-08");
  const visible = checkIn.getVisibleItems(s, "2026-06-08", now);
  assert.equal(visible.length, 2);
});

test("getVisibleItems excludes deleted items regardless of date", () => {
  const items = [
    { id: "ci_1", name: "A", color: "#fff", order: 0, cycleDays: 1, deleted: true },
    { id: "ci_2", name: "B", color: "#fff", order: 1, cycleDays: 1 }
  ];
  const s = makeSettings(items, {});
  const now = new Date("2026-06-09");
  const visible = checkIn.getVisibleItems(s, "2026-06-09", now);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, "ci_2");
});
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
node --test tests/check-in.test.js
```

Expected: all tests fail — functions not exported yet.

- [ ] **Step 3: Add the three functions to check-in.js**

In `lib/sections/check-in.js`, after the existing `countMonth` function (line 52) and before `renderCheckInSection` (line 54), insert:

```js
function getLastCheckInDateKey(settings, itemId) {
  const map = settings?.data?.checkIn?.records?.[itemId] || {};
  let last = null;
  for (const key of Object.keys(map)) {
    if (!map[key]) continue;
    if (!last || key > last) last = key;
  }
  return last;
}

function isItemDueToday(settings, item, now) {
  const cycleDays = item.cycleDays || 1;
  if (cycleDays <= 1) return true;
  const last = getLastCheckInDateKey(settings, item.id);
  if (!last) return true;
  return diffDaysSince(last, now || new Date()) >= cycleDays;
}

function getVisibleItems(settings, focusDateKey, now) {
  const nowDate = now || new Date();
  const todayStr = formatDateKey(nowDate);
  if (focusDateKey && focusDateKey !== todayStr) return getItems(settings);
  return getItems(settings).filter((item) => isItemDueToday(settings, item, nowDate));
}
```

Also add `diffDaysSince` to the existing destructured import from `../date-utils` at the top of the file. The current import is:

```js
const {
  formatDateKey,
  parseMonthKey,
  getDaysInMonth,
  shiftMonth,
  pad2
} = require("../date-utils");
```

Change to:

```js
const {
  formatDateKey,
  parseMonthKey,
  getDaysInMonth,
  shiftMonth,
  pad2,
  diffDaysSince
} = require("../date-utils");
```

- [ ] **Step 4: Export the three functions**

In `lib/sections/check-in.js`, update the `module.exports` at the bottom:

```js
module.exports = {
  render: renderCheckInSection,
  openSettings: openCheckInSettings,
  openMonthly: openCheckInMonthly,
  getItems,
  getVisibleItems,
  isChecked,
  setChecked,
  countMonth,
  getLastCheckInDateKey,
  isItemDueToday
};
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
node --test tests/check-in.test.js
```

Expected: all 14 tests pass.

- [ ] **Step 6: Run full test suite to confirm no regressions**

```bash
node --test tests/*.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/sections/check-in.js tests/check-in.test.js
git commit -m "feat: add getLastCheckInDateKey, isItemDueToday, getVisibleItems"
```

---

### Task 4: Wire getVisibleItems into renderCheckInSection

**Files:**
- Modify: `lib/sections/check-in.js:68-70`

- [ ] **Step 1: Replace getItems with getVisibleItems in renderCheckInSection**

In `lib/sections/check-in.js`, inside `renderCheckInSection`, find:

```js
const items = getItems(settings);
```

Replace with:

```js
const items = getVisibleItems(settings, dateKey);
```

(No `now` argument needed in production — defaults to `new Date()`.)

- [ ] **Step 2: Build and verify**

```bash
node scripts/bundle.js
```

Expected output: `bundled N modules → main.js (NNN KB)`

- [ ] **Step 3: Run full test suite**

```bash
node --test tests/*.test.js
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/sections/check-in.js main.js
git commit -m "feat: apply cycle filtering to check-in main section"
```

---

### Task 5: Add cycle input to settings UI

**Files:**
- Modify: `lib/sections/check-in.js` — `renderCheckInSettings`
- Modify: `styles.css`

The settings row currently has 4 DOM children mapped to 5 CSS grid columns (`28px auto 1fr auto auto`). The 5th column is currently unused. We insert a cycle wrap div as the 4th child so delete button becomes the 5th.

- [ ] **Step 1: Add CSS for the cycle control**

In `styles.css`, find the `/* ====== check-in monthly ====== */` comment (around line 1671). Just before it, insert:

```css
.yd-checkin-cycle-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}

.yd-checkin-cycle-input {
  width: 52px;
  border: 1px solid var(--yd-border);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 14px;
  color: var(--yd-text);
  outline: none;
  background-color: transparent;
  -moz-appearance: textfield;
}

.yd-checkin-cycle-input::-webkit-outer-spin-button,
.yd-checkin-cycle-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
}

.yd-checkin-cycle-input:focus {
  border-color: var(--yd-accent-deep);
}

.yd-checkin-cycle-label {
  font-size: 12px;
  color: var(--yd-text-muted);
  white-space: nowrap;
}
```

- [ ] **Step 2: Add the cycle input DOM in renderCheckInSettings**

In `lib/sections/check-in.js`, inside `renderCheckInSettings`, find the block that builds the name `input` and `delBtn` for each item. The current code ends with:

```js
    const input = row.createEl("input", { type: "text", cls: "yd-settings-input" });
    input.value = item.name;
    input.placeholder = t("checkIn.activityName");
    input.onchange = async () => {
      item.name = input.value.trim();
      await ctx.save();
    };
    const delBtn = createIconButton(row, "x", {
```

Insert the cycle wrap **between** the name input block and the `delBtn` line:

```js
    const cycleWrap = row.createDiv({ cls: "yd-checkin-cycle-wrap" });
    const cycleInput = cycleWrap.createEl("input", { type: "number", cls: "yd-checkin-cycle-input" });
    cycleInput.min = "1";
    cycleInput.max = "365";
    cycleInput.value = String(item.cycleDays || 1);
    cycleWrap.createSpan({ cls: "yd-checkin-cycle-label", text: t("checkIn.cycleDays") });
    cycleInput.onchange = async () => {
      const v = parseInt(cycleInput.value, 10);
      item.cycleDays = Number.isFinite(v) && v >= 1 ? Math.min(v, 365) : 1;
      cycleInput.value = String(item.cycleDays);
      await ctx.save();
    };
```

- [ ] **Step 3: Build**

```bash
node scripts/bundle.js
```

Expected: clean output.

- [ ] **Step 4: Copy bundle to Obsidian plugin folder and test manually**

```bash
cp main.js /Users/ghh/Documents/A第二大脑/.obsidian/plugins/yori-dashboard/main.js
```

Open Obsidian, go to Check-in settings. Verify:
- Each item row shows a number input with current cycle value (default 1)
- Changing a value saves correctly (reopen settings, value persists)
- An item with cycle=7 disappears from the main dashboard after checking in today, reappears 7 days later (can verify by manually editing a record date in devtools or by temporarily setting cycleDays=1 for a sanity check)

- [ ] **Step 5: Run full test suite**

```bash
node --test tests/*.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/sections/check-in.js styles.css main.js
git commit -m "feat: add cycle days input to check-in settings UI"
```
