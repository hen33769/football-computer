# 订单进度已支付过滤 Research

## 需求

- 订单页面的“订单进度”筛选增加“已支付”，按订单支付状态筛选。

## 现状

- `app/FootballApp.tsx` 的订单进度筛选当前支持“已结账 / 未结账 / 未支付”；本地列表过滤通过 `settledAt` 和 `isOrderPaid` 判断。
- `app/api-client/orders.ts`、`app/server/orders-service.ts` 和 `app/api/orders/route.ts` 的进度类型及参数解析只接受 `settled`、`unsettled`、`unpaid`。
- D1 `user_orders.payment_status` 已持久化 `paid` / `unpaid`，订单状态筛选也已经使用该字段支持“已支付”；不需要新增数据库字段或迁移。
- 订单状态中的“已支付”已有独立兼容入口，本次保留，不改变现有状态多选的 OR 语义；进度中的“已支付”作为支付状态条件，与状态、日期、结账进度等维度按 AND 组合。

## 相关文件

- `app/FootballApp.tsx`：订单进度筛选类型、选项、本地过滤和云端查询。
- `app/api-client/orders.ts`：客户端订单进度查询类型。
- `app/api/orders/route.ts`：云端进度参数解析。
- `app/server/orders-service.ts`：D1 列表查询条件。
- `tests/orders-service.test.ts`：云端进度 SQL 回归测试。

## 约束与风险

- 历史订单的 `payment_status` 已有默认值 `unpaid`，旧订单数据无需迁移。
- “已支付”与日期、订单状态等其他筛选维度继续按 AND 组合；“已结账 / 未结账 / 已支付 / 未支付”仍是互斥的单选进度值。
- 这是订单页面交互行为调整；实现后需要运行测试、Lint、构建，并通过桌面端和移动端页面验证筛选选项及控制台无错误。

## 待确认问题

- 无。保留“订单状态”中的既有“已支付”，同时在“订单进度”中增加同名筛选，以满足按进度维度筛选的需求。
