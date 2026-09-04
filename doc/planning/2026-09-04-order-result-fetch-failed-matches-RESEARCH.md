# 订单页失败比赛重新获取赛果 Research

## 需求边界

- 订单页赛果卡片应包含订单中已经显示为“失败”、但没有通过接口取得并保存赛果值的比赛。
- 这些比赛仍可使用现有单场“获取赛果”接口获取结果，并通过现有“一键判断并保存”流程写回订单。
- 已经有完整保存赛果值的失败比赛继续保持已判断状态，不因本次改动重复请求或改变既有结算语义。

## 现有实现与根因

- `app/FootballApp.tsx` 的 `resultMatches` 从当前筛选订单提取已选比赛，并过滤 `!isOrderMatchJudged(slip, match)`。
- `app/results.ts` 的 `isOrderMatchJudged` 当前将 `failedMatches` 中的比赛直接视为已判断；这适用于已经根据赛果判断为失败的比赛，但也覆盖了用户手动标记失败、尚未写入 `resultValues` 的情况。
- 订单卡片只展示 `hits`、`resultValues` 和 `failedMatches` 的摘要；`resultValues` 是唯一能从订单持久化数据中确认已有赛果判断值的字段。压缩云端订单不会保存 `MatchItem.result`，因此不能依赖订单比赛上的 `result` 判断接口来源。
- `requestMatchResult` 已支持订单页单场调用比分与让球接口，并把结果放入 `matchResults`；`judgeVisibleOrders` 使用同一结果集合调用 `judgeLoadedOrdersWithResults`，再通过 `commitOrderMutation` 保存 `hits`、`resultValues` 和失败状态。无需新增接口或数据库字段。

## 约束与风险

- 不能简单删除 `isOrderMatchJudged` 的失败判断，否则已取得赛果且已判定失败的订单会在每次打开订单页时重复出现在赛果卡片中。
- 只把“失败标记存在且该比赛没有非空 `resultValues`”作为赛果卡候选；已有部分或完整赛果值的失败比赛继续排除，保持部分赛果补齐和已完成判断的既有行为。
- 赛果候选按标准化比赛 ID 去重，仍优先使用当前全局比赛数据作为接口参数，找不到时回退订单快照。
- 本次不改变 `judgeSlipWithResults`、D1 表结构、订单压缩格式、结算规则或发布流程。

## 相关测试

- `tests/calculator.test.ts` 已覆盖 `isOrderMatchJudged` 的失败和部分赛果语义；应补充失败标记但没有结果值时可被重新识别为待获取项的纯函数测试。
- `app/FootballApp.tsx` 的候选集合属于组件内 `useMemo`，不适合在现有 Node 单元测试中直接挂载；候选判定应下沉到 `app/results.ts` 的纯函数，供页面和测试复用。

## 待实现结论

- 新增一个明确表达“失败但仍缺少保存赛果”的判断函数，订单页 `resultMatches` 在原有未判断条件之外纳入该函数命中的比赛。
- 保留现有接口获取、结果解析、按 ID 合并和“一键判断并保存”流程；补充成功修正失败项以及仍无结果值时继续候选的测试。
