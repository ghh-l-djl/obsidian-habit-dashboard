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
  // ci_1 last checked Jun 1, next due Jun 8. Today is Jun 5 — ci_1 hidden.
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
  // ci_1 last checked Jun 1, next due Jun 8. Today is Jun 8 — both shown.
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
