"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const i18n = require("../lib/i18n");

test("createTranslator switches language", () => {
  let lang = "zh";
  const t = i18n.createTranslator(() => lang);
  assert.equal(t("common.confirm"), "确定");
  lang = "en";
  assert.equal(t("common.confirm"), "Confirm");
});

test("translator interpolates variables", () => {
  const t = i18n.createTranslator(() => "zh");
  const result = t("calendar.deleteConfirmMsg", { title: "示例" });
  assert.match(result, /示例/);
});

test("translator falls back to zh when key missing in target language", () => {
  const t = i18n.createTranslator(() => "en");
  assert.notEqual(t("section.calendar"), "section.calendar");
  const fallbackKey = "_missing_translation_";
  assert.equal(t(fallbackKey), fallbackKey);
});

test("event subtask translations exist in both languages", () => {
  const zh = i18n.createTranslator(() => "zh");
  const en = i18n.createTranslator(() => "en");

  assert.equal(zh("calendar.addSubEvent"), "添加子事件");
  assert.equal(en("calendar.addSubEvent"), "Add sub-event");
  assert.equal(
    zh("calendar.detachedFromLabel", { title: "父事件", date: "2026-06-25" }),
    "原属于「父事件」(2026-06-25)"
  );
  assert.equal(
    en("calendar.detachedFromLabel", { title: "Parent", date: "2026-06-25" }),
    'originally part of "Parent" (2026-06-25)'
  );
});
