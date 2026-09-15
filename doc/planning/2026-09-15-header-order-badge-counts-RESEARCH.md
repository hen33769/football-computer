# Header 订单 Badge 统计 Research

日期：2026-09-15

## 相关文件

- `app/components/AppShellHeader.tsx`：Header 订单按钮与 Badge。
- `app/FootballApp.tsx`：本地/云端订单状态及 Header 参数。
- `app/api-client/orders.ts`、`app/server/orders-service.ts`：订单列表响应与全量统计。
- `app/FootballRoute.tsx`、`app/cloud.ts`：云端个人数据缓存及订单变更后的增量计数。
- `app/order-model.ts`：支付、待结账和订单状态口径。

## 现有行为

- Header 订单 Badge 使用 `unsettledOrderCount`，统计所有 `settledAt` 为空的订单，无法区分未支付、是否仍有希望以及是否已支付。
- 云端列表虽然会被日期和进度筛选，但 `unsettledCount` 由服务端按账号全量计算，因此 Header 数字不会被页面筛选范围截断。
- 订单创建、支付、判断、结账、撤回和删除后，`FootballRoute` 会根据旧、新订单增量维护全量计数，避免每次额外读取全部订单。

## 目标口径

- `未支付且有希望`：`paymentStatus !== "paid"` 且订单状态为 `hopeful`。
- `待结账`：`paymentStatus === "paid"` 且 `settledAt` 为空，与新增订单进度筛选口径一致。
- Badge 数字为两个互斥集合数量之和。
- Badge hover 显示：`未支付且有希望 X 单 + 待结账 Y 单`，让数字来源可核对。
- 云端服务端返回两个未受页面筛选影响的账号全量统计；本地游客模式直接从全部本地订单计算。

## 约束与风险

- 不能从当前筛选结果直接计算云端 Badge，否则默认“待结账”和日期筛选会漏掉其它订单。
- 支付、判断赛果、撤回或结账均可能让订单在两个集合之间进出，增量缓存必须按变更前后状态分别计算。
- 不修改订单或 D1 表结构，只增加列表响应统计字段，无需迁移。
- 保留开发者对开赛提醒 Badge 的手动颜色、文字和尺寸调整。

