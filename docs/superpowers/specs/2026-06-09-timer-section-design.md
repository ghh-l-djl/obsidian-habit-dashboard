# Timer Section Design

**Date:** 2026-06-09  
**Status:** Approved

## Overview

Add a standalone countdown timer section to the dashboard left column. Default 60 minutes, no task association, supports editing duration by clicking the time display, persists running state across closes, and triggers an Obsidian Notice when the countdown reaches zero.

---

## Architecture

### Files

| File | Change |
|------|--------|
| `lib/sections/timer.js` | New — all timer UI and logic |
| `lib/constants.js` | Add `showSection.timer = true` and `data.timer` defaults |
| `lib/store.js` | Add `normalizeTimer()`, call in `normalizeSettings()` |
| `lib/i18n.js` | Add timer translation keys (zh + en) |
| `src/main.js` | Import `timerSection`, render in left column after groupA sections |
| `styles.css` | Add `.yd-section-timer` and timer sub-element styles |

### Render Position

In `render()`, after the `order.groupA` loop and before `quickEntriesSection.renderSide(colLeft, ...)`:

```js
if (settings.showSection?.timer !== false) {
  timerSection.render(colLeft, ctx);
}
```

The timer is fixed to the left column and does not participate in the drag-reorder system. It follows the same `showSection` toggle pattern as other sections.

---

## Persisted State

Stored in `settings.data.timer`:

```js
{
  durationSeconds: 3600,   // user-configured duration, default 60 min
  remainingSeconds: 3600,  // snapshot at last start/pause
  status: "idle",          // "idle" | "running" | "paused" | "done"
  startedAt: null          // epoch ms of last Start press
}
```

### Recovery on Open

When status is `"running"` on re-open:
```
elapsed = (Date.now() - startedAt) / 1000
newRemaining = max(0, remainingSeconds - elapsed)
if newRemaining === 0 → status = "done", show notice
else → update remainingSeconds = newRemaining, restart interval
```

---

## Interval Management

The `setInterval` reference is stored on `plugin._timerInterval`. Because the dashboard DOM is fully rebuilt on every `scheduleRender()`, each `timer.render()` call:
1. Clears any existing `plugin._timerInterval`
2. Creates fresh DOM elements
3. If status is `"running"` after recovery, starts a new interval pointing to the new DOM refs via closure

Persisting tick state: update `settings.data.timer.remainingSeconds` in-memory on every tick; call `plugin.saveData(plugin.settings)` every 10 ticks (10 seconds) and on all state-change events (start, pause, stop, done).

---

## UI Structure

```
.yd-section.yd-section-timer
  .yd-section-header
    span  "计时" / "Timer"
  .yd-timer-body
    .yd-timer-ring-wrap              ← position: relative, 160×160px, margin: auto
      svg.yd-timer-svg               ← 160×160, rotate(-90deg)
        circle.yd-timer-bg-circle    ← r=70, stroke var(--yd-border), width 3
        circle.yd-timer-progress     ← r=70, stroke var(--yd-accent), width 5, dasharray=circumference
      .yd-timer-overlay              ← absolute, centered over SVG
        span.yd-timer-display        ← "60:00", 32px, clickable when idle/paused
        input.yd-timer-input         ← hidden by default, shown on click
  .yd-timer-status                   ← "就绪" / "计时中" / "已暂停" / "完成 ✓"
  .yd-timer-controls
    [idle/done]  button.yd-timer-btn--primary  "开始" / "重新开始"
    [running]    button.yd-timer-btn           "暂停"
                 button.yd-timer-btn           "重置"
    [paused]     button.yd-timer-btn--primary  "继续"
                 button.yd-timer-btn           "重置"
```

### Sizing

- SVG: 160×160px, radius 70px, circumference ≈ 439.8px
- Left column inner width: 280px − 44px padding = 236px → SVG fits centered
- `stroke-dashoffset` progresses from 0 (full) to circumference (empty)

---

## Interactions

### Edit Duration
- Click `yd-timer-display` when `status` is `"idle"` or `"paused"` → hide display, show input pre-filled with current minutes
- Enter or blur → parse integer (clamp 1–999), set `durationSeconds = value * 60`, set `remainingSeconds = durationSeconds`, save, hide input, show display
- Invalid input → restore original value silently

### Timer Controls
- **Start**: `status = "running"`, `startedAt = Date.now()`, save, start interval
- **Tick**: decrement remaining by 1, update display and dashoffset; every 10 ticks, save
- **Reach 00:00**: clear interval, `status = "done"`, save, `new Notice(t("timer.done"))`
- **Pause**: clear interval, `status = "paused"`, save
- **Resume**: `startedAt = Date.now()` (remaining already correct), `status = "running"`, save, start interval
- **Reset**: clear interval, `remainingSeconds = durationSeconds`, `status = "idle"`, `startedAt = null`, save

---

## i18n Keys

| Key | 中文 | English |
|-----|------|---------|
| `timer.title` | 计时 | Timer |
| `timer.status.idle` | 就绪 | Ready |
| `timer.status.running` | 计时中 | Running |
| `timer.status.paused` | 已暂停 | Paused |
| `timer.status.done` | 完成 ✓ | Done ✓ |
| `timer.btn.start` | 开始 | Start |
| `timer.btn.restart` | 重新开始 | Restart |
| `timer.btn.pause` | 暂停 | Pause |
| `timer.btn.resume` | 继续 | Resume |
| `timer.btn.reset` | 重置 | Reset |
| `timer.done` | 计时完成 | Timer finished |
| `settings.section.timer` | 计时器 | Timer |

---

## CSS

New classes added to `styles.css`:

- `.yd-section-timer` — minor padding adjustment
- `.yd-timer-body` — flex column, align-items center, gap 12px
- `.yd-timer-ring-wrap` — position relative, width/height 160px, margin auto
- `.yd-timer-svg` — 160×160, transform rotate(-90deg)
- `.yd-timer-overlay` — absolute, centered (top/left 50%, translate -50%)
- `.yd-timer-display` — font-size 32px, color var(--yd-text), cursor pointer
- `.yd-timer-display:hover` — color var(--yd-accent) when editable
- `.yd-timer-input` — text-align center, font-size 32px, width 100px
- `.yd-timer-input--hidden` — display none
- `.yd-timer-status` — font-size 12px, color var(--yd-text-muted), text-align center
- `.yd-timer-controls` — display flex, gap 8px, justify-content center
- `.yd-timer-btn` — ghost style matching existing secondary buttons
- `.yd-timer-btn--primary` — filled, var(--yd-accent) background, white text

---

## Settings Page

Add `timer` to the `groupA` toggle list in `YoriDashboardSettingTab.display()` alongside dataLog and checkIn. Label: `t("settings.section.timer")`.

---

## Mobile

Timer section is desktop-only. The `mobileDashboard.renderMobileDashboard()` branch in `render()` returns early before the column layout, so no additional guard is needed.
