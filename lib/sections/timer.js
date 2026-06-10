"use strict";

const obsidian = require("obsidian");
const { Notice } = obsidian;

const CIRCUMFERENCE = 2 * Math.PI * 70; // r=70 → ≈439.82, exported for tests

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

// Use saveData (not saveSettings) to avoid triggering refreshAllViews → re-render on every tick
function persistTimer(plugin) {
  return plugin.saveData(plugin.settings);
}

function renderImpl(parent, ctx, isCompact) {
  const { plugin, settings, t } = ctx;

  if (settings.showSection?.timer === false) {
    // Hidden — leave any running interval intact
    return;
  }

  // Clear stale interval from previous render, then attach to fresh DOM
  if (plugin._timerInterval) {
    clearInterval(plugin._timerInterval);
    plugin._timerInterval = null;
  }

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

  // ── Ring parameters ────────────────────────────────────────────
  const R = isCompact ? 30 : 70;
  const SVG_SIZE = isCompact ? 72 : 160;
  const CX_CY = isCompact ? 36 : 80;
  const CIRC = 2 * Math.PI * R;
  const STROKE_BG = isCompact ? 2 : 3;
  const STROKE_FG = isCompact ? 3 : 5;

  // ── Container ──────────────────────────────────────────────────
  let body;
  if (isCompact) {
    const sidebar = parent.createDiv({ cls: "yd-timer-sidebar" });
    body = sidebar.createDiv({ cls: "yd-timer-sb-inner" });
  } else {
    const section = parent.createDiv({ cls: "yd-section yd-section-timer" });
    section.createDiv({ cls: "yd-section-header" }).createSpan({ cls: "yd-section-title", text: t("timer.title") });
    body = section.createDiv({ cls: "yd-timer-body" });
  }

  // ── SVG progress ring ──────────────────────────────────────────
  const ringWrap = body.createDiv({
    cls: isCompact ? "yd-timer-ring-wrap yd-timer-ring-wrap--sm" : "yd-timer-ring-wrap"
  });

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", isCompact ? "yd-timer-svg yd-timer-svg--sm" : "yd-timer-svg");
  svg.setAttribute("width", String(SVG_SIZE));
  svg.setAttribute("height", String(SVG_SIZE));
  svg.setAttribute("viewBox", `0 0 ${SVG_SIZE} ${SVG_SIZE}`);
  ringWrap.appendChild(svg);

  const bgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  bgCircle.setAttribute("cx", String(CX_CY));
  bgCircle.setAttribute("cy", String(CX_CY));
  bgCircle.setAttribute("r", String(R));
  bgCircle.setAttribute("fill", "none");
  bgCircle.setAttribute("stroke", "var(--yd-border)");
  bgCircle.setAttribute("stroke-width", String(STROKE_BG));
  svg.appendChild(bgCircle);

  const progressCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  progressCircle.setAttribute("cx", String(CX_CY));
  progressCircle.setAttribute("cy", String(CX_CY));
  progressCircle.setAttribute("r", String(R));
  progressCircle.setAttribute("fill", "none");
  progressCircle.setAttribute("stroke", "var(--yd-accent)");
  progressCircle.setAttribute("stroke-width", String(STROKE_FG));
  progressCircle.setAttribute("stroke-linecap", "round");
  progressCircle.setAttribute("stroke-dasharray", String(CIRC));
  progressCircle.setAttribute("class", "yd-timer-progress");
  svg.appendChild(progressCircle);

  // ── Time display overlay ───────────────────────────────────────
  const overlay = ringWrap.createDiv({
    cls: isCompact ? "yd-timer-overlay yd-timer-overlay--sm" : "yd-timer-overlay"
  });

  const display = overlay.createSpan({
    cls: isCompact ? "yd-timer-display yd-timer-display--sm" : "yd-timer-display",
    text: formatTimerDisplay(data.remainingSeconds)
  });

  const input = overlay.createEl("input", {
    cls: isCompact
      ? "yd-timer-input yd-timer-input--hidden yd-timer-input--sm"
      : "yd-timer-input yd-timer-input--hidden",
    attr: { type: "text", inputmode: "numeric", placeholder: "60" }
  });

  // ── Status text (inside ring overlay, hidden during editing) ───
  const statusEl = overlay.createDiv({
    cls: isCompact ? "yd-timer-status yd-timer-status--sm" : "yd-timer-status"
  });

  // ── Controls ───────────────────────────────────────────────────
  const controls = body.createDiv({
    cls: isCompact ? "yd-timer-controls yd-timer-controls--sm" : "yd-timer-controls"
  });

  // ── Helpers ────────────────────────────────────────────────────
  let tickCount = 0;

  function syncRing() {
    display.textContent = formatTimerDisplay(data.remainingSeconds);
    const ratio = data.durationSeconds > 0
      ? Math.max(0, Math.min(1, data.remainingSeconds / data.durationSeconds))
      : 0;
    progressCircle.setAttribute("stroke-dashoffset", String(CIRC * (1 - ratio)));
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
      const resumeBtn = controls.createEl("button", {
        cls: "yd-timer-btn yd-timer-btn--primary",
        text: t("timer.btn.resume")
      });
      resumeBtn.addEventListener("click", onResume);
      const resetBtn = controls.createEl("button", { cls: "yd-timer-btn", text: t("timer.btn.reset") });
      resetBtn.addEventListener("click", onReset);
    }
    syncEditableCursor();
  }

  function startInterval() {
    plugin._timerInterval = setInterval(() => {
      if (!display.isConnected) {
        clearInterval(plugin._timerInterval);
        plugin._timerInterval = null;
        return;
      }
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
  let editCommitted = false;

  display.addEventListener("click", () => {
    if (data.status === "running") return;
    editCommitted = false;
    input.value = String(Math.round(data.durationSeconds / 60));
    display.addClass("yd-timer-display--hidden");
    statusEl.addClass("yd-timer-status--hidden");
    input.removeClass("yd-timer-input--hidden");
    input.select();
  });

  function commitEdit() {
    if (editCommitted) return;
    editCommitted = true;
    const raw = parseInt(input.value, 10);
    if (Number.isFinite(raw) && raw >= 1 && raw <= 999) {
      data.durationSeconds = raw * 60;
      data.remainingSeconds = raw * 60;
      data.status = "idle";
      persistTimer(plugin);
    }
    input.addClass("yd-timer-input--hidden");
    display.removeClass("yd-timer-display--hidden");
    statusEl.removeClass("yd-timer-status--hidden");
    syncRing();
    syncStatus();
    rebuildControls();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
    if (e.key === "Escape") {
      editCommitted = true; // prevent blur from firing commitEdit
      input.addClass("yd-timer-input--hidden");
      display.removeClass("yd-timer-display--hidden");
      statusEl.removeClass("yd-timer-status--hidden");
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

function render(parent, ctx) {
  return renderImpl(parent, ctx, false);
}

function renderSidebar(parent, ctx) {
  return renderImpl(parent, ctx, true);
}

module.exports = { render, renderSidebar, formatTimerDisplay, getDashOffset, CIRCUMFERENCE };
