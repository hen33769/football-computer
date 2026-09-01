# 订单已支付筛选与筛选收入 Research

## 需求

- 订单页面的“订单状态”筛选增加“已支付”。
- 订单页面的“筛选收入”要统计筛选结果中的全部成功订单，包括尚未结账但已经根据当前命中结果计算出奖金的订单。

## 现状

- `app/FootballApp.tsx` 将“成功 / 有希望 / 失败”作为 `OrderStatusFilter`，而“已支付 / 未支付”目前只在订单进度筛选中处理；云端订单查询通过 `status` 参数传递状态筛选。
- `app/server/orders-service.ts` 的列表 SQL 只按 `status` 列筛选，`payment_status` 仅支持进度筛选中的 `unpaid`，因此云端不能表达“已支付”状态筛选，也不能正确组合“已支付”和成功等状态。
- 订单页当前使用 `orderLedgerTotals(filteredSavedSlips).income` 作为“筛选收入”。该汇总只读取 `settledPrize`，未结账订单没有 `settledPrize`，所以未结账成功订单被遗漏；同时筛选收入应只统计已支付订单，未支付订单即使已有当前奖金也不能计入。
- `getOrderStatus` 已将 `settledPrize` 与当前 `calculateCurrentPrize(...)` 的较大值判断为成功；`calculateCurrentPrize` 可以直接计算未结账订单的当前奖金。
- `orderLedgerTotals` 同时服务于游客端累计财务趋势和导入账本差额，不能直接改变为包含未结账成功订单，否则会污染累计账本口径。

## 约束与风险

- 多选“订单状态”现有语义为 OR；“已支付”是支付字段的伪状态，和成功 / 有希望 / 失败组合时应使用 `payment_status = 'paid' OR status IN (...)`，与日期、结账进度等其他筛选维度保持 AND。
- 订单数据、D1 表结构和累计财务统计口径不变，不新增迁移。
- 筛选收入仅用于订单页当前筛选摘要：已支付成功订单使用 `max(settledPrize, calculateCurrentPrize(...))`，未支付或其他状态收入为 0；不修改累计收入或财务趋势。

## 相关文件

- `app/FootballApp.tsx`：订单筛选状态、云端查询和筛选摘要。
- `app/api-client/orders.ts`：云端订单筛选类型。
- `app/api/orders/route.ts`：订单筛选参数解析。
- `app/server/orders-service.ts`：D1 列表筛选条件。
- `app/imports.ts`：现有全局订单账本汇总，保持不变。
- `app/calculator.ts`：订单状态和当前奖金计算。
- `tests/calculator.test.ts`、`tests/orders-service.test.ts`：补充纯函数和云端筛选回归测试。

## 待确认问题

- 无。按现有多选状态筛选的 OR 语义实现“已支付”，并将筛选收入限定为订单页摘要口径。
