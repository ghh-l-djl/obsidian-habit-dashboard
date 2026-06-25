# 每日事件：拖拽排序 + 已完成置底 设计

**日期：** 2026-06-25

## 需求概述

主面板「每日事件」列表（`yd-events-list`，`calendar.js`）目前只能按添加顺序排列，且已完成和未完成的事件混在一起展示。本次新增：

1. 支持手动拖拽调整事件顺序（桌面端原生拖拽，移动端用上/下移按钮代替）。
2. 主面板列表渲染时，已完成事件统一显示在未完成事件下方；底层存储顺序不变，取消勾选会自动回到原位置。

适用范围：**仅主面板每日事件列表**。「More」打开的周视图（`renderWeeklyView`）保持现状，不做拖拽、不做已完成置底。

## 数据层

不新增字段，复用现有 `order`（`lib/sections/calendar.js` `createEvent`/`setEventList`）。

`setEventList` 已经会在保存时按数组顺序重写 `order = idx`，因此「调整顺序」只需要：取出 `getEventList` 结果数组，把元素挪到新位置，再调用 `setEventList(settings, dateKey, list)`，剩下的交给现有逻辑。

## 渲染层（`renderDayEvents`）

```js
const events = getEventList(settings, dateKey); // 已按 order 排序
const undone = events.filter(e => !e.completed);
const done = events.filter(e => e.completed);
[...undone, ...done].forEach(event => renderEventRow(list, event, dateKey, ctx));
```

- `undone`、`done` 各自保持原有的 `order` 相对顺序（`getEventList` 已排好，filter 不改变相对顺序）。
- 仅影响渲染顺序，不写回 `order`，不调用 `setEventList`。

## 拖拽交互（`renderEventRow`）

### 桌面端

- 每行新增一个拖拽手柄（复用 `lib/sections/task-box.js` 设置弹窗里分类拖拽的图标 `grip-vertical` + `createIconButton`），默认通过 CSS 在 `:hover` 时才显示，避免常态下列表拥挤（参考 `.yd-event-row:hover` 已有的 hover 态）。
- 实现方式与 `task-box.js` `renderTaskBoxSettings` 里的分类拖拽一致：
  - 手柄 `draggable="true"`，`dragstart` 记录当前 index 到 `dataTransfer`。
  - 行级 `dragover`（`preventDefault` + 加 `is-drop-target` 样式）、`dragleave`、`drop`（用 `Array.splice` 把元素移动到目标位置）。
  - `drop` 后调用 `setEventList` 落盘、`ctx.save()`、`ctx.refresh()`。
- 拖拽只在同一渲染分组内进行（未完成的拖拽目标限定在未完成分组内，已完成的限定在已完成分组内）——因为它们各自是连续渲染的 DOM 块，物理上不会跨区拖动；如果用户在勾选状态变化的瞬间拖拽，以当前渲染状态为准即可，不做额外校验。

### 移动端（`Platform.isMobile`）

- 不渲染拖拽手柄，改为两个小图标按钮「↑」「↓」（`chevron-up` / `chevron-down`），点击时与上一个/下一个**同分组**（同样区分未完成/已完成）的事件交换 `order`，保存并刷新。
- 列表首位的事件隐藏「↑」，末位隐藏「↓」（按分组内位置判断，不是全局位置）。

## CSS

新增（参考现有 `.yd-drag-handle` / `.yd-settings-row.is-dragging` / `.is-drop-target` 样式，迁移到 `.yd-event-row` 场景）：

```css
.yd-event-row .yd-drag-handle { opacity: 0; }
.yd-event-row:hover .yd-drag-handle { opacity: 1; }
.yd-event-row.is-dragging { opacity: 0.5; }
.yd-event-row.is-drop-target { border-top: 2px solid var(--interactive-accent); }
```

移动端上下移按钮复用现有图标按钮样式（参考 `yd-event-start-btn` 的尺寸/间距）。

## i18n

| key | 中文 | 英文 |
|-----|------|------|
| `calendar.moveUp` | 上移 | Move up |
| `calendar.moveDown` | 下移 | Move down |

## 不变的部分

- 周视图渲染（`renderWeeklyView`）：不接拖拽、不做已完成置底。
- `postponeUndoneTomorrow`、归档逻辑：不受影响。
- `getEventList` / `createEvent` / `updateEvent` / `deleteEvent`：不变。

## 约束

- 拖拽与已完成置底是纯渲染/交互层改动，不引入新数据字段，向后兼容旧数据。
