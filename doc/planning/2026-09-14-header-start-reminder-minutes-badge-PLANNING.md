# Header 开赛提醒分钟 Badge Planning

日期：2026-09-14

关联 Research：`doc/planning/2026-09-14-header-start-reminder-minutes-badge-RESEARCH.md`

## TODO

- [x] 在 Header 铃铛外增加分钟 Badge，复用最近一场提醒的 `minutesUntil`。
- [x] 更新 Tooltip 与 aria-label，明确最近一场剩余分钟和临近比赛总数。
- [x] 增加 Badge 的紧凑样式，并验证桌面/移动端布局。
- [x] 运行定向测试、全量测试、Lint、构建和 diff 检查。
- [x] 回填实施与验证结果。

## 实施结果

- Header 开赛通知按钮显示最近一场比赛的分钟 Badge；开发者后续将 Badge 文案手动调整为纯数字 `N` 并使用蓝色。
- Badge 直接使用已经按开赛时间排序的第一条提醒；仍由现有 30 秒时钟刷新，不新增计时器或请求。
- Tooltip 与 `aria-label` 同时说明最近一场剩余分钟及 30 分钟内的比赛总数。
- 收紧移动端提醒浮层宽度，为 Ant Popover 的外层留出空间，避免窄屏横向滚动。

## 验证结果

- 定向测试：`./node_modules/.bin/tsx --test tests/match-start-reminder.test.ts`，6/6 通过。
- 全量测试：`npm test`，167/167 通过。
- 代码检查：`npm run lint` 通过；保留 3 条既有 `<img>` 警告，无新增错误。
- 构建：`npm run build` 通过；仅有既有图标 barrel 优化和大 chunk 提示。
- 浏览器：桌面端确认 Badge、Tooltip 和提醒浮层正常；Badge 随现有时钟从 `17分` 更新为 `16分`。
- 浏览器：390×844 移动端确认 Badge 和浮层正常，文档宽度与可视宽度一致，无横向溢出；控制台无错误。
- 差异检查：`git diff --check` 通过。

## 兼容与发布影响

- 仅调整 Header 展示，不改变提醒业务规则、数据结构、API、数据库或持久化。
- 当前不提交、推送或部署，因此不调整版本号与 `UPDATE.md`。
