"use strict";

const EVENTS_FOLDER = "Habit Dashboard/Events";
const TASKS_FOLDER = "Habit Dashboard/Tasks";

// Ref-counted map of paths currently being written by this plugin.
// Using a Map<path, count> instead of Set so two rapid writes don't lose the second token.
const _pendingWrites = new Map();
// Paths being intentionally trashed by the plugin — handleFileDelete skips these.
const _pendingDeletes = new Set();

function _addPendingWrite(filePath) {
  _pendingWrites.set(filePath, (_pendingWrites.get(filePath) || 0) + 1);
}

function _consumePendingWrite(filePath) {
  const n = _pendingWrites.get(filePath);
  if (!n) return false;
  if (n <= 1) _pendingWrites.delete(filePath);
  else _pendingWrites.set(filePath, n - 1);
  return true;
}

const { makeId } = require("./store");
const { coerceFrontmatterDate } = require("./date-utils");
const { TFile } = require("obsidian");

function sanitizeFilename(str) {
  return (str || "").replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "untitled";
}

function formatLocalDateTime(date) {
  const d = date || new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
  const now = formatLocalDateTime(new Date());
  const content =
    `---\ntype: yori-event\ndate: ${dateKey}\ncreated: ${now}\nstartedAt: null\ncompleted: false\ncompletedAt: null\n---\n\n# ${title}\n`;
  await app.vault.create(filePath, content);
  return filePath;
}

async function createBoxNote(app, { name }) {
  await ensureFolder(app, TASKS_FOLDER);
  const safeName = sanitizeFilename(name);
  const filePath = await findUniquePath(app, TASKS_FOLDER, safeName);
  const now = formatLocalDateTime(new Date());
  const content =
    `---\ntype: yori-box\ncreated: ${now}\n---\n\n# ${name}\n\n## 子任务\n\n`;
  await app.vault.create(filePath, content);
  return filePath;
}

async function openNote(app, noteOpenMode, filePath) {
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
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    _pendingDeletes.add(filePath);
    await app.fileManager.trashFile(file);
  }
}

async function updateEventFrontmatter(app, filePath, partial) {
  if (!filePath) return;
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;
  _addPendingWrite(filePath);
  try {
    await app.fileManager.processFrontMatter(file, (fm) => {
      if ("completed" in partial) fm.completed = partial.completed;
      if ("completedAt" in partial) fm.completedAt = partial.completedAt ?? null;
      if ("startedAt" in partial) fm.startedAt = partial.startedAt ?? null;
      if ("date" in partial) fm.date = partial.date;
    });
  } catch (e) {
    _consumePendingWrite(filePath);
    throw e;
  }
}

function getEventFrontmatter(app, filePath) {
  if (!filePath) return null;
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return null;
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm) return null;
  return {
    completed: typeof fm.completed === "boolean" ? fm.completed : undefined,
    completedAt: coerceFrontmatterDate(fm.completedAt),
    startedAt: coerceFrontmatterDate(fm.startedAt)
  };
}

async function writeBoxChecklist(app, filePath, tasks) {
  if (!filePath) return;
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
  _addPendingWrite(filePath);
  try {
    await app.vault.modify(file, newLines.join("\n"));
  } catch (e) {
    _consumePendingWrite(filePath);
    throw e;
  }
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
          const datePrefixRe = /^\d{4}-\d{2}-\d{2}-/;
          event.title = datePrefixRe.test(file.basename)
            ? file.basename.replace(datePrefixRe, "")
            : file.basename;
          event.filePath = newPath;
          changed = true;
          break outer;
        }
      }
    }
  } else if (isYoriBoxFile(oldPath) || isYoriBoxFile(newPath)) {
    const boxes = plugin.settings.data.taskBox?.boxes || [];
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

// Called via metadataCache.on('changed') so frontmatter is already up-to-date.
async function handleEventMetadataChanged(plugin, file) {
  if (!(file instanceof TFile)) return;
  const filePath = file.path;
  if (!isYoriEventFile(filePath)) return;
  if (_consumePendingWrite(filePath)) return;

  const cache = plugin.app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter;
  if (!fm) return;

  const dailyEvents = plugin.settings.data.dailyEvents || {};
  let matchedEvent = null;
  for (const dateKey of Object.keys(dailyEvents)) {
    const list = dailyEvents[dateKey];
    if (!Array.isArray(list)) continue;
    const found = list.find((e) => e.filePath === filePath);
    if (found) { matchedEvent = found; break; }
  }
  if (!matchedEvent) return;

  const fileCompleted = !!fm.completed;
  if (fileCompleted === matchedEvent.completed) return;

  const newCompletedAt = fileCompleted ? formatLocalDateTime(new Date()) : null;

  _addPendingWrite(filePath);
  try {
    await plugin.app.fileManager.processFrontMatter(file, (fmObj) => {
      fmObj.completedAt = newCompletedAt;
    });
  } catch (e) {
    _consumePendingWrite(filePath);
    return; // File write failed — don't persist inconsistent state
  }

  matchedEvent.completed = fileCompleted;
  matchedEvent.completedAt = newCompletedAt;
  await plugin.saveData(plugin.settings);
  plugin.refreshAllViews();
}

async function handleFileModify(plugin, file) {
  if (!(file instanceof TFile)) return;
  const filePath = file.path;

  // Event file completed sync is handled by handleEventMetadataChanged via metadataCache.changed.
  if (!isYoriBoxFile(filePath)) return;
  if (_consumePendingWrite(filePath)) return;

  const boxes = plugin.settings.data.taskBox?.boxes || [];
  const box = boxes.find((b) => b.filePath === filePath);
  if (!box) return;

  const content = await plugin.app.vault.read(file);
  const parsed = parseBoxChecklist(content);

  const allTasks = plugin.settings.data.taskBox?.tasks || [];
  const boxTasks = allTasks
    .filter((t) => t.boxId === box.id)
    .sort((a, b) => a.order - b.order);

  const parsedTitles = new Set(parsed.map((p) => p.title));
  const existingTitles = new Set(boxTasks.map((t) => t.title));
  // Note: title-based diffing does not support duplicate task titles within a box.
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

async function handleFileDelete(plugin, file) {
  if (!(file instanceof TFile)) return;
  const filePath = file.path;
  // Skip deletes initiated by the plugin itself (caller already handles data cleanup).
  if (_pendingDeletes.has(filePath)) {
    _pendingDeletes.delete(filePath);
    return;
  }
  let changed = false;

  if (isYoriEventFile(filePath)) {
    const dailyEvents = plugin.settings.data.dailyEvents || {};
    for (const dateKey of Object.keys(dailyEvents)) {
      const list = dailyEvents[dateKey];
      if (!Array.isArray(list)) continue;
      const idx = list.findIndex((e) => e.filePath === filePath);
      if (idx !== -1) {
        list.splice(idx, 1);
        if (list.length === 0) delete dailyEvents[dateKey];
        changed = true;
        break;
      }
    }
  } else if (isYoriBoxFile(filePath)) {
    const boxes = plugin.settings.data.taskBox?.boxes || [];
    const boxIdx = boxes.findIndex((b) => b.filePath === filePath);
    if (boxIdx !== -1) {
      const boxId = boxes[boxIdx].id;
      boxes.splice(boxIdx, 1);
      boxes.forEach((b, i) => { b.order = i; });
      plugin.settings.data.taskBox.tasks =
        (plugin.settings.data.taskBox.tasks || []).filter((t) => t.boxId !== boxId);
      changed = true;
    }
  }

  if (changed) {
    await plugin.saveData(plugin.settings);
    plugin.refreshAllViews();
  }
}

async function hasExtraContent(app, filePath) {
  if (!filePath) return false;
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return false;
  const content = await app.vault.read(file);
  // Strip YAML frontmatter block, then leading whitespace, then the template H1 line
  const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const withoutH1 = withoutFrontmatter.trimStart().replace(/^#[^\n]*\n?/, "");
  return withoutH1.trim().length > 0;
}

// Removes the file association from an event and deletes its MD file,
// without triggering handleFileDelete (so the event stays in dailyEvents).
async function disassociateAndDeleteNote(app, settings, dateKey, eventId) {
  const list = settings.data?.dailyEvents?.[dateKey];
  if (!Array.isArray(list)) return;
  const event = list.find((e) => e.id === eventId);
  if (!event || !event.filePath) return;
  const filePath = event.filePath;
  event.filePath = null;
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    _pendingDeletes.add(filePath);
    await app.fileManager.trashFile(file);
  }
}

module.exports = {
  formatLocalDateTime,
  createEventNote,
  createBoxNote,
  openNote,
  trashNote,
  updateEventFrontmatter,
  getEventFrontmatter,
  writeBoxChecklist,
  parseBoxChecklist,
  isYoriEventFile,
  isYoriBoxFile,
  handleFileRename,
  handleFileModify,
  handleEventMetadataChanged,
  handleFileDelete,
  hasExtraContent,
  disassociateAndDeleteNote
};
