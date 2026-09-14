# 订单操作与开赛铃铛 Research

日期：2026-09-14

## 需求拆解

1. 订单页标题操作区目前有“展开全部选项、更新倍率、锁定倍率、一键支付、一键结账”五个文字按钮；改为仅显示图标，使用 Tooltip 和 aria-label 提供悬停及无障碍文案。
2. header 现有“添加订单”只在订单页显示；移除该位置的入口，在订单页标题操作区最左侧放置“添加订单”。
3. header 原“添加订单”位置新增仅有铃铛图标的按钮；仅在当前公共比赛中存在未来 30 分钟内开赛的比赛时显示，点击 Popover 展示当前临近比赛信息。

## 现有实现

- `app/components/AppShellHeader.tsx` 负责 header 导航和账号 Popover，当前通过 `onAddOrder` 在订单页渲染添加订单按钮。
- `app/FootballApp.tsx` 的订单页标题区渲染五个操作按钮；同文件已有 `startReminderItems` 受控 Modal 状态，但该状态只包含尚未写入本地提醒记录的新批次。
- `app/match-start-reminder.ts` 已提供 30 分钟窗口判断、开赛时间解析和标准化比赛 ID；localStorage 记录只用于一次性全局弹窗去重。
- `app/globals.css` 已有 header 操作和 Popover 菜单样式，订单标题区使用 Ant Design `Space`，移动端支持换行。

## 约束与设计结论

- 铃铛 Popover 展示“当前存在”的全部临近公共比赛，不因该比赛此前已弹过一次全局提醒而隐藏；因此新增不写入 localStorage 的纯函数，复用同一时间窗口和标准化 ID 规则。
- 当前临近比赛列表按开赛时间、场次号、标准化 ID 排序并去重，展示联赛、开赛时间、主客队和约剩余分钟数。
- header 铃铛按钮本身在列表为空时不渲染；有列表时不显示文字，仅保留 `BellOutlined`，使用 Tooltip/aria-label 说明数量。
- 订单标题操作保留现有 disabled、loading、Popover 确认和回调语义，只收敛视觉为图标按钮；“添加订单”沿用 `openManualOrder` 回调。
- 不新增 API、D1 字段或迁移；所有数据来自当前页面 `matches` 和既有 30 秒/可见性时钟。

## 风险与验证重点

- header 与订单页共用临近比赛派生列表，需确认 30 秒驻留和页面恢复可见时列表会同步更新。
- 图标按钮必须保留明确的 Tooltip 和 `aria-label`，避免移动端没有可见文案时无法理解。
- 需验证订单页按钮顺序、header 铃铛仅在有临近比赛时出现、Popover 信息及桌面/390px 移动端无横向溢出。
