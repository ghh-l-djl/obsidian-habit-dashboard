# 每日事件：子事件（一层）设计

**日期：** 2026-06-25

## 需求概述

一个每日事件下面可能对应多个执行步骤，每个步骤本身也是一个完整的事件（独立 Markdown 笔记、可勾选完成、可启动计时、可贳期、可拖拽排序）。本次支持事件的**一层**子事件（子事件不能再分子事件）。

依赖：本设计的拖拽排序复用 [2026-06-25-event-drag-reorder-and-completed-sort-design.md](2026-06-25-event-drag-reorder-and-completed-sort-design.md) 中的拖拽实现，建议先实现那个再做这个。

## 数据层

### event 结构变更

新增 `parentId` 字段（字符串或 `null`，默认 `null`）：

```js
{ id, title, completed, startedAt, completedAt, order, filePath, createdAt, parentId: null }
```

- 子事件与顶层事件存在**同一个** `settings.data.dailyEvents[dateKey]` 扁平数组里，靠 `parentId` 指向父事件的 `id`。
- `order` 的排序范围改为**按兄弟分组**：顶层事件（`parentId === null`）互相比较 `order`；某个父事件的子事件们互相比较 `order`，从 0 开始，与其他父事件的子事件互不影响。

### `lib/sections/calendar.js` 函数变更

- `getEventList`：不变（仍返回整个 dateKey 的扁平数组，按全局 `order` 粗排——精确的分组排序在渲染层处理，见下）。
- `setEventList`：**改为按 `parentId` 分组分别重写 `order`**：
  ```js
  function setEventList(settings, dateKey, list) {
    if (!settings?.data) return;
    if (!settings.data.dailyEvents) settings.data.dailyEvents = {};
    if (!list || list.length === 0) {
      delete settings.data.dailyEvents[dateKey];
      return;
    }
    const groups = new Map();
    list.forEach((event) => {
      const key = event.parentId || null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    });
    groups.forEach((group) => group.forEach((event, idx) => { event.order = idx; }));
    settings.data.dailyEvents[dateKey] = list;
  }
  ```
- `createEvent(settings, dateKey, title, parentId = null)`：新增可选 `parentId` 参数；`order` 取同组（同 `parentId`）现有数量。
- 新增 `getChildEvents(settings, dateKey, parentId)`：`getEventList(...).filter(e => e.parentId === parentId).sort((a,b) => a.order - b.order)`。
- 新增 `getTopLevelEvents(settings, dateKey)`：`getEventList(...).filter(e => !e.parentId).sort((a,b) => a.order - b.order)`。

## 渲染层

`renderDayEvents`：

```js
const topEvents = getTopLevelEvents(settings, dateKey);
const ordered = []; // 按"未完成在前、已完成在后"分组（复用方案一的逻辑），每个顶层事件后紧跟它的子事件
const flatten = (list) => {
  const undone = list.filter(e => !e.completed);
  const done = list.filter(e => e.completed);
  return [...undone, ...done];
};
flatten(topEvents).forEach((event) => {
  ordered.push(event);
  ordered.push(...flatten(getChildEvents(settings, dateKey, event.id)));
});
ordered.forEach((event) => renderEventRow(list, event, dateKey, ctx, { isChild: !!event.parentId }));
```

- 子事件行整体加缩进（CSS `padding-left` 或 `margin-left`，参考现有 `.yd-event-row` 间距），通过新增 `isChild` 选项给 `renderEventRow` 加 `yd-event-row--child` class。
- **不做折叠/展开**：子事件始终跟随父事件展开显示（MVP 范围内不引入展开状态）。
- 周视图（`renderWeeklyView`）同样要展示子事件（复用同一套 `getTopLevelEvents`/`getChildEvents` + 缩进渲染），但**不**应用"未完成在前"分组（与方案一保持一致：周视图不做已完成置底）。

## 创建子事件交互

- `renderEventRow` 给非子事件（`!event.parentId`）的行增加一个 hover 才显示的 `+` 图标按钮（位置参考现有「+ 添加事件」按钮的图标风格），点击后：
  1. 隐藏 `+` 按钮。
  2. 调用 `renderInlineEditor`，在当前父事件行的**正下方**插入一个空白输入框（需要新的容器 div，插在父行和它现有子事件列表之间，或子事件列表末尾——直接插在末尾即可，不需要支持插入到中间）。
  3. 提交后：`createEvent(settings, dateKey, value, parentId=父event.id)` 创建子事件；与顶层事件创建逻辑一致，调用 `noteManager.createEventNote(ctx.app, { dateKey, title: value })` 生成独立笔记（仍落在 `Habit Dashboard/Events/` 下，不单独分文件夹），写入 `filePath`；失败则 `deleteEvent` 回滚。
  4. `ctx.save()` + `ctx.refresh()`。

## 子事件的功能对等

子事件复用 `renderEventRow`，与顶层事件功能完全一致：

- 勾选完成（独立状态，**不**联动父事件，父事件勾选/取消也不影响子事件）。
- ▶ 启动计时（`startedAt`/`completedAt`）。
- 右键菜单：删除、复制、粘贴（`openEventMenu` 不变，`deleteEvent`/`copyEvent`/`pasteEvent` 不变——复制粘贴只复制 `title`，粘贴时落在哪个分组由触发粘贴的上下文决定，与现有逻辑一致，不需要特殊处理 `parentId`）。
- 拖拽排序：仅在**同一父事件的子事件之间**拖拽（不能拖拽改变 `parentId`，不能拖到另一个父事件下面、也不能拖到顶层）。实现上复用方案一的拖拽逻辑，只是 `drop` 时的候选范围限定为同一组渲染出的连续 DOM 块。

## 贳期（postpone）的孤儿处理

`postponeUndoneTomorrow` 核心逻辑不变（仍是"今天未完成的整体搬到明天，已完成的留下"，对子事件天然适用，因为它们是同一个扁平数组的元素）。新增收尾清理：

```js
function detachOrphans(list, allEventsById) {
  const ids = new Set(list.map((e) => e.id));
  list.forEach((event) => {
    if (event.parentId && !ids.has(event.parentId)) {
      const parent = allEventsById.get(event.parentId);
      event.detachedFromTitle = parent ? parent.title : null;
      event.detachedFromDate = parent ? parent.dateKeyAtDetach : null; // 见下方说明
      event.parentId = null;
    }
  });
  return list;
}
```

在 `postponeUndoneTomorrow` 里，先用原始（拆分前）的扁平列表建立 `id -> event` 的映射（含父事件本身的 `title`，以及它当前所在的 `dateKey`，即 postpone 发生时的"今天"），再对「留在今天」的列表和「搬到明天」的列表分别调用 `detachOrphans`，再各自 `setEventList`。效果：如果父子被拆到不同日期，留下来/搬走的那一边会把孤儿子事件的 `parentId` 清空，变成普通顶层事件（不再有缩进、获得自己的 `+`/拖拽等顶层交互），同时记录下 `detachedFromTitle`（父事件标题）、`detachedFromDate`（父事件当时所在的 dateKey，即拆分发生的那一天）。

**不直接修改 `event.title`**，避免和笔记文件名的双向绑定（`handleFileRename` 会用文件名覆盖 `title`）产生冲突——`detachedFromTitle`/`detachedFromDate` 是独立字段，只读不参与文件名同步。

### 同步进笔记 frontmatter

扩展 `noteManager.updateEventFrontmatter`（`lib/note-manager.js`）支持新增两个 key：

```js
if ("detachedFromTitle" in partial) fm.detachedFromTitle = partial.detachedFromTitle ?? null;
if ("detachedFromDate" in partial) fm.detachedFromDate = partial.detachedFromDate ?? null;
```

`detachOrphans` 产生孤儿后，如果该事件有 `filePath`，调用一次 `updateEventFrontmatter(app, filePath, { detachedFromTitle, detachedFromDate })` 写入笔记。

扩展 `getEventFrontmatter` 同步读出这两个字段；`resolveArchivedEventFields`（`date-utils.js`）的返回值里也带上 `detachedFromTitle`/`detachedFromDate`（frontmatter 有则用 frontmatter 的，否则回退到 event 自身字段，逻辑与现有 `completed`/`startedAt` 的回退方式一致）。

### 归档行展示

`archiveWeek`（`calendar.js`）生成每行归档文本时，如果 `resolved.detachedFromTitle` 存在，追加来源标注：

```js
const origin = resolved.detachedFromTitle
  ? ` ⤷ ${t("calendar.detachedFromLabel", { title: resolved.detachedFromTitle, date: resolved.detachedFromDate })}`
  : "";
return hasNotes && event.filePath
  ? `- [${check}] [[${linkPath}|${title}]]${duration}${origin}`
  : `- [${check}] ${title}${duration}${origin}`;
```

**主面板和周视图不展示这个信息**——只写入 frontmatter，并在归档输出里出现。

## CSS

```css
.yd-event-row--child {
  margin-left: 20px; /* 参考现有缩进，与 task-box 子任务列表的缩进量保持一致 */
}
```

`+` 按钮样式参考现有「+ 添加事件」按钮的缩小版图标按钮风格（hover 才显示，类似拖拽手柄）。

## i18n

| key | 中文 | 英文 |
|-----|------|------|
| `calendar.addSubEvent` | 添加子事件 | Add sub-event |
| `calendar.detachedFromLabel` | 原属于「{title}」({date}) | originally part of "{title}" ({date}) |

## 不变的部分

- `updateEvent`、`deleteEvent`、`copyEvent`、`pasteEvent`：不变。
- `noteManager.createEventNote`：不变，子事件笔记走同一套创建逻辑。
- `noteManager.updateEventFrontmatter` / `getEventFrontmatter`：扩展支持 `detachedFromTitle`/`detachedFromDate`，其余 key（`completed`/`completedAt`/`startedAt`/`date`）不变。
- 顶层事件原有的勾选、启动、右键菜单逻辑：不变，子事件直接复用同一个 `renderEventRow`。

## 约束

- 子事件不能再有子事件（数据层不做递归校验，UI 层不给子事件渲染 `+` 按钮即可保证）。
- 旧数据没有 `parentId` 字段时，视为 `null`（顶层事件），向后兼容。
- 拖拽/贳期/复制粘贴均不允许跨父级改变 `parentId`（唯一改变 `parentId` 的路径是贳期产生的孤儿清空逻辑）。
