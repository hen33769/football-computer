# 订单状态移除已支付选项 Planning

日期：2026-09-10

关联 Research：`doc/planning/2026-09-10-order-status-paid-option-removal-RESEARCH.md`

## 目标

- 让“订单状态”只表达赛果状态。
- 让“已支付”只通过“订单进度”筛选。
- 保持本地、客户端查询与服务端 SQL 语义一致。

## 实施方案

1. 从页面和 API client 的 `OrderStatusFilter` 中移除 `paid`。
2. 删除订单状态下拉中的“已支付”选项，并简化本地状态过滤为 `getOrderStatus` 比较。
3. 删除服务端 `status=paid` 的特殊 OR/付款条件，仅接受成功、有希望、失败三个赛果状态。
4. 调整服务端测试，验证遗留的 `status=paid` 被忽略，并确认 `progress=paid` 与赛果状态按 AND 组合。
5. 运行 diff 检查、完整测试、Lint、构建及浏览器验证。

## 接口、数据与兼容

- `status` 查询参数的有效值收窄为 `success`、`hopeful`、`failed`；未知值继续被忽略。
- 付款筛选统一使用 `progress=paid`，不改变 `payment_status` 数据或订单结构。
- 不需要 D1 迁移。
- 本次不提交、不推送、不部署，因此不调整版本号或 `UPDATE.md`。

## TODO

- [x] 完成页面、客户端、服务端与测试 Research。
- [x] 确认付款筛选统一使用 `progress=paid`。
- [x] 移除订单状态中的 `paid` 类型、选项和查询分支。
- [x] 更新自动化测试。
- [x] 完成测试、Lint、构建和浏览器验证。
- [x] 回填实施结果与验证结果。

## 实施结果

- “订单状态”选项现为不限、成功、有希望、失败，不再包含已支付。
- 页面与 API client 的状态类型均收窄为三个赛果状态；本地筛选直接比较 `getOrderStatus`。
- 服务端不再把 `status=paid` 转换为付款条件；遗留伪状态会像其它未知状态一样被忽略。
- “订单进度”的 `paid` 保持不变，继续映射 `payment_status = 'paid'`，并与赛果状态按 AND 组合。
- 未修改支付状态、赛果状态字段或数据库结构。

## 验证结果

- `git diff --check`：通过。
- `npm test`：137 项全部通过；覆盖遗留 `status=paid` 被忽略，以及 `progress=paid` 与成功状态按 AND 组合。
- `npm run lint`：通过，保留项目已有的 3 条 `<img>` 优化 warning，无 error。
- `npm run build`：Cloudflare 生产构建通过。
- 浏览器展开“订单状态”后仅显示不限、成功、有希望、失败；未出现已支付。
- 浏览器控制台无 warning/error。
