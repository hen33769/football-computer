# Header 订单 Badge 统计 Planning

日期：2026-09-15

关联 Research：`doc/planning/2026-09-15-header-order-badge-counts-RESEARCH.md`

## TODO

- [x] 增加可复用的“未支付且有希望”状态判断。
- [x] 订单列表 API 返回全账号的未支付有希望数与待结账数。
- [x] 云端初始化、筛选刷新和订单增量变更同步维护两个统计。
- [x] 本地/云端统一计算 Badge 总数并传给 Header。
- [x] Header Badge hover 显示两个分项及求和逻辑。
- [x] 增加统计 SQL 与状态转换测试。
- [x] 完成全量测试、Lint、构建、桌面/移动端浏览器验证和 diff 检查。
- [x] 回填实施与验证结果。

## 实施结果

- 统一增加 `isOrderUnpaidHopeful` 与既有 `isOrderPendingSettlement` 判断。
- 订单列表服务使用一条不受页面筛选影响的账号全量统计 SQL，同时返回未结账、未支付有希望和待结账数量。
- 云端初始化、列表刷新和订单增量写入均同步维护两个 Badge 分项；游客模式从全部本地订单实时计算。
- Header Badge 显示两项之和，并在 Badge 原生 hover title 与订单按钮无障碍文案中显示 `未支付且有希望 X 单 + 待结账 Y 单`。

## 验证结果

- 状态与统计 SQL 定向测试通过，覆盖未支付有希望、支付、中奖和结账边界。
- 全量测试：`npm test` 173/173 通过。
- `npm run lint` 通过，只有 3 条既有 `<img>` 警告。
- `npm run build` 通过，只有既有图标 barrel 优化和大 chunk 提示。
- 桌面浏览器确认样例分项 1 + 1 时 Badge 显示 2，Badge title 与按钮 aria-label 均包含完整计算逻辑。
- 390×844 移动端确认 Header Badge 与订单页布局正常，文档无横向溢出。
- 浏览器控制台无错误，`git diff --check` 通过。

## 接口与兼容策略

- `GET /api/orders` 响应新增 `unpaidHopefulCount`、`pendingSettlementCount`，保留 `unsettledCount` 兼容既有消费者。
- 统计始终按账号全量订单计算，不叠加日期、进度或订单状态筛选条件。
- 当前不提交、推送或部署，因此不调整版本号与 `UPDATE.md`。
