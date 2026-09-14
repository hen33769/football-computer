# 订单操作与开赛铃铛 Planning

日期：2026-09-14

关联 Research：`doc/planning/2026-09-14-header-order-actions-RESEARCH.md`

## 实施步骤

1. [x] 在 `app/match-start-reminder.ts` 增加不依赖 localStorage 的当前临近比赛派生函数及专项测试。
2. [x] 将派生列表从 `FootballApp` 传给 `AppShellHeader`，新增条件显示的铃铛 Popover。
3. [x] 将“添加订单”移动到订单页操作区最左侧，并将五个操作改为 Tooltip 图标按钮。
4. [x] 增加 header/订单操作区及铃铛 Popover 的响应式样式。
5. [x] 运行测试、Lint、构建，并用桌面和浏览器验证关键交互。
6. [x] 回填实施结果和验证结果。

## 数据与兼容

- 不新增 API、数据库字段、迁移或持久化 key。
- 铃铛列表仅从当前公共 `matches` 内存数据派生；既有 localStorage 一次性弹窗提醒逻辑不变。

## 验证方案

- 单测覆盖临近比赛筛选、边界、去重和排序。
- 浏览器验证：无临近比赛时无铃铛；有临近比赛时 header 仅显示铃铛，点击 Popover 展示比赛；订单页添加订单位于最左侧；五个操作均为图标且 Tooltip 文案正确；响应式样式保持弹性换行。

## 实施结果

- 新增 `collectCurrentMatchStartItems`，复用开赛时间和 30 分钟窗口判断，但不读取或写入一次性提醒 localStorage，因此 Popover 始终展示当前仍在窗口内的比赛。
- header 原添加订单位置改为条件铃铛；订单页标题操作区按“添加订单、展开、更新倍率、锁定、支付、结账”排列为图标按钮，保留 Tooltip、aria-label、loading、disabled 和原有确认逻辑。
- 增加 header 铃铛列表、操作区图标按钮和移动端响应式样式；不新增 API、D1 字段或迁移。

## 验证结果

- `npm test`：152 项全部通过。
- `npm run lint`：通过，0 error；保留 3 条仓库原有 `<img>` 警告。
- `npm run build`：通过；仅有既有图标 barrel、chunk 和动态 API 分类提示。
- 浏览器：有两场临近比赛时铃铛出现，Popover 展示场次、联赛、主客队、时间和剩余分钟；订单页六个操作按钮均无文字且顺序正确；删除临时数据后铃铛隐藏，页面无新控制台错误。
- 浏览器验证用的两条本地 D1 临时比赛已删除。
