# 打卡周期功能设计

**日期：** 2026-06-09

## 需求概述

打卡项目支持设置自定义周期天数（默认每天=1天）。设置了周期的项目，在上次打卡后需等待对应天数，才会在主界面重新出现。历史日期视图中始终显示全部项目，不受周期影响。

## 数据层

### item 结构变更

新增 `cycleDays` 字段（整数，≥1，默认 1）：

```js
{ id, name, color, order, cycleDays: 1 }
```

### store.js — normalizeCheckIn 变更

item 映射中加：
```js
cycleDays: Number.isFinite(item?.cycleDays) && item.cycleDays >= 1
  ? Math.floor(item.cycleDays)
  : 1
```

向后兼容：旧数据无此字段时自动补 1。

## 计算逻辑（check-in.js）

### getLastCheckInDateKey(settings, itemId)

扫描 `records[itemId]`，返回所有值为 `true` 的 dateKey 中最大的一个（字典序即日期序），无记录则返回 `null`。

### isItemDueToday(settings, item)

```
if cycleDays <= 1 → true（每天）
if no last check-in → true（从未打卡，显示）
if lastDate + cycleDays <= today → true（已到期）
else → false（冷却中）
```

日期计算使用本地时间，基于已有的 `parseDateKey` / `formatDateKey` / `MS_PER_DAY`。

### getVisibleItems(settings, focusDateKey)

```
if focusDateKey != today → getItems(settings)（全量，历史视图）
else → getItems(settings).filter(item => isItemDueToday(settings, item))
```

## 渲染层

**renderCheckInSection（check-in.js）：**
- 将 `getItems(settings)` 换成 `getVisibleItems(settings, dateKey)`
- 其余代码不变

## 设置 UI

在 `renderCheckInSettings` 每行 item 中，名称输入框与删除按钮之间新增：
- `<input type="number" min="1" max="365">` 数字输入框，紧凑宽度
- 旁边文字标签（中文："天"，英文："days"）
- `onchange` 即时保存，与 name 输入框行为一致

## i18n

| key | 中文 | 英文 |
|-----|------|------|
| `checkIn.cycleDays` | 天 | days |

## 不变的部分

- 月视图（renderCheckInMonthly）：不受影响，展示历史记录
- 打卡记录数据结构（records）：不变
- 历史日期查看：显示全部 items

## 约束

- cycleDays 为整数，范围 1–365
- 无需前置确认弹窗，输入框直接保存
