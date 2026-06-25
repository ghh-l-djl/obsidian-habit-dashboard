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
const noteManager = require("../lib/note-manager");

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
  const result = calendar.reorderEvents(events, null, false, ["b", "a"]);
  assert.deepEqual(result.map((e) => e.id), ["b", "a", "c"]);
});

test("reorderEvents keeps uncompleted bucket before completed bucket when reordering completed", () => {
  const events = [
    { id: "a", completed: false },
    { id: "b", completed: true },
    { id: "c", completed: true }
  ];
  const result = calendar.reorderEvents(events, null, true, ["c", "b"]);
  assert.deepEqual(result.map((e) => e.id), ["a", "c", "b"]);
});

test("reorderEvents falls back to original array when newOrderIds doesn't match the bucket", () => {
  const events = [
    { id: "a", completed: false },
    { id: "b", completed: false }
  ];
  const result = calendar.reorderEvents(events, null, false, ["a", "z"]);
  assert.deepEqual(result.map((e) => e.id), ["a", "b"]);
});

test("reorderEvents does not mutate the input array", () => {
  const events = [
    { id: "a", completed: false },
    { id: "b", completed: false }
  ];
  const original = events.slice();
  calendar.reorderEvents(events, null, false, ["b", "a"]);
  assert.deepEqual(events, original);
});

test("setEventList rewrites order independently for each parent group", () => {
  const dateKey = "2026-06-25";
  const settings = {
    data: {
      dailyEvents: {
        [dateKey]: [
          { id: "p1", title: "Parent", order: 7 },
          { id: "c1", title: "Child 1", parentId: "p1", order: 8 },
          { id: "c2", title: "Child 2", parentId: "p1", order: 9 },
          { id: "p2", title: "Other", parentId: null, order: 10 }
        ]
      }
    }
  };

  calendar.setEventList(settings, dateKey, settings.data.dailyEvents[dateKey]);

  assert.deepEqual(
    settings.data.dailyEvents[dateKey].map((event) => [event.id, event.order]),
    [["p1", 0], ["c1", 0], ["c2", 1], ["p2", 1]]
  );
});

test("top-level and child event helpers treat missing parentId as top-level", () => {
  const dateKey = "2026-06-25";
  const settings = {
    data: {
      dailyEvents: {
        [dateKey]: [
          { id: "p2", parentId: null, order: 1 },
          { id: "c2", parentId: "p1", order: 1 },
          { id: "p1", order: 0 },
          { id: "c1", parentId: "p1", order: 0 }
        ]
      }
    }
  };

  assert.deepEqual(calendar.getTopLevelEvents(settings, dateKey).map((event) => event.id), ["p1", "p2"]);
  assert.deepEqual(calendar.getChildEvents(settings, dateKey, "p1").map((event) => event.id), ["c1", "c2"]);
});

test("createEvent assigns parentId and order within its sibling group", () => {
  const dateKey = "2026-06-25";
  const settings = {
    data: {
      dailyEvents: {
        [dateKey]: [
          { id: "p1", parentId: null, order: 0 },
          { id: "c1", parentId: "p1", order: 0 },
          { id: "c2", parentId: "p1", order: 1 }
        ]
      }
    }
  };

  const child = calendar.createEvent(settings, dateKey, "Child 3", "p1");

  assert.equal(child.parentId, "p1");
  assert.equal(child.order, 2);
});

test("flattenEventHierarchy keeps children after their parent and sorts completion within sibling groups", () => {
  const dateKey = "2026-06-25";
  const settings = {
    data: {
      dailyEvents: {
        [dateKey]: [
          { id: "p1", parentId: null, completed: true, order: 0 },
          { id: "c1", parentId: "p1", completed: true, order: 0 },
          { id: "c2", parentId: "p1", completed: false, order: 1 },
          { id: "p2", parentId: null, completed: false, order: 1 },
          { id: "c3", parentId: "p2", completed: false, order: 0 }
        ]
      }
    }
  };

  const result = calendar.flattenEventHierarchy(settings, dateKey, { completedLast: true });

  assert.deepEqual(result.map((event) => event.id), ["p2", "c3", "p1", "c2", "c1"]);
});

test("flattenEventHierarchy preserves sibling order in weekly mode", () => {
  const dateKey = "2026-06-25";
  const settings = {
    data: {
      dailyEvents: {
        [dateKey]: [
          { id: "p1", parentId: null, completed: true, order: 0 },
          { id: "c1", parentId: "p1", completed: true, order: 0 },
          { id: "c2", parentId: "p1", completed: false, order: 1 },
          { id: "p2", parentId: null, completed: false, order: 1 }
        ]
      }
    }
  };

  const result = calendar.flattenEventHierarchy(settings, dateKey, { completedLast: false });

  assert.deepEqual(result.map((event) => event.id), ["p1", "c1", "c2", "p2"]);
});

test("reorderEvents changes only the matching parent and completion bucket", () => {
  const events = [
    { id: "p1", parentId: null, completed: false },
    { id: "c1", parentId: "p1", completed: false },
    { id: "c2", parentId: "p1", completed: false },
    { id: "d1", parentId: "p1", completed: true },
    { id: "x1", parentId: "p2", completed: false }
  ];

  const result = calendar.reorderEvents(events, "p1", false, ["c2", "c1"]);

  assert.deepEqual(result.map((event) => event.id), ["p1", "c2", "c1", "d1", "x1"]);
});

test("reorderEvents rejects ids from another parent group", () => {
  const events = [
    { id: "c1", parentId: "p1", completed: false },
    { id: "c2", parentId: "p1", completed: false },
    { id: "x1", parentId: "p2", completed: false }
  ];

  const result = calendar.reorderEvents(events, "p1", false, ["c2", "x1"]);

  assert.deepEqual(result.map((event) => event.id), ["c1", "c2", "x1"]);
});

test("postponeUndoneTomorrow detaches a moved child from a completed parent", async () => {
  const dateKey = "2026-06-25";
  const nextDateKey = "2026-06-26";
  const settings = {
    data: {
      dailyEvents: {
        [dateKey]: [
          { id: "p1", title: "Parent", parentId: null, completed: true, order: 0 },
          {
            id: "c1",
            title: "Child",
            parentId: "p1",
            completed: false,
            order: 0,
            filePath: "Habit Dashboard/Events/child.md"
          }
        ]
      }
    }
  };
  const calls = [];
  const originalUpdate = noteManager.updateEventFrontmatter;
  noteManager.updateEventFrontmatter = async (...args) => calls.push(args);
  try {
    await calendar.postponeUndoneTomorrow(settings, dateKey, {});
  } finally {
    noteManager.updateEventFrontmatter = originalUpdate;
  }

  const child = settings.data.dailyEvents[nextDateKey][0];
  assert.equal(child.parentId, null);
  assert.equal(child.detachedFromTitle, "Parent");
  assert.equal(child.detachedFromDate, dateKey);
  assert.deepEqual(calls[0][2], {
    detachedFromTitle: "Parent",
    detachedFromDate: dateKey
  });
});

test("postponeUndoneTomorrow detaches a completed child from a moved parent", async () => {
  const dateKey = "2026-06-25";
  const settings = {
    data: {
      dailyEvents: {
        [dateKey]: [
          { id: "p1", title: "Parent", parentId: null, completed: false, order: 0 },
          { id: "c1", title: "Child", parentId: "p1", completed: true, order: 0 }
        ]
      }
    }
  };

  await calendar.postponeUndoneTomorrow(settings, dateKey, {});

  const child = settings.data.dailyEvents[dateKey][0];
  assert.equal(child.parentId, null);
  assert.equal(child.detachedFromTitle, "Parent");
  assert.equal(child.detachedFromDate, dateKey);
});

test("postponeUndoneTomorrow preserves parentId when parent and child move together", async () => {
  const dateKey = "2026-06-25";
  const settings = {
    data: {
      dailyEvents: {
        [dateKey]: [
          { id: "p1", title: "Parent", parentId: null, completed: false, order: 0 },
          { id: "c1", title: "Child", parentId: "p1", completed: false, order: 0 }
        ]
      }
    }
  };

  await calendar.postponeUndoneTomorrow(settings, dateKey, {});

  const child = settings.data.dailyEvents["2026-06-26"].find((event) => event.id === "c1");
  assert.equal(child.parentId, "p1");
  assert.equal(child.detachedFromTitle, undefined);
});

test("postponeUndoneTomorrow does not rewrite pre-existing events on the destination date", async () => {
  const dateKey = "2026-06-25";
  const settings = {
    data: {
      dailyEvents: {
        [dateKey]: [
          { id: "p1", title: "Parent", parentId: null, completed: false, order: 0 }
        ],
        "2026-06-26": [
          { id: "existing", title: "Existing child", parentId: "other-parent", completed: false, order: 0 }
        ]
      }
    }
  };

  await calendar.postponeUndoneTomorrow(settings, dateKey, {});

  const existing = settings.data.dailyEvents["2026-06-26"]
    .find((event) => event.id === "existing");
  assert.equal(existing.parentId, "other-parent");
  assert.equal(existing.detachedFromDate, undefined);
});

test("formatArchivedEventLine appends detached origin information", () => {
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
});

test("formatArchivedEventLine keeps linked-note formatting without detached origin", () => {
  const line = calendar.formatArchivedEventLine({
    event: {
      title: "Event",
      filePath: "Habit Dashboard/Events/2026-06-25-event.md"
    },
    hasNotes: true,
    resolved: {
      completed: true,
      startedAt: null,
      completedAt: null
    },
    t: () => ""
  });

  assert.equal(line, "- [x] [[Habit Dashboard/Events/2026-06-25-event|Event]]");
});
