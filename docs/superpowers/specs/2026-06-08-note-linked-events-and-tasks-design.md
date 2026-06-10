# Note-Linked Events & Tasks Design

## Overview

每个周历事件和每个任务盒子都关联一个 MD 文件，实现点击跳转、重命名同步、以及子任务三向同步。

---

## Architecture

### New Module: `lib/note-manager.js`

所有 MD 文件的 CRUD 和 Vault 事件监听集中在此模块，calendar.js 和 task-box.js 通过调用它操作文件。不在渲染模块中直接操作 Vault。

### Vault Event Listeners（在 main.js 注册）

- `vault.on('rename', (file, oldPath) => ...)` — 检测是否是 Yori 管理的文件，同步事件/盒子标题和 filePath
- `vault.on('modify', (file) => ...)` — 检测是否是 Yori 管理的盒子文件，解析 `## 子任务` checklist，同步插件数据并刷新 UI

### Infinite Loop Prevention

note-manager 写文件前设置 `_pendingWrite = new Set<path>()`；modify 回调检测到 path 在集合中时跳过处理并从集合中移除该 path。

---

## Data Model Changes

### Events（`settings.data.dailyEvents`）

```js
// Before
{ id, title, completed, order }

// After
{
  id,
  title,
  completed,
  order,
  filePath: string | null,   // 关联 MD 文件路径
  createdAt: string | null,  // ISO 8601
  completedAt: string | null
}
```

### Task Boxes（`settings.data.taskBox`）

```js
// boxes — After（新增 filePath）
{
  id,
  name,
  order,
  filePath: string | null   // 关联 MD 文件路径
}

// tasks — 不变
{ id, boxId, title, completed, order }
```

---

## File Storage

```
Habit Dashboard/
  Events/
    2026-06-08-测试1.md
    2026-06-08-测试2.md
  Tasks/
    科普视频.md
    投资.md
```

文件夹路径为固定值 `Habit Dashboard`，内部用 `Events/` 和 `Tasks/` 子文件夹区分。

**文件名规则：**
- 事件：`YYYY-MM-DD-{title}.md`，冲突时追加 `-2`, `-3`
- 盒子：`{name}.md`，冲突时追加 `-2`, `-3`

---

## Section 1: Weekly Calendar Events

### MD File Template

```markdown
---
type: yori-event
date: 2026-06-08
created: 2026-06-08T10:30:00
completed: false
completedAt: null
---

# 测试1
```

### Behaviors

| 触发 | 行为 |
|------|------|
| 新建事件 | `app.vault.create(path, content)` 创建 MD 文件；事件数据写入 `filePath`、`createdAt` |
| 点击 checkbox | 更新事件 `completed`；通过 `app.fileManager.processFrontMatter` 更新 MD 的 `completed`/`completedAt` |
| 点击事件文字 | `app.workspace.getLeaf(false).openFile(file)` |
| MD 文件重命名 | `vault.on('rename')` → 去掉 `.md` 扩展名后整个文件名作为新标题（不做前缀解析，保持与用户手动改名一致）→ 更新事件 `title` 和 `filePath` |
| 删除事件 | `app.fileManager.trashFile(file)` + 从 `dailyEvents` 移除 |

### Backward Compatibility

不兼容旧数据。旧事件的 `filePath` 为 `null`，点击文字不跳转（无行为变化）。所有**新建**事件都关联 MD 文件。

---

## Section 2: Task Box

### MD File Template

```markdown
---
type: yori-box
created: 2026-06-08T10:30:00
---

# 科普视频

## 子任务

- [ ] 我饿他说的
- [x] 已完成的任务
```

### Behaviors

| 触发 | 行为 |
|------|------|
| 新建盒子 | 创建 `{name}.md`；盒子数据写入 `filePath` |
| 点击盒子标题 | `app.workspace.getLeaf(false).openFile(file)` |
| 重命名 MD 文件 | `vault.on('rename')` → 更新盒子 `name` 和 `filePath` |
| 删除盒子 | `app.fileManager.trashFile(file)` + 从数据中移除盒子及其所有任务 |
| UI 增加任务 | 在 MD `## 子任务` 末尾追加 `- [ ] {title}` |
| UI 删除任务 | 从 MD `## 子任务` 移除对应行 |
| UI 勾选/取消勾选任务 | 更新 MD 对应行的 `[ ]`/`[x]` |
| 编辑 MD checklist | `vault.on('modify')` → 解析 `## 子任务` 所有 `- [ ]`/`- [x]` 行 → 与插件任务按 title 做 diff（新增行→追加任务，删除行→移除任务，状态变化→更新 completed）→ 保存 → 刷新 UI |

### Three-Way Sync

数据源为插件数据（`settings.data.taskBox.tasks`），MD 文件为双向镜像：

```
外层任务盒子面板  ←→  插件数据  ←→  MD 文件
        ↕                              ↑
      弹窗 ──────────────────────────→（通过插件数据间接同步）
```

### UI Change

外层任务盒子面板的任务由无序列表（`·`）改为 checkbox 列表，样式与弹窗保持一致。

---

## Implementation Modules

| 文件 | 变更内容 |
|------|----------|
| `lib/note-manager.js` | 新增：Vault 文件 CRUD、frontmatter 更新、checklist 解析与写入、事件监听注册 |
| `src/main.js` | 注册 vault rename/modify 监听，传入 note-manager |
| `lib/sections/calendar.js` | 新建事件时调用 note-manager；checkbox 点击时更新 frontmatter；文字点击时打开文件 |
| `lib/sections/task-box.js` | 新建盒子时调用 note-manager；盒子标题点击跳转；任务变更时同步 MD；外层面板任务改为 checkbox |
| `lib/store.js` | normalizeEvents 和 normalizeTaskBox 新增字段的处理 |
