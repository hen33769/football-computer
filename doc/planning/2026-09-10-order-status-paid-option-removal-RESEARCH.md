# 订单状态移除已支付选项 Research

日期：2026-09-10

## 需求理解

- 从订单页“订单状态”多选框中移除“已支付”。
- “已支付”属于付款/处理进度，只保留在“订单进度”单选框中。
- 成功、有希望、失败继续作为互斥的赛果状态，可在“订单状态”中多选并按 OR 筛选。

## 当前实现

- `app/FootballApp.tsx` 的 `OrderProgressFilter` 已包含 `paid`，订单进度下拉也已有“已支付”。
- 同一文件的 `OrderStatusFilter` 和订单状态下拉仍包含 `paid`；本地筛选为其设置了 `isOrderPaid` 特例。
- `app/api-client/orders.ts` 允许通过 `status=paid` 发送该伪状态。
- `app/server/orders-service.ts` 会把状态列表中的 `paid` 转为 `payment_status = 'paid'`，并在与赛果状态组合时使用 OR。
- `tests/orders-service.test.ts` 同时覆盖旧的状态伪值和新的 `progress=paid` 路径。

## 实现约束与风险

- 前端、客户端类型、本地筛选和服务端查询口径应同时收敛，避免界面隐藏选项但内部仍把付款状态当作赛果状态。
- 服务端继续忽略未知 `status` 值，旧客户端若发送 `status=paid` 不报错，但不再触发付款筛选；应使用 `progress=paid`。
- `progress=paid` 必须继续与成功、有希望、失败按 AND 组合。
- 不改变订单支付状态、赛果状态的存储字段，也不修改支付、结账、统计或卡片标签。
- 不涉及数据库迁移。

## 预计影响文件

- `app/FootballApp.tsx`：移除订单状态选项和本地筛选特例，收窄状态类型。
- `app/api-client/orders.ts`：从客户端状态筛选类型中移除 `paid`。
- `app/server/orders-service.ts`：移除 `status=paid` 的伪状态查询分支。
- `tests/orders-service.test.ts`：将旧行为测试改为验证 `status=paid` 被忽略，并保留 `progress=paid` 组合测试。
- `doc/planning/2026-09-10-order-status-paid-option-removal-PLANNING.md`：记录计划、TODO 和验证结果。

## 验证重点

- 订单状态仅有不限、成功、有希望、失败，不再出现已支付。
- 订单进度仍包含已支付，选择后筛选到 `payment_status = 'paid'`。
- 已支付进度与赛果状态组合时仍为 AND。
- 本地和云端查询行为一致，完整测试、Lint、构建通过。
