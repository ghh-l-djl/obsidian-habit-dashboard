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
