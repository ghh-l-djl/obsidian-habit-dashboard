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

Module._resolveFilename = originalResolve;
