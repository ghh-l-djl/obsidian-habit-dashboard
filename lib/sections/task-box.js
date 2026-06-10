"use strict";

const obsidian = require("obsidian");
const { Notice, Menu, Platform } = obsidian;
const { makeId } = require("../store");
const { ConfirmModal, FullPageModal } = require("../ui-modals");
const { fitTextarea, ensureFocusInput, createIconButton } = require("../dom-utils");
const { attachMobilePanelKeyboardScroll } = require("../mobile-composer-scroll");
const noteManager = require("../note-manager");

function getBoxes(settings) {
  const list = settings?.data?.taskBox?.boxes || [];
  return list.slice().sort((a, b) => a.order - b.order);
}

function getTasksForBox(settings, boxId) {
  const list = settings?.data?.taskBox?.tasks || [];
  return list
    .filter((task) => task.boxId === boxId)
    .sort((a, b) => a.order - b.order);
}

function setBoxes(settings, boxes) {
  if (!settings?.data?.taskBox) return;
  boxes.forEach((box, idx) => { box.order = idx; });
  settings.data.taskBox.boxes = boxes;
}

function createTask(settings, boxId, title) {
  if (!settings?.data?.taskBox) return null;
  const list = getTasksForBox(settings, boxId);
  const task = {
    id: makeId("task"),
    boxId,
    title: (title || "").trim(),
    completed: false,
    order: list.length
  };
  settings.data.taskBox.tasks.push(task);
  return task;
}

function updateTask(settings, taskId, partial) {
  const tasks = settings?.data?.taskBox?.tasks || [];
  const idx = tasks.findIndex((task) => task.id === taskId);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...partial };
  return tasks[idx];
}

function deleteTask(settings, taskId) {
  if (!settings?.data?.taskBox) return;
  const tasks = settings.data.taskBox.tasks || [];
  const filtered = tasks.filter((task) => task.id !== taskId);
  settings.data.taskBox.tasks = filtered;
  const byBox = {};
  filtered.forEach((task) => {
    const list = byBox[task.boxId] || (byBox[task.boxId] = []);
    list.push(task);
  });
  Object.values(byBox).forEach((list) => {
    list.sort((a, b) => a.order - b.order);
    list.forEach((task, idx) => { task.order = idx; });
  });
}

function clearCompletedTasksInBox(settings, boxId) {
  if (!settings?.data?.taskBox || !boxId) return 0;
  const tasks = settings.data.taskBox.tasks || [];
  const before = tasks.filter((task) => task.boxId === boxId && task.completed).length;
  const filtered = tasks.filter((task) => task.boxId !== boxId || !task.completed);
  settings.data.taskBox.tasks = filtered;
  const byBox = {};
  filtered.forEach((task) => {
    const list = byBox[task.boxId] || (byBox[task.boxId] = []);
    list.push(task);
  });
  Object.values(byBox).forEach((list) => {
    list.sort((a, b) => a.order - b.order);
    list.forEach((task, idx) => { task.order = idx; });
  });
  return before;
}

async function syncBoxChecklist(app, settings, boxId) {
  const box = getBoxes(settings).find((b) => b.id === boxId);
  if (!box || !box.filePath) return;
  try {
    await noteManager.writeBoxChecklist(app, box.filePath, getTasksForBox(settings, boxId));
  } catch (e) {
    new Notice(`同步任务清单失败: ${e.message}`);
  }
}

function deleteBox(settings, boxId) {
  if (!settings?.data?.taskBox) return;
  settings.data.taskBox.boxes = (settings.data.taskBox.boxes || []).filter((box) => box.id !== boxId);
  settings.data.taskBox.boxes.forEach((box, idx) => { box.order = idx; });
  settings.data.taskBox.tasks = (settings.data.taskBox.tasks || []).filter((task) => task.boxId !== boxId);
}

function renderTaskBoxSection(parent, ctx) {
  const { settings, t } = ctx;
  if (settings.showSection?.taskBox === false) return;
  const wrap = parent.createDiv({ cls: "yd-section yd-section-taskbox" });
  const header = wrap.createDiv({ cls: "yd-section-header yd-section-header-center" });
  header.createSpan({ cls: "yd-section-title", text: t("section.taskBox") });
  createIconButton(header, "sliders-horizontal", {
    cls: "yd-section-icon",
    label: t("common.settings"),
    fallback: "≡",
    onClick: () => openTaskBoxSettings(ctx)
  });

  const boxes = getBoxes(settings);
  const list = wrap.createDiv({ cls: "yd-taskbox-list" });
  const limit = ctx.getLimit("taskBox");
  list.style.maxHeight = `${limit * 30 + 4}px`;
  boxes.forEach((box) => {
    const boxEl = list.createDiv({ cls: "yd-taskbox-group" });
    const boxNameEl = boxEl.createDiv({ cls: "yd-taskbox-name", text: box.name || t("common.unnamed") });
    if (box.filePath) {
      boxNameEl.addClass("yd-taskbox-name--linked");
      boxNameEl.onclick = async () => {
        await noteManager.openNote(ctx.app, ctx.settings.noteOpenMode, box.filePath);
      };
    }
    const tasks = getTasksForBox(settings, box.id);
    tasks.forEach((task) => {
      renderTaskRow(boxEl, task, ctx, { variant: "checkbox" });
    });
  });

  if (boxes.length === 0) {
    list.createDiv({ cls: "yd-empty-tip", text: t("taskBox.empty") });
  }

  const footer = wrap.createDiv({ cls: "yd-section-footer" });
  createIconButton(footer, "more-horizontal", {
    cls: "yd-section-more-icon",
    label: t("taskBox.viewMore"),
    fallback: "···",
    onClick: () => openFullTaskBox(ctx)
  });
}

function renderTaskRow(parent, task, ctx, options) {
  const opts = options || {};
  const variant = opts.variant || "checkbox";
  const row = parent.createDiv({ cls: `yd-task-row yd-task-row-${variant}` });
  if (variant === "bullet") {
    row.createSpan({ cls: "yd-task-bullet", text: "·" });
  } else {
    const checkbox = row.createEl("input", { type: "checkbox" });
    checkbox.checked = !!task.completed;
    checkbox.onclick = (evt) => evt.stopPropagation();
    checkbox.onchange = async () => {
      updateTask(ctx.settings, task.id, { completed: checkbox.checked });
      await ctx.save();
      await syncBoxChecklist(ctx.app, ctx.settings, task.boxId);
      if (typeof opts.onChange === "function") opts.onChange();
      else ctx.refresh();
    };
  }
  if (task.completed) row.addClass("is-done");
  const text = row.createDiv({ cls: "yd-task-text", text: task.title || ctx.t("common.unnamed") });
  text.onclick = () => {
    if (text.querySelector("textarea")) return;
    text.empty();
    const editor = text.createEl("textarea", { cls: "yd-event-editor" });
    editor.onclick = (evt) => evt.stopPropagation();
    editor.value = task.title;
    fitTextarea(editor);
    ensureFocusInput(editor);
    let committed = false;
    const commit = async () => {
      if (committed) return;
      committed = true;
      const value = editor.value.trim();
      if (!value) deleteTask(ctx.settings, task.id);
      else updateTask(ctx.settings, task.id, { title: value });
      await ctx.save();
      await syncBoxChecklist(ctx.app, ctx.settings, task.boxId);
      if (typeof opts.onChange === "function") opts.onChange();
      else ctx.refresh();
    };
    editor.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (typeof opts.onChange === "function") opts.onChange();
        else ctx.refresh();
      }
    };
    editor.oninput = () => fitTextarea(editor);
    editor.onblur = commit;
  };
  row.oncontextmenu = (evt) => {
    evt.preventDefault();
    const t = ctx.t;
    const menu = new Menu();
    if (!task.completed) {
      menu.addItem((item) =>
        item.setTitle(t("common.markComplete")).onClick(async () => {
          updateTask(ctx.settings, task.id, { completed: true });
          await ctx.save();
          await syncBoxChecklist(ctx.app, ctx.settings, task.boxId);
          if (typeof opts.onChange === "function") opts.onChange();
          else ctx.refresh();
        })
      );
    }
    if (variant === "checkbox") {
      const completedInBox = getTasksForBox(ctx.settings, task.boxId).filter((x) => x.completed).length;
      if (completedInBox > 0) {
        menu.addItem((item) =>
          item.setTitle(t("taskBox.clearCompleted")).onClick(() => {
            const boxMeta = getBoxes(ctx.settings).find((b) => b.id === task.boxId);
            const boxLabel = boxMeta ? (boxMeta.name || t("common.unnamed")) : t("common.unnamed");
            const confirm = new ConfirmModal(ctx.plugin.app, {
              title: t("taskBox.clearCompleted"),
              message: t("taskBox.clearCompletedConfirm", { name: boxLabel }),
              confirmText: t("common.confirm"),
              cancelText: t("common.cancel"),
              warning: true,
              onConfirm: async () => {
                clearCompletedTasksInBox(ctx.settings, task.boxId);
                await ctx.save();
                await syncBoxChecklist(ctx.app, ctx.settings, task.boxId);
                if (typeof opts.onChange === "function") opts.onChange();
                else ctx.refresh();
              }
            });
            confirm.open();
          })
        );
      }
    }
    menu.addItem((item) =>
      item.setTitle(t("common.delete")).onClick(() => {
        const confirm = new ConfirmModal(ctx.plugin.app, {
          title: t("common.delete"),
          message: t("taskBox.deleteTaskConfirm", { title: task.title || t("common.unnamed") }),
          confirmText: t("common.delete"),
          cancelText: t("common.cancel"),
          warning: true,
          onConfirm: async () => {
            const boxId = task.boxId;
            deleteTask(ctx.settings, task.id);
            await ctx.save();
            await syncBoxChecklist(ctx.app, ctx.settings, boxId);
            if (typeof opts.onChange === "function") opts.onChange();
            else ctx.refresh();
          }
        });
        confirm.open();
      })
    );
    menu.showAtMouseEvent(evt);
  };
}

function renderTaskComposer(parent, ctx, done, moreAction) {
  const { settings, t } = ctx;
  const boxes = getBoxes(settings);
  if (boxes.length === 0) {
    new Notice(t("taskBox.empty"));
    done?.();
    return;
  }
  const wrap = parent.createDiv({ cls: "yd-task-composer" });
  parent.addClass("yd-section--composer-open");
  const headerRow = wrap.createDiv({ cls: "yd-composer-header" });
  const select = headerRow.createEl("select", { cls: "yd-select" });
  boxes.forEach((box) => {
    const option = select.createEl("option", { text: box.name || t("common.unnamed") });
    option.value = box.id;
  });
  let committed = false;
  const cancel = () => {
    if (committed) return;
    committed = true;
    wrap.remove();
    parent.removeClass("yd-section--composer-open");
    done?.();
  };
  if (typeof moreAction === "function") {
    createIconButton(headerRow, "more-horizontal", {
      cls: "yd-section-more-icon yd-composer-more",
      label: t("taskBox.viewMore"),
      fallback: "···",
      onClick: () => {
        cancel();
        moreAction();
      }
    });
  }
  const editor = wrap.createEl("textarea", { cls: "yd-event-editor" });
  editor.placeholder = t("taskBox.placeholderTask");
  ensureFocusInput(editor);
  fitTextarea(editor);
  const finish = async () => {
    if (committed) return;
    committed = true;
    const value = editor.value.trim();
    const boxId = select.value;
    wrap.remove();
    parent.removeClass("yd-section--composer-open");
    if (value && boxId) {
      createTask(settings, boxId, value);
      await ctx.save();
      await syncBoxChecklist(ctx.app, settings, boxId);
      new Notice(`${t("common.add")}: ${value}`);
    }
    done?.();
  };
  editor.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finish();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };
  editor.oninput = () => fitTextarea(editor);
  wrap.addEventListener("focusout", (e) => {
    if (e.relatedTarget && wrap.contains(e.relatedTarget)) return;
    setTimeout(() => {
      if (!wrap.isConnected) return;
      if (document.activeElement && wrap.contains(document.activeElement)) return;
      finish();
    }, 0);
  });
}

function openFullTaskBox(ctx) {
  const { plugin, t } = ctx;
  const modal = new FullPageModal(plugin.app, {
    title: t("taskBox.fullTitle"),
    titleClass: "yd-taskbox-modal",
    render: (root, instance) => renderFullTaskBox(root, ctx, instance),
    onClose: () => ctx.refresh()
  });
  modal.open();
}

function renderFullTaskBox(root, ctx, modal) {
  root.empty();
  const { settings, t } = ctx;
  const boxes = getBoxes(settings);
  const grid = root.createDiv({ cls: "yd-taskbox-fullgrid" });
  const isMobileTb = !!Platform?.isMobile;
  const bumpModal = () => {
    ctx.refresh();
    renderFullTaskBox(root, ctx, modal);
  };
  boxes.forEach((box) => {
    const col = grid.createDiv({ cls: "yd-taskbox-fullcol" });
    let addBtn;
    if (isMobileTb) {
      const titleRow = col.createDiv({ cls: "yd-taskbox-fullhead" });
      const mobileBoxNameEl = titleRow.createDiv({ cls: "yd-taskbox-name", text: box.name || t("common.unnamed") });
      if (box.filePath) {
        mobileBoxNameEl.addClass("yd-taskbox-name--linked");
        mobileBoxNameEl.onclick = async () => {
          await noteManager.openNote(ctx.app, ctx.settings.noteOpenMode, box.filePath);
        };
      }
      addBtn = titleRow.createEl("button", {
        cls: "yd-add-button yd-taskbox-head-add",
        text: t("common.sectionAdd")
      });
    } else {
      const fullBoxNameEl = col.createDiv({ cls: "yd-taskbox-name", text: box.name || t("common.unnamed") });
      if (box.filePath) {
        fullBoxNameEl.addClass("yd-taskbox-name--linked");
        fullBoxNameEl.onclick = async () => {
          await noteManager.openNote(ctx.app, ctx.settings.noteOpenMode, box.filePath);
        };
      }
    }
    const list = col.createDiv({ cls: "yd-taskbox-fulllist" });
    getTasksForBox(settings, box.id).forEach((task) => {
      renderTaskRow(list, task, ctx, { onChange: bumpModal });
    });
    if (!isMobileTb) {
      addBtn = col.createEl("button", { cls: "yd-add-button", text: t("taskBox.addTask") });
    }
    addBtn.onclick = () => {
      if (!isMobileTb) addBtn.style.display = "none";
      const wrap = col.createDiv({ cls: "yd-task-composer" });
      const editor = wrap.createEl("textarea", { cls: "yd-event-editor" });
      editor.placeholder = t("taskBox.placeholderTask");
      ensureFocusInput(editor);
      fitTextarea(editor);
      const keyboardDispose = attachMobilePanelKeyboardScroll(wrap, [editor]);
      let committed = false;
      const finish = async () => {
        if (committed) return;
        committed = true;
        keyboardDispose();
        const value = editor.value.trim();
        wrap.remove();
        if (!isMobileTb) addBtn.style.display = "";
        if (!value) return;
        createTask(settings, box.id, value);
        await ctx.save();
        await syncBoxChecklist(ctx.app, settings, box.id);
        renderFullTaskBox(root, ctx, modal);
      };
      editor.onkeydown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish();
        } else if (e.key === "Escape") {
          e.preventDefault();
          committed = true;
          keyboardDispose();
          wrap.remove();
          if (!isMobileTb) addBtn.style.display = "";
        }
      };
      editor.oninput = () => fitTextarea(editor);
      editor.onblur = finish;
    };
  });
  if (boxes.length === 0) {
    root.createDiv({ cls: "yd-empty-tip", text: t("taskBox.empty") });
  }
}

function openTaskBoxSettings(ctx) {
  const { plugin, t } = ctx;
  const modal = new FullPageModal(plugin.app, {
    title: t("taskBox.settingsTitle"),
    titleClass: "yd-settings-modal",
    render: (root, instance) => renderTaskBoxSettings(root, ctx, instance),
    onClose: () => finalizeTaskBoxSettings(ctx)
  });
  modal.open();
}

let _finalizingSettings = false;
async function finalizeTaskBoxSettings(ctx) {
  if (_finalizingSettings) return;
  _finalizingSettings = true;
  try {
    const boxes = ctx.settings?.data?.taskBox?.boxes;
    if (!Array.isArray(boxes)) return;
    ctx.settings.data.taskBox.boxes = boxes.filter((box) => (box.name || "").trim());
    ctx.settings.data.taskBox.boxes.forEach((box, idx) => { box.order = idx; });
    for (const box of ctx.settings.data.taskBox.boxes) {
      if (!box.filePath && box.name) {
        try {
          box.filePath = await noteManager.createBoxNote(ctx.app, { name: box.name });
        } catch (e) {
          new Notice(`创建笔记失败 (${box.name}): ${e.message}`);
        }
      }
    }
    await ctx.save();
    ctx.refresh();
  } finally {
    _finalizingSettings = false;
  }
}

function renderTaskBoxSettings(root, ctx, modal) {
  root.empty();
  const { settings, t } = ctx;
  root.createDiv({ cls: "yd-settings-desc", text: t("taskBox.settingsDesc") });

  const list = root.createDiv({ cls: "yd-settings-list" });
  const boxes = settings.data.taskBox.boxes;

  boxes.forEach((box, idx) => {
    const row = list.createDiv({ cls: "yd-settings-row" });
    const drag = row.createDiv({ cls: "yd-drag-handle" });
    createIconButton(drag, "grip-vertical", { cls: "yd-drag-handle-icon", fallback: "⋮⋮" });
    drag.setAttribute("draggable", "true");
    drag.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", `${idx}`);
      row.addClass("is-dragging");
    });
    drag.addEventListener("dragend", () => row.removeClass("is-dragging"));
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      row.addClass("is-drop-target");
    });
    row.addEventListener("dragleave", () => row.removeClass("is-drop-target"));
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      row.removeClass("is-drop-target");
      const fromIdx = Number(e.dataTransfer?.getData("text/plain"));
      if (!Number.isFinite(fromIdx) || fromIdx === idx) return;
      const moved = boxes.splice(fromIdx, 1)[0];
      boxes.splice(idx, 0, moved);
      boxes.forEach((entry, i) => { entry.order = i; });
      await ctx.save();
      renderTaskBoxSettings(root, ctx, modal);
    });

    const input = row.createEl("input", { type: "text", cls: "yd-settings-input" });
    input.value = box.name;
    input.placeholder = t("taskBox.boxName");
    input.onchange = async () => {
      box.name = input.value.trim();
      await ctx.save();
    };
    const delBtn = createIconButton(row, "x", {
      cls: "yd-settings-delete",
      label: t("common.delete"),
      fallback: "✕"
    });
    delBtn.onclick = () => {
      const tasks = getTasksForBox(settings, box.id);
      const proceed = async () => {
        await noteManager.trashNote(ctx.app, box.filePath);
        deleteBox(settings, box.id);
        await ctx.save();
        renderTaskBoxSettings(root, ctx, modal);
      };
      if (tasks.length === 0) {
        proceed();
        return;
      }
      const confirm = new ConfirmModal(ctx.plugin.app, {
        title: t("common.delete"),
        message: t("taskBox.deleteBoxConfirm", { name: box.name || t("common.unnamed") }),
        confirmText: t("common.delete"),
        cancelText: t("common.cancel"),
        warning: true,
        onConfirm: proceed
      });
      confirm.open();
    };
  });

  const addBtn = root.createEl("button", { cls: "yd-add-button", text: t("taskBox.addBox") });
  addBtn.onclick = async () => {
    boxes.push({ id: makeId("tb"), name: "", order: boxes.length });
    await ctx.save();
    renderTaskBoxSettings(root, ctx, modal);
  };

  const actions = root.createDiv({ cls: "yd-modal-actions yd-modal-actions-end" });
  const closeBtn = actions.createEl("button", { cls: "yd-modal-confirm", text: t("common.confirm") });
  closeBtn.onclick = () => modal.close();
}

module.exports = {
  render: renderTaskBoxSection,
  openSettings: openTaskBoxSettings,
  openFull: openFullTaskBox,
  getBoxes,
  getTasksForBox,
  createTask,
  updateTask,
  deleteTask,
  deleteBox
};
