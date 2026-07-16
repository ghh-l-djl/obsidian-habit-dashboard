# Timer Section Implementation Plan

**Status:** Implemented. This is a historical execution plan; unchecked boxes preserve the original sequence and are not open work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone 60-minute countdown timer as a `yd-section` card in the left column of the dashboard, with SVG progress ring, click-to-edit duration, state persistence across closes, and a system notification on completion.

**Architecture:** New `lib/sections/timer.js` section module with self-contained UI and interval logic; timer state persisted in `settings.data.timer`; interval reference stored on `plugin._timerInterval` to survive DOM rebuilds; all pure utility functions tested with Node.js built-in test runner.

**Tech Stack:** CommonJS JS, Node.js `node:test` + `node:assert/strict`, Obsidian plugin API (`Notice`), custom bundle script (`node scripts/bundle.js`)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/constants.js` | Modify | Add `DEFAULT_SETTINGS.showSection.timer`, `DEFAULT_SETTINGS.data.timer` |
| `lib/store.js` | Modify | Add `normalizeTimer()`, call in `normalizeSettings()`, export it |
| `lib/i18n.js` | Modify | Add timer translation keys in both `zh` and `en` blocks |
| `lib/sections/timer.js` | Create | Timer section UI, interval logic, event wiring |
| `src/main.js` | Modify | Import timer section, render in left column, add settings toggle |
| `styles.css` | Modify | Add `.yd-timer-*` CSS classes |
| `tests/timer.test.js` | Create | Tests for `normalizeTimer`, `formatTimerDisplay`, `getDashOffset` |

---

## Task 1: Add timer defaults to constants

**Files:**
- Modify: `lib/constants.js`

- [ ] **Step 1: Add `timer: true` to showSection in DEFAULT_SETTINGS**

In `lib/constants.js`, find the `showSection` object (around line 76) and add `timer: true`:

```js
showSection: {
  calendar: true,
  dataLog: true,
  taskBox: true,
  checkIn: true,
  dailyMoments: true,
  monthlyPlanner: true,
  quickEntries: true,
  timer: true
},
```

- [ ] **Step 2: Add `timer` key to the `data` block in DEFAULT_SETTINGS**

Find the `data:` block (around line 89). After the `quickEntries` entry, add:

```js
    quickEntries: {
      left: DEFAULT_QUICK_ENTRIES_LEFT,
      right: DEFAULT_QUICK_ENTRIES_RIGHT
    },
    timer: {
      durationSeconds: 3600,
      remainingSeconds: 3600,
      status: "idle",
      startedAt: null
    }
```

- [ ] **Step 3: Verify syntax**

```bash
node -e "require('./lib/constants')" && echo "OK"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add lib/constants.js
git commit -m "feat(timer): add timer defaults to constants"
```

---

## Task 2: Add normalizeTimer to store (TDD)

**Files:**
- Create: `tests/timer.test.js`
- Modify: `lib/store.js`

- [ ] **Step 1: Write failing tests**

Create `tests/timer.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test tests/timer.test.js
```
Expected: failures mentioning `store.normalizeTimer is not a function`

- [ ] **Step 3: Implement normalizeTimer in store.js**

In `lib/store.js`, add this function immediately before the `normalizeSettings` function:

```js
const VALID_TIMER_STATUSES = new Set(["idle", "running", "paused", "done"]);

function normalizeTimer(data) {
  const block = isPlainObject(data) ? data : {};
  const MIN_SECS = 60;
  const MAX_SECS = 3600 * 999;

  let duration = Number.isFinite(block.durationSeconds) ? block.durationSeconds : 3600;
  if (duration < MIN_SECS) duration = MIN_SECS;
  if (duration > MAX_SECS) duration = MAX_SECS;

  let remaining = Number.isFinite(block.remainingSeconds) ? block.remainingSeconds : duration;
  if (remaining < 0) remaining = 0;
  if (remaining > duration) remaining = duration;

  const status = VALID_TIMER_STATUSES.has(block.status) ? block.status : "idle";
  const startedAt = Number.isFinite(block.startedAt) ? block.startedAt : null;

  return { durationSeconds: duration, remainingSeconds: remaining, status, startedAt };
}
```

- [ ] **Step 4: Call normalizeTimer in normalizeSettings**

In `normalizeSettings`, find the line:
```js
  merged.data.quickEntries = normalizeQuickEntries(merged.data.quickEntries);
```
Add immediately after it:
```js
  merged.data.timer = normalizeTimer(merged.data.timer);
```

- [ ] **Step 5: Export normalizeTimer**

In `lib/store.js`, find `module.exports` (current exports end with `makeId`). Add `normalizeTimer` to the exports:

```js
module.exports = {
  deepClone,
  isPlainObject,
  mergeDefaults,
  normalizeTimer,
  normalizeSettings,
  normalizeDailyEvents,
  normalizeDataLog,
  normalizeTaskBox,
  normalizeCheckIn,
  normalizeDailyMoments,
  normalizeMonthlyPlanner,
  normalizeQuickEntries,
  normalizeSectionOrder,
  makeId
};
```

- [ ] **Step 6: Run tests — must all pass**

```bash
node --test tests/timer.test.js
```
Expected: all 6 tests pass

- [ ] **Step 7: Run full test suite**

```bash
node --test tests/*.test.js
```
Expected: all tests pass, no regressions

- [ ] **Step 8: Commit**

```bash
git add tests/timer.test.js lib/store.js
git commit -m "feat(timer): add normalizeTimer with tests"
```

---

## Task 3: Add i18n keys

**Files:**
- Modify: `lib/i18n.js`

- [ ] **Step 1: Add Chinese keys to the `zh` translations object**

In `lib/i18n.js`, find the `zh` translations block. Locate `"section.quickEntries": "快捷入口"` and add after it:

```js
"section.timer": "计时",
```

Locate `"settings.section.quickEntries": "快捷入口"` and add after it:

```js
"settings.section.timer": "计时器",
```

Anywhere inside the zh block (e.g. after the `checkIn.*` entries), add:

```js
"timer.title": "计时",
"timer.status.idle": "就绪",
"timer.status.running": "计时中",
"timer.status.paused": "已暂停",
"timer.status.done": "完成 ✓",
"timer.btn.start": "开始",
"timer.btn.restart": "重新开始",
"timer.btn.pause": "暂停",
"timer.btn.resume": "继续",
"timer.btn.reset": "重置",
"timer.done": "计时完成",
```

- [ ] **Step 2: Add English keys to the `en` translations object**

In `lib/i18n.js`, find the `en` translations block. Locate `"section.quickEntries": "Quick Links"` and add after it:

```js
"section.timer": "Timer",
```

Locate `"settings.section.quickEntries"` in the en block and add after it:

```js
"settings.section.timer": "Timer",
```

Anywhere inside the en block, add:

```js
"timer.title": "Timer",
"timer.status.idle": "Ready",
"timer.status.running": "Running",
"timer.status.paused": "Paused",
"timer.status.done": "Done ✓",
"timer.btn.start": "Start",
"timer.btn.restart": "Restart",
"timer.btn.pause": "Pause",
"timer.btn.resume": "Resume",
"timer.btn.reset": "Reset",
"timer.done": "Timer finished",
```

- [ ] **Step 3: Verify translation keys resolve**

```bash
node -e "
const i18n = require('./lib/i18n');
const zh = i18n.createTranslator(() => 'zh');
const en = i18n.createTranslator(() => 'en');
console.log(zh('timer.done'), '|', en('timer.done'));
console.log(zh('settings.section.timer'), '|', en('settings.section.timer'));
"
```
Expected:
```
计时完成 | Timer finished
计时器 | Timer
```

- [ ] **Step 4: Run full test suite**

```bash
node --test tests/*.test.js
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add lib/i18n.js
git commit -m "feat(timer): add i18n keys for timer section"
```

---

## Task 4: Implement lib/sections/timer.js

**Files:**
- Create: `lib/sections/timer.js`
- Modify: `tests/timer.test.js` (append pure function tests)

- [ ] **Step 1: Create lib/sections/timer.js**

```js
"use strict";

const obsidian = require("obsidian");
const { Notice } = obsidian;

const CIRCUMFERENCE = 2 * Math.PI * 70; // r=70 → ≈439.82

function formatTimerDisplay(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function getDashOffset(remainingSeconds, durationSeconds) {
  if (durationSeconds <= 0) return CIRCUMFERENCE;
  const ratio = Math.max(0, Math.min(1, remainingSeconds / durationSeconds));
  return CIRCUMFERENCE * (1 - ratio);
}

function getTimerData(settings) {
  return settings.data.timer;
}

function persistTimer(plugin) {
  return plugin.saveData(plugin.settings);
}

function render(parent, ctx) {
  const { plugin, settings, t } = ctx;

  // Clear any interval left over from the previous render cycle
  if (plugin._timerInterval) {
    clearInterval(plugin._timerInterval);
    plugin._timerInterval = null;
  }

  if (settings.showSection?.timer === false) return;

  // Reconcile running state: Obsidian may have been closed while timer was active
  const data = getTimerData(settings);
  if (data.status === "running" && data.startedAt) {
    const elapsed = Math.floor((Date.now() - data.startedAt) / 1000);
    const newRemaining = data.remainingSeconds - elapsed;
    if (newRemaining <= 0) {
      data.remainingSeconds = 0;
      data.status = "done";
      data.startedAt = null;
      persistTimer(plugin);
      new Notice(t("timer.done"));
    } else {
      data.remainingSeconds = newRemaining;
      data.startedAt = Date.now();
      persistTimer(plugin);
    }
  }

  // ── Section shell ──────────────────────────────────────────────
  const section = parent.createDiv({ cls: "yd-section yd-section-timer" });

  const header = section.createDiv({ cls: "yd-section-header" });
  header.createSpan({ cls: "yd-section-title", text: t("timer.title") });

  const body = section.createDiv({ cls: "yd-timer-body" });

  // ── SVG progress ring ──────────────────────────────────────────
  const ringWrap = body.createDiv({ cls: "yd-timer-ring-wrap" });

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "yd-timer-svg");
  svg.setAttribute("width", "160");
  svg.setAttribute("height", "160");
  svg.setAttribute("viewBox", "0 0 160 160");
  ringWrap.appendChild(svg);

  const bgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  bgCircle.setAttribute("cx", "80");
  bgCircle.setAttribute("cy", "80");
  bgCircle.setAttribute("r", "70");
  bgCircle.setAttribute("fill", "none");
  bgCircle.setAttribute("stroke", "var(--yd-border)");
  bgCircle.setAttribute("stroke-width", "3");
  svg.appendChild(bgCircle);

  const progressCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  progressCircle.setAttribute("cx", "80");
  progressCircle.setAttribute("cy", "80");
  progressCircle.setAttribute("r", "70");
  progressCircle.setAttribute("fill", "none");
  progressCircle.setAttribute("stroke", "var(--yd-accent)");
  progressCircle.setAttribute("stroke-width", "5");
  progressCircle.setAttribute("stroke-linecap", "round");
  progressCircle.setAttribute("stroke-dasharray", String(CIRCUMFERENCE));
  progressCircle.setAttribute("class", "yd-timer-progress");
  svg.appendChild(progressCircle);

  // ── Time display overlay ───────────────────────────────────────
  const overlay = ringWrap.createDiv({ cls: "yd-timer-overlay" });

  const display = overlay.createSpan({
    cls: "yd-timer-display",
    text: formatTimerDisplay(data.remainingSeconds)
  });

  const input = overlay.createEl("input", {
    cls: "yd-timer-input yd-timer-input--hidden",
    attr: { type: "text", inputmode: "numeric", placeholder: "60" }
  });

  // ── Status text ────────────────────────────────────────────────
  const statusEl = body.createDiv({ cls: "yd-timer-status" });

  // ── Controls ───────────────────────────────────────────────────
  const controls = body.createDiv({ cls: "yd-timer-controls" });

  // ── Helpers ────────────────────────────────────────────────────
  let tickCount = 0;

  function syncRing() {
    display.textContent = formatTimerDisplay(data.remainingSeconds);
    progressCircle.setAttribute(
      "stroke-dashoffset",
      String(getDashOffset(data.remainingSeconds, data.durationSeconds))
    );
  }

  function syncStatus() {
    statusEl.textContent = t(`timer.status.${data.status}`);
  }

  function syncEditableCursor() {
    if (data.status === "idle" || data.status === "paused") {
      display.addClass("yd-timer-display--editable");
    } else {
      display.removeClass("yd-timer-display--editable");
    }
  }

  function rebuildControls() {
    controls.empty();
    if (data.status === "idle" || data.status === "done") {
      const startBtn = controls.createEl("button", {
        cls: "yd-timer-btn yd-timer-btn--primary",
        text: data.status === "done" ? t("timer.btn.restart") : t("timer.btn.start")
      });
      startBtn.addEventListener("click", onStart);
    } else if (data.status === "running") {
      const pauseBtn = controls.createEl("button", { cls: "yd-timer-btn", text: t("timer.btn.pause") });
      pauseBtn.addEventListener("click", onPause);
      const resetBtn = controls.createEl("button", { cls: "yd-timer-btn", text: t("timer.btn.reset") });
      resetBtn.addEventListener("click", onReset);
    } else if (data.status === "paused") {
      const resumeBtn = controls.createEl("button", { cls: "yd-timer-btn yd-timer-btn--primary", text: t("timer.btn.resume") });
      resumeBtn.addEventListener("click", onResume);
      const resetBtn = controls.createEl("button", { cls: "yd-timer-btn", text: t("timer.btn.reset") });
      resetBtn.addEventListener("click", onReset);
    }
    syncEditableCursor();
  }

  function startInterval() {
    plugin._timerInterval = setInterval(() => {
      if (data.remainingSeconds <= 0) {
        clearInterval(plugin._timerInterval);
        plugin._timerInterval = null;
        data.status = "done";
        data.startedAt = null;
        persistTimer(plugin);
        new Notice(t("timer.done"));
        syncRing();
        syncStatus();
        rebuildControls();
        return;
      }
      data.remainingSeconds -= 1;
      tickCount += 1;
      syncRing();
      if (tickCount % 10 === 0) persistTimer(plugin);
    }, 1000);
  }

  // ── Event handlers ─────────────────────────────────────────────
  function onStart() {
    if (data.status === "done") data.remainingSeconds = data.durationSeconds;
    data.status = "running";
    data.startedAt = Date.now();
    tickCount = 0;
    persistTimer(plugin);
    syncRing();
    syncStatus();
    rebuildControls();
    startInterval();
  }

  function onPause() {
    if (plugin._timerInterval) {
      clearInterval(plugin._timerInterval);
      plugin._timerInterval = null;
    }
    data.status = "paused";
    data.startedAt = null;
    persistTimer(plugin);
    syncStatus();
    rebuildControls();
  }

  function onResume() {
    data.status = "running";
    data.startedAt = Date.now();
    tickCount = 0;
    persistTimer(plugin);
    syncStatus();
    rebuildControls();
    startInterval();
  }

  function onReset() {
    if (plugin._timerInterval) {
      clearInterval(plugin._timerInterval);
      plugin._timerInterval = null;
    }
    data.remainingSeconds = data.durationSeconds;
    data.status = "idle";
    data.startedAt = null;
    persistTimer(plugin);
    syncRing();
    syncStatus();
    rebuildControls();
  }

  // ── Click-to-edit duration ─────────────────────────────────────
  display.addEventListener("click", () => {
    if (data.status === "running") return;
    input.value = String(Math.round(data.durationSeconds / 60));
    display.addClass("yd-timer-display--hidden");
    input.removeClass("yd-timer-input--hidden");
    input.select();
  });

  function commitEdit() {
    const raw = parseInt(input.value, 10);
    if (Number.isFinite(raw) && raw >= 1 && raw <= 999) {
      data.durationSeconds = raw * 60;
      data.remainingSeconds = raw * 60;
      data.status = "idle";
      persistTimer(plugin);
    }
    input.addClass("yd-timer-input--hidden");
    display.removeClass("yd-timer-display--hidden");
    syncRing();
    syncStatus();
    rebuildControls();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
    if (e.key === "Escape") {
      input.addClass("yd-timer-input--hidden");
      display.removeClass("yd-timer-display--hidden");
    }
  });
  input.addEventListener("blur", commitEdit);

  // ── Initial render ─────────────────────────────────────────────
  syncRing();
  syncStatus();
  rebuildControls(); // also calls syncEditableCursor

  // If still running after reconciliation, restart interval
  if (data.status === "running") {
    startInterval();
  }
}

module.exports = { render, formatTimerDisplay, getDashOffset, CIRCUMFERENCE };
```

- [ ] **Step 2: Verify the file loads**

```bash
node -e "const t = require('./lib/sections/timer'); console.log(typeof t.render, typeof t.formatTimerDisplay, typeof t.getDashOffset);"
```
Expected: `function function function`

- [ ] **Step 3: Append pure-function tests to tests/timer.test.js**

```js
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
```

- [ ] **Step 4: Run all tests**

```bash
node --test tests/*.test.js
```
Expected: all pass (13 total)

- [ ] **Step 5: Commit**

```bash
git add lib/sections/timer.js tests/timer.test.js
git commit -m "feat(timer): implement timer section with pure function tests"
```

---

## Task 5: Wire timer into src/main.js

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Import timer section at top of main.js**

After line 26 (`const quickEntriesSection = require("../lib/sections/quick-entries");`), add:

```js
const timerSection = require("../lib/sections/timer");
```

- [ ] **Step 2: Call timerSection.render in the dashboard render() method**

Find line 234 (the `quickEntriesSection.renderSide(colLeft, "left", ctx)` call). Insert the timer render immediately before it:

```js
    timerSection.render(colLeft, ctx);
    quickEntriesSection.renderSide(colLeft, "left", ctx);
```

- [ ] **Step 3: Add timer toggle to the settings page**

The current settings page ends with `renderGroup("groupA")` at line 390 and `renderGroup("groupB")` at line 392, followed by an `<hr>` at line 394.

Insert a timer toggle row between line 392 and line 394. The final block should look like:

```js
    renderGroup("groupA");
    containerEl.createEl("hr", { cls: "yd-section-order-divider" });
    renderGroup("groupB");

    // Timer — fixed left-column section, not in sectionOrder drag list
    const timerRow = containerEl.createDiv({ cls: "yd-section-order-row" });
    timerRow.createSpan({ cls: "yd-section-order-label", text: t("settings.section.timer") });
    const timerToggleWrap = timerRow.createDiv({ cls: "yd-section-order-toggle" });
    const timerToggle = new ToggleComponent(timerToggleWrap);
    timerToggle
      .setValue(this.plugin.settings.showSection.timer !== false)
      .onChange(async (value) => {
        this.plugin.settings.showSection.timer = value;
        await this.plugin.saveSettings();
      });

    containerEl.createEl("hr", { cls: "yd-settings-divider" });
```

- [ ] **Step 4: Check syntax**

```bash
node --check src/main.js && echo "syntax OK"
```
Expected: `syntax OK`

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(timer): wire timer into render and settings toggle"
```

---

## Task 6: Add CSS for timer section

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Append timer CSS at the end of styles.css**

```css
/* ====== timer section ====== */
.yd-section-timer {
  padding-bottom: 20px;
  align-items: center;
}

.yd-timer-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.yd-timer-ring-wrap {
  position: relative;
  width: 160px;
  height: 160px;
  margin: 0 auto;
  flex-shrink: 0;
}

.yd-timer-svg {
  width: 160px;
  height: 160px;
  transform: rotate(-90deg);
  overflow: visible;
}

.yd-timer-progress {
  transition: stroke-dashoffset 0.8s ease;
}

.yd-timer-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 120px;
}

.yd-timer-display {
  font-size: 32px;
  font-weight: 400;
  color: var(--yd-text);
  letter-spacing: 1px;
  line-height: 1;
  user-select: none;
  cursor: default;
}

.yd-timer-display--editable {
  cursor: pointer;
}

.yd-timer-display--editable:hover {
  color: var(--yd-accent);
}

.yd-timer-display--hidden {
  display: none;
}

.yd-timer-input {
  font-size: 32px;
  font-weight: 400;
  color: var(--yd-text);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--yd-accent);
  text-align: center;
  width: 80px;
  outline: none;
  font-family: inherit;
  line-height: 1;
  padding: 0;
  box-shadow: none;
}

.yd-timer-input--hidden {
  display: none;
}

.yd-timer-status {
  font-size: 12px;
  color: var(--yd-text-muted);
  text-align: center;
  min-height: 16px;
}

.yd-timer-controls {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.yd-timer-btn {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  border: 1px solid var(--yd-border);
  border-radius: var(--yd-radius);
  color: var(--yd-text-soft);
  font-family: inherit;
  font-size: 13px;
  padding: 5px 14px;
  cursor: pointer;
  box-shadow: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.yd-timer-btn:hover {
  background-color: var(--yd-accent-soft);
  color: var(--yd-text);
}

.yd-timer-btn--primary {
  background-color: var(--yd-accent);
  border-color: var(--yd-accent);
  color: #ffffff;
  -webkit-text-fill-color: #ffffff;
}

.yd-timer-btn--primary:hover {
  background-color: var(--yd-accent-deep);
  border-color: var(--yd-accent-deep);
}

body .yd-dashboard-host .yd-timer-btn,
body .workspace-leaf-content .view-content.yd-dashboard-host .yd-timer-btn,
.workspace-leaf-content .yd-dashboard-host .yd-view-content .yd-timer-btn {
  -webkit-appearance: none;
  appearance: none;
  background-image: none;
  box-shadow: none !important;
  font-family: inherit;
}

body .yd-dashboard-host .yd-timer-btn--primary,
body .workspace-leaf-content .view-content.yd-dashboard-host .yd-timer-btn--primary,
.workspace-leaf-content .yd-dashboard-host .yd-view-content .yd-timer-btn--primary {
  background-color: var(--yd-accent) !important;
  border-color: var(--yd-accent) !important;
  color: #ffffff !important;
  -webkit-text-fill-color: #ffffff;
}

body .yd-dashboard-host .yd-timer-btn--primary:hover,
body .workspace-leaf-content .view-content.yd-dashboard-host .yd-timer-btn--primary:hover,
.workspace-leaf-content .yd-dashboard-host .yd-view-content .yd-timer-btn--primary:hover {
  background-color: var(--yd-accent-deep) !important;
  border-color: var(--yd-accent-deep) !important;
}
```

- [ ] **Step 2: Commit**

```bash
git add styles.css
git commit -m "feat(timer): add timer section CSS"
```

---

## Task 7: Build and verify

- [ ] **Step 1: Run full test suite**

```bash
node --test tests/*.test.js
```
Expected: all tests pass

- [ ] **Step 2: Build the bundle**

```bash
node scripts/bundle.js
```
Expected: outputs `bundled N modules → main.js (XXX KB)`, no errors

- [ ] **Step 3: Verify timer code is in the bundle**

```bash
grep -c "yd-timer-body\|formatTimerDisplay\|normalizeTimer" main.js
```
Expected: `3`

- [ ] **Step 4: Manual verification in Obsidian**

Reload the plugin in Obsidian (Settings → Community Plugins → disable and re-enable, or use hot-reload). Verify:

- [ ] Timer section appears in left column below checkIn, styled as a white card
- [ ] Shows `60:00` and status `就绪` / `Ready` by default
- [ ] Clicking [开始] starts countdown; ring arc drains clockwise; status shows `计时中`
- [ ] [暂停] freezes the countdown at current value; status shows `已暂停`
- [ ] [继续] resumes from where it stopped; ring continues draining
- [ ] [重置] returns to `60:00` and `就绪` at any time
- [ ] Clicking the time display when idle or paused shows an `<input>`; typing `30` + Enter sets timer to `30:00`
- [ ] Typing `0`, empty string, or text → input is discarded, original value is restored
- [ ] Starting and then closing/reopening Obsidian → timer resumes with correct remaining time
- [ ] Timer reaching `00:00` → shows `完成 ✓`, Obsidian Notice appears saying `计时完成`, ring is empty
- [ ] [重新开始] resets to full duration and starts again
- [ ] Settings page shows a `计时器` toggle that hides/shows the section

- [ ] **Step 5: Final commit**

```bash
git add main.js
git commit -m "feat(timer): build bundle with timer section"
```
