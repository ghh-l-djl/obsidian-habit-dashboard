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
