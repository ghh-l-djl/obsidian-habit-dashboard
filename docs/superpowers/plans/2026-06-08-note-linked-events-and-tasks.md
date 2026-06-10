# Note-Linked Events & Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each calendar event and each task box is backed by a Markdown file — enabling click-to-open, title sync on rename, and bidirectional checklist sync between the box file and plugin task data.

**Architecture:** A new `lib/note-manager.js` module owns all Vault file operations and exports `handleFileRename`/`handleFileModify` handlers that `src/main.js` registers as Vault events. `lib/sections/calendar.js` and `lib/sections/task-box.js` call note-manager for file creation, opening, and checklist writes. Data model is extended in-place (new nullable fields on existing objects).

**Tech Stack:** Obsidian Plugin API (`app.vault`, `app.fileManager`, `app.workspace`), plain CommonJS modules (no build step change needed).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/note-manager.js` | **Create** | All Vault file CRUD, frontmatter update, checklist parse/write, rename/modify handlers |
| `lib/store.js` | **Modify** | Preserve new `filePath`, `createdAt`, `completedAt` fields in normalizers |
| `src/main.js` | **Modify** | Import note-manager, register `vault.on('rename')` and `vault.on('modify')` |
| `lib/sections/calendar.js` | **Modify** | Create event note on add, open note on text click, update frontmatter on checkbox, trash note on delete |
| `lib/sections/task-box.js` | **Modify** | Create box note in `finalizeTaskBoxSettings`, open note on box title click, sync checklist on task add/toggle/delete, trash note on box delete, change section panel tasks to checkbox variant |

---

## Task 1: Create `lib/note-manager.js`

**Files:**
- Create: `lib/note-manager.js`

- [ ] **Step 1.1: Write the module**

Create `/Users/ghh/Documents/编程/项目/obsidian-yori-dashboard/lib/note-manager.js` with this full content:

```js
"use strict";

const EVENTS_FOLDER = "Habit Dashboard/Events";
const TASKS_FOLDER = "Habit Dashboard/Tasks";

// Paths of files currently being written by this plugin — modify handler skips them once.
const _pendingWrites = new Set();

function sanitizeFilename(str) {
  return (str || "").replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "untitled";
}

async function ensureFolder(app, folderPath) {
  const parts = folderPath.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

async function findUniquePath(app, folderPath, baseName) {
  let candidate = `${folderPath}/${baseName}.md`;
  if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
  let i = 2;
  while (true) {
    candidate = `${folderPath}/${baseName}-${i}.md`;
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
    i += 1;
  }
}

async function createEventNote(app, { dateKey, title }) {
  await ensureFolder(app, EVENTS_FOLDER);
  const safeName = `${dateKey}-${sanitizeFilename(title)}`;
  const filePath = await findUniquePath(app, EVENTS_FOLDER, safeName);
  const now = new Date().toISOString();
  const content =
    `---\ntype: yori-event\ndate: ${dateKey}\ncreated: ${now}\ncompleted: false\ncompletedAt: null\n---\n\n# ${title}\n`;
  await app.vault.create(filePath, content);
  return filePath;
}

async function createBoxNote(app, { name }) {
  await ensureFolder(app, TASKS_FOLDER);
  const safeName = sanitizeFilename(name);
  const filePath = await findUniquePath(app, TASKS_FOLDER, safeName);
  const now = new Date().toISOString();
  const content =
    `---\ntype: yori-box\ncreated: ${now}\n---\n\n# ${name}\n\n## 子任务\n\n`;
  await app.vault.create(filePath, content);
  return filePath;
}

async function openNote(app, noteOpenMode, filePath) {
  const { TFile } = require("obsidian");
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;
  const mode = noteOpenMode || "smart";
  if (mode === "smart") {
    const existing = app.workspace.getLeavesOfType("markdown").find(
      (leaf) => leaf.view && leaf.view.file && leaf.view.file.path === filePath
    );
    if (existing) { app.workspace.setActiveLeaf(existing, { focus: true }); return; }
    await app.workspace.getLeaf(true).openFile(file);
  } else if (mode === "newTab") {
    await app.workspace.getLeaf(true).openFile(file);
  } else {
    await app.workspace.getLeaf(false).openFile(file);
  }
}

async function trashNote(app, filePath) {
  if (!filePath) return;
  const { TFile } = require("obsidian");
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) await app.fileManager.trashFile(file);
}

async function updateEventFrontmatter(app, filePath, partial) {
  if (!filePath) return;
  const { TFile } = require("obsidian");
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm) => {
    if ("completed" in partial) fm.completed = partial.completed;
    if ("completedAt" in partial) fm.completedAt = partial.completedAt ?? null;
  });
}

async function writeBoxChecklist(app, filePath, tasks) {
  if (!filePath) return;
  const { TFile } = require("obsidian");
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;
  const content = await app.vault.read(file);
  const lines = content.split("\n");
  const headingIdx = lines.findIndex((l) => l.trim() === "## 子任务");
  const checklistLines = tasks
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((t) => `- [${t.completed ? "x" : " "}] ${t.title}`);
  let newLines;
  if (headingIdx === -1) {
    newLines = [...lines, "", "## 子任务", "", ...checklistLines, ""];
  } else {
    let endIdx = lines.length;
    for (let i = headingIdx + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i])) { endIdx = i; break; }
    }
    newLines = [
      ...lines.slice(0, headingIdx + 1),
      "",
      ...checklistLines,
      "",
      ...lines.slice(endIdx)
    ];
  }
  _pendingWrites.add(filePath);
  await app.vault.modify(file, newLines.join("\n"));
}

function parseBoxChecklist(content) {
  const lines = content.split("\n");
  const headingIdx = lines.findIndex((l) => l.trim() === "## 子任务");
  if (headingIdx === -1) return [];
  const result = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break;
    const match = lines[i].match(/^- \[([ xX])\] (.+)/);
    if (match) result.push({ completed: match[1].toLowerCase() === "x", title: match[2].trim() });
  }
  return result;
}

function isYoriEventFile(filePath) {
  return typeof filePath === "string" && filePath.startsWith(EVENTS_FOLDER + "/");
}

function isYoriBoxFile(filePath) {
  return typeof filePath === "string" && filePath.startsWith(TASKS_FOLDER + "/");
}

async function handleFileRename(plugin, file, oldPath) {
  const { TFile } = require("obsidian");
  if (!(file instanceof TFile)) return;
  const newPath = file.path;
  let changed = false;

  if (isYoriEventFile(oldPath) || isYoriEventFile(newPath)) {
    const dailyEvents = plugin.settings.data.dailyEvents || {};
    outer: for (const dateKey of Object.keys(dailyEvents)) {
      const list = dailyEvents[dateKey];
      if (!Array.isArray(list)) continue;
      for (const event of list) {
        if (event.filePath === oldPath) {
          event.title = file.basename;
          event.filePath = newPath;
          changed = true;
          break outer;
        }
      }
    }
  } else if (isYoriBoxFile(oldPath) || isYoriBoxFile(newPath)) {
    const boxes = plugin.settings.data.taskBox.boxes || [];
    for (const box of boxes) {
      if (box.filePath === oldPath) {
        box.name = file.basename;
        box.filePath = newPath;
        changed = true;
        break;
      }
    }
  }

  if (changed) {
    await plugin.saveData(plugin.settings);
    plugin.refreshAllViews();
  }
}

async function handleFileModify(plugin, file) {
  const { TFile } = require("obsidian");
  if (!(file instanceof TFile)) return;
  const filePath = file.path;
  if (!isYoriBoxFile(filePath)) return;
  if (_pendingWrites.has(filePath)) {
    _pendingWrites.delete(filePath);
    return;
  }

  const boxes = plugin.settings.data.taskBox.boxes || [];
  const box = boxes.find((b) => b.filePath === filePath);
  if (!box) return;

  const content = await plugin.app.vault.read(file);
  const parsed = parseBoxChecklist(content);
  const { makeId } = require("./store");

  const allTasks = plugin.settings.data.taskBox.tasks || [];
  const boxTasks = allTasks
    .filter((t) => t.boxId === box.id)
    .sort((a, b) => a.order - b.order);

  const parsedTitles = new Set(parsed.map((p) => p.title));
  const existingTitles = new Set(boxTasks.map((t) => t.title));
  let changed = false;

  // Add new tasks from MD
  parsed.forEach((p, idx) => {
    if (!existingTitles.has(p.title)) {
      plugin.settings.data.taskBox.tasks.push({
        id: makeId("task"),
        boxId: box.id,
        title: p.title,
        completed: p.completed,
        order: boxTasks.length + idx
      });
      changed = true;
    }
  });

  // Remove tasks deleted from MD
  const toDelete = boxTasks.filter((t) => !parsedTitles.has(t.title));
  if (toDelete.length > 0) {
    const deleteIds = new Set(toDelete.map((t) => t.id));
    plugin.settings.data.taskBox.tasks =
      plugin.settings.data.taskBox.tasks.filter((t) => !deleteIds.has(t.id));
    changed = true;
  }

  // Sync completed status changes
  const currentTasks = plugin.settings.data.taskBox.tasks;
  parsed.forEach((p) => {
    const existing = currentTasks.find((t) => t.boxId === box.id && t.title === p.title);
    if (existing && existing.completed !== p.completed) {
      existing.completed = p.completed;
      changed = true;
    }
  });

  if (changed) {
    await plugin.saveData(plugin.settings);
    plugin.refreshAllViews();
  }
}

module.exports = {
  createEventNote,
  createBoxNote,
  openNote,
  trashNote,
  updateEventFrontmatter,
  writeBoxChecklist,
  parseBoxChecklist,
  isYoriEventFile,
  isYoriBoxFile,
  handleFileRename,
  handleFileModify
};
```

- [ ] **Step 1.2: Manual verify — module loads without error**

In Obsidian: reload the plugin. No errors in console. (The module is not yet wired up, so no functional change.)

- [ ] **Step 1.3: Commit**

```bash
git add lib/note-manager.js
git commit -m "feat: add note-manager module for vault file operations"
```

---

## Task 2: Update `lib/store.js` — preserve new fields in normalizers

**Files:**
- Modify: `lib/store.js:128-145` (`normalizeDailyEvents`)
- Modify: `lib/store.js:72-96` (`normalizeTaskBox`)

- [ ] **Step 2.1: Update `normalizeDailyEvents` to preserve new event fields**

In `lib/store.js`, find the `.map()` inside `normalizeDailyEvents` (line ~133). Replace:

```js
      .map((event, idx) => ({
        id: event && typeof event.id === "string" && event.id ? event.id : `evt_${Date.now()}_${idx}`,
        title: typeof event?.title === "string" ? event.title : "",
        completed: !!event?.completed,
        order: Number.isFinite(event?.order) ? event.order : idx
      }))
```

With:

```js
      .map((event, idx) => ({
        id: event && typeof event.id === "string" && event.id ? event.id : `evt_${Date.now()}_${idx}`,
        title: typeof event?.title === "string" ? event.title : "",
        completed: !!event?.completed,
        order: Number.isFinite(event?.order) ? event.order : idx,
        filePath: typeof event?.filePath === "string" ? event.filePath : null,
        createdAt: typeof event?.createdAt === "string" ? event.createdAt : null,
        completedAt: typeof event?.completedAt === "string" ? event.completedAt : null
      }))
```

- [ ] **Step 2.2: Update `normalizeTaskBox` to preserve `filePath` on boxes**

In `lib/store.js`, find the boxes `.map()` inside `normalizeTaskBox` (line ~74). Replace:

```js
  const boxes = ensureArray(block.boxes).map((box, idx) => ({
    id: box && typeof box.id === "string" && box.id ? box.id : `tb_${Date.now()}_${idx}`,
    name: typeof box?.name === "string" ? box.name : "",
    order: Number.isFinite(box?.order) ? box.order : idx
  }));
```

With:

```js
  const boxes = ensureArray(block.boxes).map((box, idx) => ({
    id: box && typeof box.id === "string" && box.id ? box.id : `tb_${Date.now()}_${idx}`,
    name: typeof box?.name === "string" ? box.name : "",
    order: Number.isFinite(box?.order) ? box.order : idx,
    filePath: typeof box?.filePath === "string" ? box.filePath : null
  }));
```

- [ ] **Step 2.3: Manual verify — reload plugin, existing data intact**

Reload plugin. All existing events and boxes still appear. No console errors.

- [ ] **Step 2.4: Commit**

```bash
git add lib/store.js
git commit -m "feat: preserve filePath/createdAt/completedAt in normalizers"
```

---

## Task 3: Register vault listeners in `src/main.js`

**Files:**
- Modify: `src/main.js:1-30` (imports), `src/main.js:39-55` (`onload`)

- [ ] **Step 3.1: Add note-manager import**

In `src/main.js`, after the existing require statements at the top (around line 27), add:

```js
const noteManager = require("../lib/note-manager");
```

- [ ] **Step 3.2: Register vault events in `onload()`**

In `src/main.js`, inside `onload()`, after `this.addSettingTab(...)` (around line 54), add:

```js
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        noteManager.handleFileRename(this, file, oldPath);
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        noteManager.handleFileModify(this, file);
      })
    );
```

- [ ] **Step 3.3: Manual verify — listeners fire on file rename**

1. Reload plugin.
2. Manually create a file at `Habit Dashboard/Events/test.md` in the vault.
3. Rename it. Check console — no errors (the handler finds no matching event and does nothing, that's expected).

- [ ] **Step 3.4: Commit**

```bash
git add src/main.js
git commit -m "feat: register vault rename/modify listeners for note sync"
```

---

## Task 4: Update `lib/sections/calendar.js` — event ↔ file integration

**Files:**
- Modify: `lib/sections/calendar.js`

- [ ] **Step 4.1: Import note-manager**

At the top of `lib/sections/calendar.js`, after the existing requires, add:

```js
const noteManager = require("../note-manager");
```

- [ ] **Step 4.2: Create event note when a new event is added (day panel)**

In `renderDayEvents`, find the `wireAddBtn` function (line ~242). Replace the `onCommit` callback:

```js
      renderInlineEditor(parent, "", async (value) => {
        addBtn.style.display = "";
        if (!value) return;
        createEvent(settings, dateKey, value);
        await ctx.save();
        ctx.refresh();
      }, () => {
```

With:

```js
      renderInlineEditor(parent, "", async (value) => {
        addBtn.style.display = "";
        if (!value) return;
        const event = createEvent(settings, dateKey, value);
        const filePath = await noteManager.createEventNote(ctx.app, { dateKey, title: value });
        updateEvent(settings, dateKey, event.id, { filePath, createdAt: new Date().toISOString() });
        await ctx.save();
        ctx.refresh();
      }, () => {
```

- [ ] **Step 4.3: Create event note when a new event is added (weekly modal — desktop)**

In `renderWeeklyView`, find the desktop `addBtn.onclick` (around line ~500). Replace:

```js
          createEvent(ctx.settings, dateKey, value);
          await ctx.save();
          renderWeeklyView(root, ctx, modal);
```

With:

```js
          const evt = createEvent(ctx.settings, dateKey, value);
          const fp = await noteManager.createEventNote(ctx.app, { dateKey, title: value });
          updateEvent(ctx.settings, dateKey, evt.id, { filePath: fp, createdAt: new Date().toISOString() });
          await ctx.save();
          renderWeeklyView(root, ctx, modal);
```

- [ ] **Step 4.4: Create event note when a new event is added (weekly modal — mobile)**

In `renderWeeklyView`, find the mobile `headAdd.onclick` (around line ~479). Replace:

```js
          createEvent(ctx.settings, dateKey, value);
          await ctx.save();
          renderWeeklyView(root, ctx, modal);
```

With:

```js
          const mEvt = createEvent(ctx.settings, dateKey, value);
          const mFp = await noteManager.createEventNote(ctx.app, { dateKey, title: value });
          updateEvent(ctx.settings, dateKey, mEvt.id, { filePath: mFp, createdAt: new Date().toISOString() });
          await ctx.save();
          renderWeeklyView(root, ctx, modal);
```

- [ ] **Step 4.5: Replace text click (inline editor → open note) in `renderEventRow`**

In `renderEventRow`, find `text.onclick` (line ~293). Replace the entire `text.onclick` assignment:

```js
  const text = row.createDiv({ cls: "yd-event-text", text: event.title || t("common.unnamed") });
  text.onclick = () => {
    if (text.querySelector("textarea")) return;
    text.empty();
    const editor = text.createEl("textarea", { cls: "yd-event-editor" });
    editor.onclick = (evt) => evt.stopPropagation();
    editor.value = event.title;
    fitTextarea(editor);
    ensureFocusInput(editor);
    let committed = false;
    const commit = async () => {
      if (committed) return;
      committed = true;
      const value = editor.value.trim();
      if (!value) {
        deleteEvent(settings, dateKey, event.id);
      } else {
        updateEvent(settings, dateKey, event.id, { title: value });
      }
      await ctx.save();
      ctx.refresh();
    };
    editor.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        ctx.refresh();
      }
    };
    editor.oninput = () => fitTextarea(editor);
    editor.onblur = commit;
  };
```

With:

```js
  const text = row.createDiv({ cls: "yd-event-text", text: event.title || t("common.unnamed") });
  if (event.filePath) {
    text.addClass("yd-event-text--linked");
    text.onclick = async () => {
      await noteManager.openNote(ctx.app, ctx.settings.noteOpenMode, event.filePath);
    };
  }
```

- [ ] **Step 4.6: Update checkbox to sync frontmatter**

In `renderEventRow`, find the `checkbox.onchange` handler (line ~285). Replace:

```js
  checkbox.onchange = async () => {
    updateEvent(settings, dateKey, event.id, { completed: checkbox.checked });
    await ctx.save();
    ctx.refresh();
  };
```

With:

```js
  checkbox.onchange = async () => {
    const completedAt = checkbox.checked ? new Date().toISOString() : null;
    updateEvent(settings, dateKey, event.id, { completed: checkbox.checked, completedAt });
    await noteManager.updateEventFrontmatter(ctx.app, event.filePath, {
      completed: checkbox.checked,
      completedAt
    });
    await ctx.save();
    ctx.refresh();
  };
```

- [ ] **Step 4.7: Trash note on event delete**

In `openEventMenu`, find the `onConfirm` callback (line ~375). Replace:

```js
        onConfirm: async () => {
          deleteEvent(ctx.settings, dateKey, event.id);
          await ctx.save();
          ctx.refresh();
        }
```

With:

```js
        onConfirm: async () => {
          await noteManager.trashNote(ctx.app, event.filePath);
          deleteEvent(ctx.settings, dateKey, event.id);
          await ctx.save();
          ctx.refresh();
        }
```

- [ ] **Step 4.8: Manual verify — full event lifecycle**

1. Reload plugin.
2. Add a new event "测试事件" on today. Verify `Habit Dashboard/Events/YYYY-MM-DD-测试事件.md` is created.
3. Click the event text → verifies the file opens in Obsidian.
4. Click the checkbox → verify event shows as done, file frontmatter has `completed: true`.
5. Rename the MD file to `YYYY-MM-DD-新名称.md` → verify event title updates to "YYYY-MM-DD-新名称".
6. Right-click the event → Delete → verify event removed and file moved to trash.

- [ ] **Step 4.9: Commit**

```bash
git add lib/sections/calendar.js
git commit -m "feat: link calendar events to MD files with open/sync/trash"
```

---

## Task 5: Update `lib/sections/task-box.js` — box ↔ file integration

**Files:**
- Modify: `lib/sections/task-box.js`

- [ ] **Step 5.1: Import note-manager**

At the top of `lib/sections/task-box.js`, after the existing requires, add:

```js
const noteManager = require("../note-manager");
```

- [ ] **Step 5.2: Create box note in `finalizeTaskBoxSettings`**

Replace the existing `finalizeTaskBoxSettings` function (line ~418):

```js
async function finalizeTaskBoxSettings(ctx) {
  const boxes = ctx.settings?.data?.taskBox?.boxes;
  if (!Array.isArray(boxes)) return;
  ctx.settings.data.taskBox.boxes = boxes.filter((box) => (box.name || "").trim());
  ctx.settings.data.taskBox.boxes.forEach((box, idx) => { box.order = idx; });
  await ctx.save();
  ctx.refresh();
}
```

With:

```js
async function finalizeTaskBoxSettings(ctx) {
  const boxes = ctx.settings?.data?.taskBox?.boxes;
  if (!Array.isArray(boxes)) return;
  ctx.settings.data.taskBox.boxes = boxes.filter((box) => (box.name || "").trim());
  ctx.settings.data.taskBox.boxes.forEach((box, idx) => { box.order = idx; });
  for (const box of ctx.settings.data.taskBox.boxes) {
    if (!box.filePath && box.name) {
      box.filePath = await noteManager.createBoxNote(ctx.app, { name: box.name });
    }
  }
  await ctx.save();
  ctx.refresh();
}
```

- [ ] **Step 5.3: Make box name clickable in section panel (`renderTaskBoxSection`)**

In `renderTaskBoxSection`, find the box name render (line ~110):

```js
    boxEl.createDiv({ cls: "yd-taskbox-name", text: box.name || t("common.unnamed") });
```

Replace with:

```js
    const boxNameEl = boxEl.createDiv({ cls: "yd-taskbox-name", text: box.name || t("common.unnamed") });
    if (box.filePath) {
      boxNameEl.addClass("yd-taskbox-name--linked");
      boxNameEl.onclick = async () => {
        await noteManager.openNote(ctx.app, ctx.settings.noteOpenMode, box.filePath);
      };
    }
```

- [ ] **Step 5.4: Change section panel tasks from bullet to checkbox**

In `renderTaskBoxSection`, find the tasks render loop (line ~111):

```js
    const tasks = getTasksForBox(settings, box.id).filter((task) => !task.completed);
    tasks.forEach((task) => {
      renderTaskRow(boxEl, task, ctx, { variant: "bullet" });
    });
```

Replace with:

```js
    const tasks = getTasksForBox(settings, box.id);
    tasks.forEach((task) => {
      renderTaskRow(boxEl, task, ctx, { variant: "checkbox" });
    });
```

- [ ] **Step 5.5: Make box name clickable in full modal (`renderFullTaskBox`)**

In `renderFullTaskBox`, find where the box name is rendered in the non-mobile branch (line ~356):

```js
      col.createDiv({ cls: "yd-taskbox-name", text: box.name || t("common.unnamed") });
```

Replace with:

```js
      const fullBoxNameEl = col.createDiv({ cls: "yd-taskbox-name", text: box.name || t("common.unnamed") });
      if (box.filePath) {
        fullBoxNameEl.addClass("yd-taskbox-name--linked");
        fullBoxNameEl.onclick = async () => {
          await noteManager.openNote(ctx.app, ctx.settings.noteOpenMode, box.filePath);
        };
      }
```

Also update the mobile branch (line ~349):

```js
      titleRow.createDiv({ cls: "yd-taskbox-name", text: box.name || t("common.unnamed") });
```

Replace with:

```js
      const mobileBoxNameEl = titleRow.createDiv({ cls: "yd-taskbox-name", text: box.name || t("common.unnamed") });
      if (box.filePath) {
        mobileBoxNameEl.addClass("yd-taskbox-name--linked");
        mobileBoxNameEl.onclick = async () => {
          await noteManager.openNote(ctx.app, ctx.settings.noteOpenMode, box.filePath);
        };
      }
```

- [ ] **Step 5.6: Add helper function `syncBoxChecklist` inside task-box.js**

After the `clearCompletedTasksInBox` function (line ~82), add this helper:

```js
async function syncBoxChecklist(app, settings, boxId) {
  const box = getBoxes(settings).find((b) => b.id === boxId);
  if (!box || !box.filePath) return;
  const tasks = getTasksForBox(settings, boxId);
  await noteManager.writeBoxChecklist(app, box.filePath, tasks);
}
```

- [ ] **Step 5.7: Sync checklist when task is toggled in `renderTaskRow`**

In `renderTaskRow`, find the checkbox `onchange` handler (line ~149):

```js
    checkbox.onchange = async () => {
      updateTask(ctx.settings, task.id, { completed: checkbox.checked });
      await ctx.save();
      if (typeof opts.onChange === "function") opts.onChange();
      else ctx.refresh();
    };
```

Replace with:

```js
    checkbox.onchange = async () => {
      updateTask(ctx.settings, task.id, { completed: checkbox.checked });
      await ctx.save();
      await syncBoxChecklist(ctx.app, ctx.settings, task.boxId);
      if (typeof opts.onChange === "function") opts.onChange();
      else ctx.refresh();
    };
```

- [ ] **Step 5.8: Sync checklist when task is deleted via context menu in `renderTaskRow`**

In `renderTaskRow`, inside the delete confirm `onConfirm` (line ~237):

```js
          onConfirm: async () => {
            deleteTask(ctx.settings, task.id);
            await ctx.save();
            if (typeof opts.onChange === "function") opts.onChange();
            else ctx.refresh();
          }
```

Replace with:

```js
          onConfirm: async () => {
            const boxId = task.boxId;
            deleteTask(ctx.settings, task.id);
            await ctx.save();
            await syncBoxChecklist(ctx.app, ctx.settings, boxId);
            if (typeof opts.onChange === "function") opts.onChange();
            else ctx.refresh();
          }
```

- [ ] **Step 5.9: Sync checklist when task is created via quick-add (`renderTaskComposer`)**

In `renderTaskComposer`, find the `finish` function's create block (line ~297):

```js
    if (value && boxId) {
      createTask(settings, boxId, value);
      await ctx.save();
      new Notice(`${t("common.add")}: ${value}`);
    }
```

Replace with:

```js
    if (value && boxId) {
      createTask(settings, boxId, value);
      await ctx.save();
      await syncBoxChecklist(ctx.app, settings, boxId);
      new Notice(`${t("common.add")}: ${value}`);
    }
```

- [ ] **Step 5.10: Sync checklist when task is created in full modal (`renderFullTaskBox`)**

In `renderFullTaskBox`, find the full-modal task creation's `finish` function (line ~374):

```js
        if (!value) return;
        createTask(settings, box.id, value);
        await ctx.save();
        renderFullTaskBox(root, ctx, modal);
```

Replace with:

```js
        if (!value) return;
        createTask(settings, box.id, value);
        await ctx.save();
        await syncBoxChecklist(ctx.app, settings, box.id);
        renderFullTaskBox(root, ctx, modal);
```

- [ ] **Step 5.11: Trash box note when box is deleted (`renderTaskBoxSettings`)**

In `renderTaskBoxSettings`, find the `proceed` function in the delete button handler (line ~476):

```js
      const proceed = async () => {
        deleteBox(settings, box.id);
        await ctx.save();
        renderTaskBoxSettings(root, ctx, modal);
      };
```

Replace with:

```js
      const proceed = async () => {
        await noteManager.trashNote(ctx.app, box.filePath);
        deleteBox(settings, box.id);
        await ctx.save();
        renderTaskBoxSettings(root, ctx, modal);
      };
```

- [ ] **Step 5.12: Manual verify — full task box lifecycle**

1. Reload plugin.
2. Open Task Box Settings → add a new box named "测试盒子" → click Confirm.
3. Verify `Habit Dashboard/Tasks/测试盒子.md` is created.
4. In the section panel, click "测试盒子" label → verify file opens.
5. Add a task "任务A" via quick-add → verify it appears in MD under `## 子任务` as `- [ ] 任务A`.
6. Open full modal, add "任务B" → verify MD updated.
7. Toggle checkbox on "任务A" → verify MD shows `- [x] 任务A`.
8. Open `测试盒子.md` in Obsidian, change `- [x] 任务A` to `- [ ] 任务A` → verify task unchecks in dashboard.
9. Rename `测试盒子.md` to `新名称.md` → verify box name updates in dashboard.
10. Delete the box → verify file moves to trash, tasks removed.

- [ ] **Step 5.13: Commit**

```bash
git add lib/sections/task-box.js
git commit -m "feat: link task boxes to MD files with open/checklist-sync/trash"
```

---

## Task 6: Add CSS cursor style for linked items

**Files:**
- Modify: `styles.css` (or whichever CSS file the plugin uses)

- [ ] **Step 6.1: Find the CSS file**

```bash
find /Users/ghh/Documents/编程/项目/obsidian-yori-dashboard -name "*.css" | head -10
```

- [ ] **Step 6.2: Add cursor pointer style for linked elements**

Append to the CSS file:

```css
.yd-event-text--linked,
.yd-taskbox-name--linked {
  cursor: pointer;
}
```

- [ ] **Step 6.3: Commit**

```bash
git add styles.css   # or whichever file was found
git commit -m "feat: add pointer cursor for note-linked event text and box names"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Implemented in |
|-------------|---------------|
| 新建事件 → 创建 MD 文件 | Task 4.2, 4.3, 4.4 |
| 点击 checkbox → 更新完成状态 | Task 4.6 |
| 点击事件文字 → 跳转 MD | Task 4.5 |
| 重命名 MD → 同步事件标题 | Task 1 (`handleFileRename`), Task 3 |
| 删除事件 → 文件移入回收站 | Task 4.7 |
| 新建盒子 → 创建 MD 文件 | Task 5.2 |
| 点击盒子标题 → 跳转 MD | Task 5.3, 5.5 |
| 重命名 MD → 同步盒子名称 | Task 1 (`handleFileRename`), Task 3 |
| 删除盒子 → 文件移入回收站 | Task 5.11 |
| UI 增删/勾选任务 → 同步 MD checklist | Task 5.7, 5.8, 5.9, 5.10 |
| MD checklist 改动 → 同步到插件数据 | Task 1 (`handleFileModify`), Task 3 |
| 外层面板任务改为 checkbox | Task 5.4 |
| 文件存储在 Habit Dashboard/Events 和 Tasks | Task 1 (`EVENTS_FOLDER`, `TASKS_FOLDER`) |
| 防止无限同步循环 | Task 1 (`_pendingWrites`) |

No gaps found.
