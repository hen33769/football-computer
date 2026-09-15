# Header 开赛提醒分钟 Badge Research

日期：2026-09-14

## 需求

- Header 的开赛通知铃铛增加 Badge，显示当前临近比赛中距离开赛最近的一场还剩多少分钟。

## 现有实现

- `app/components/AppShellHeader.tsx` 仅在 `startReminderMatches` 非空时显示铃铛和 Popover，目前 Tooltip/aria-label 只描述临近比赛数量。
- `app/match-start-reminder.ts` 的 `collectCurrentMatchStartItems()` 已过滤未来 30 分钟窗口、排除取消/已开赛比赛，并按 `kickoffAt` 升序排列。
- 每项已有向上取整且最少为 1 的 `minutesUntil`；`FootballApp` 使用现有 30 秒 `saleClock` 重新派生列表，因此不需要新增前端计时器。

## 结论与约束

- Badge 直接使用排序后第一项的 `minutesUntil`，显示为紧凑的 `N分`。
- Tooltip 和 aria-label 同时包含最近一场剩余分钟数及窗口内比赛总数。
- 无临近比赛时沿用现状，不显示铃铛和 Badge。
- 不改变提醒窗口、Popover 内容、一次性弹窗、本地存储、API 或 D1 数据。

## 风险与验证

- 多场比赛必须显示最早开赛场次的分钟数，而不是比赛数量或列表末项。
- 需检查较长的两位数分钟 Badge 在桌面和 390px 移动端不会遮挡铃铛或破坏 Header 换行。

