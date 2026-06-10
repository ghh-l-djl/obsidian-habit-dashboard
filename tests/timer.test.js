"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patched(request, parent, ...rest) {
  if (request === "obsidian") return "obsidian-stub";
  return originalResolve.call(this, request, parent, ...rest);
};

const stubExports = {
  Notice: class { constructor(message) { this.message = message; } }
};
require.cache["obsidian-stub"] = {
  id: "obsidian-stub",
  filename: "obsidian-stub",
  loaded: true,
  exports: stubExports,
  paths: [],
  children: []
};

const store = require("../lib/store");

test("normalizeTimer: returns defaults for null input", () => {
  const result = store.normalizeTimer(null);
  assert.equal(result.durationSeconds, 3600);
  assert.equal(result.remainingSeconds, 3600);
  assert.equal(result.status, "idle");
  assert.equal(result.startedAt, null);
});

test("normalizeTimer: preserves valid running state", () => {
  const now = Date.now();
  const result = store.normalizeTimer({
    durationSeconds: 1800,
    remainingSeconds: 900,
    status: "running",
    startedAt: now
  });
  assert.equal(result.durationSeconds, 1800);
  assert.equal(result.remainingSeconds, 900);
  assert.equal(result.status, "running");
  assert.equal(result.startedAt, now);
});

test("normalizeTimer: clamps durationSeconds below minimum to 60", () => {
  const result = store.normalizeTimer({ durationSeconds: 0, remainingSeconds: 0, status: "idle", startedAt: null });
  assert.equal(result.durationSeconds, 60);
});

test("normalizeTimer: clamps durationSeconds above maximum", () => {
  const result = store.normalizeTimer({ durationSeconds: 999999999, remainingSeconds: 0, status: "idle", startedAt: null });
  assert.equal(result.durationSeconds, 3600 * 999);
});

test("normalizeTimer: rejects invalid status string, falls back to idle", () => {
  const result = store.normalizeTimer({ durationSeconds: 3600, remainingSeconds: 3600, status: "bogus", startedAt: null });
  assert.equal(result.status, "idle");
});

test("normalizeSettings: includes normalized timer block", () => {
  const settings = store.normalizeSettings(null);
  assert.ok(settings.data.timer);
  assert.equal(settings.data.timer.durationSeconds, 3600);
  assert.equal(settings.data.timer.status, "idle");
});

const { formatTimerDisplay, getDashOffset, CIRCUMFERENCE } = require("../lib/sections/timer");

test("formatTimerDisplay: 3600 seconds → '60:00'", () => {
  assert.equal(formatTimerDisplay(3600), "60:00");
});

test("formatTimerDisplay: 90 seconds → '01:30'", () => {
  assert.equal(formatTimerDisplay(90), "01:30");
});

test("formatTimerDisplay: 0 → '00:00'", () => {
  assert.equal(formatTimerDisplay(0), "00:00");
});

test("formatTimerDisplay: negative → '00:00'", () => {
  assert.equal(formatTimerDisplay(-5), "00:00");
});

test("getDashOffset: full remaining → offset 0", () => {
  assert.equal(getDashOffset(3600, 3600), 0);
});

test("getDashOffset: zero remaining → full circumference", () => {
  assert.equal(getDashOffset(0, 3600), CIRCUMFERENCE);
});

test("getDashOffset: half remaining → half circumference", () => {
  const result = getDashOffset(1800, 3600);
  assert.ok(Math.abs(result - CIRCUMFERENCE / 2) < 0.01);
});
