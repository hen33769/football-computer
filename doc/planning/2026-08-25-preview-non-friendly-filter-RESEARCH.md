# 赛事前瞻非友谊赛筛选 Research

日期：2026-08-25

## 需求理解

- 投注页“赛事前瞻”弹窗内，“历史交锋”和“比赛近况”各有一组筛选标签。
- 在两组“同赛事”左侧分别增加“非友谊赛”，两个开关进入弹窗时都默认选中。
- “非友谊赛”只在前端排除赛事简称为 `俱乐部赛` 的比赛，不增加或改变接口参数。
- 两组开关互相独立；用户可以只为历史交锋或只为比赛近况恢复显示被排除的数据。

## 当前实现

- `app/FootballInsights.tsx` 的 `PreviewFilters` 同时被“历史交锋”和“比赛近况”复用，当前依次渲染“同赛事”和“同主客”。
- 两组数据分别由 `fetchSportteryHistory` 和 `fetchSportteryRecent` 获取；`tournamentFlag`、`homeAwayFlag` 进入请求 key，切换时会重新请求官方接口。
- 历史交锋列表位于 `history.matchList`；比赛近况分为 `recent.home.matchList` 和 `recent.away.matchList`。
- `MatchRowsTable` 使用每条数据的 `tournamentShortName` 展示赛事名称，适合作为前端精确排除字段。
- `app/sporttery-insights.ts` 目前只包含请求 URL、请求方法和静态前瞻数据聚合，没有前端列表过滤函数。

## 实现约束与风险

- 仅排除 `String(tournamentShortName).trim() === "俱乐部赛"`；字段缺失或其它友谊赛名称不应被推断排除。
- 关闭“非友谊赛”后必须复用已经取得的原始数据并立即恢复列表，不能发起额外网络请求。
- 过滤不得修改接口返回数组，避免开关关闭后无法恢复数据。
- 官方接口提供的汇总统计仍按接口原始数据展示；本次只按开发者要求过滤比赛列表，不伪造或重算缺少完整口径的统计字段。
- 新标签沿用现有 `Tag` 的鼠标、Enter/Space 键盘、loading 禁用和移动端等宽布局。
- 本次不改变 API、D1、比赛缓存、订单或设置持久化。

## 预计影响文件

- `app/sporttery-insights.ts`：增加不修改原数组的前端赛事列表过滤函数。
- `app/FootballInsights.tsx`：扩展共享筛选组件、增加两组默认开启状态并过滤三处列表。
- `tests/sporttery-insights.test.ts`：验证精确排除、关闭恢复、空赛事保留和不修改原数组。
- `doc/planning/2026-08-25-preview-non-friendly-filter-PLANNING.md`：维护实施与验证结果。

## 验证重点

- 打开任一赛事前瞻时，两处标签顺序均为“非友谊赛 / 同赛事 / 同主客”，且“非友谊赛”默认选中。
- 默认状态下历史交锋、主队近况和客队近况都不显示赛事为“俱乐部赛”的行。
- 关闭其中一个“非友谊赛”只恢复对应分区的原始列表，不影响另一分区，也不触发前瞻接口请求。
- 桌面端和移动端标签不溢出，鼠标与键盘切换正常，控制台无错误。
