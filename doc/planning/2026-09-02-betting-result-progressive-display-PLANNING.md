# 投注页批量赛果与逐场即时显示 Planning

## 目标

- 投注页自动获取赛果优先使用 `getUniformMatchResultV1.qry` 按日期批量获取，减少单场接口访问。
- 按比赛实际开赛日期组织请求，每个请求日期范围不超过 30 个自然日；超过范围自动拆分。
- 按 `matchId` 将批量结果映射回本地比赛，批量响应每页到达后立即更新投注页和本地缓存。
- 批量请求覆盖范围内仍待处理的比赛显示加载 icon，成功/未完成/失败后正确清理或保留重试状态。
- 订单页单场“获取赛果”继续使用现有 `getMatchScoreV1.qry` 路径；批量缺失、未完成或解析失败只进入现有退避重试，不自动回退单场接口。

## 实施步骤与 TODO

- [x] 在 `app/sporttery.ts` 增加批量接口 URL、响应类型、URL 构造、响应校验和批量记录解析适配器。
- [x] 增加日期解析和最多 30 天区间拆分的纯函数，明确使用实际开赛日期而不是业务日。
- [x] 增加批量分页获取函数：按日期范围内本地比赛数量设置 `pageSize`，按 `pages`/`total` 遍历，并防止重复页或异常空转。
- [x] 改造 `app/FootballApp.tsx` 投注页自动队列为 batch-first；保留 `requestMatchResult` 和订单页单场流程。
- [x] 对每页可识别的赛果立即合并 `matchesRef.current`、React 状态和本地缓存；队列完成后继续一次性云端批量写回。
- [x] 将日期区间内待处理候选 ID 作为加载状态，单场完成后移除，未完成/失败按确认策略进入退避重试。
- [x] 为 URL、日期切分、批量响应转换、按 ID 合并相关边界补充测试；自动 effect 的真实网络路径通过浏览器结构和控制台验证。
- [x] 执行 `npm test`、`npm run lint`、`npm run build`，并用浏览器验证投注页桌面端和移动端关键流程及控制台错误。

## 接口与数据结构

### 第三方批量接口

请求：

`https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry`

参数：

- `matchBeginDate`、`matchEndDate`：实际开赛日期，闭区间，最多 30 个自然日。
- `leagueId`：保持空值。
- `pageSize`：当前日期区间本地比赛列表数量（至少为 1）；服务端若截断，使用响应中的 `pages`/`total` 继续翻页。
- `pageNo`：从 1 开始递增。
- `isFix=0`、`matchPage=1`、`pcOrWap=1`：沿用用户确认的接口参数。

已验证的成功响应结构为：

```text
{ success: true, value: {
  total, pages, pageNo, pageSize,
  matchResult: [{ matchId, matchDate, goalLine, sectionsNo1, sectionsNo999, ... }]
}}
```

批量记录将适配为现有 `MatchResult` 所需的常规时间比分；`goalLine` 解析为 `rqspfHandicap`，并用于计算让球胜平负。响应中与当前候选无关的比赛只放入临时 Map，不写入本地比赛列表。

### 失败与重试

- HTTP 非 2xx、JSON 无效、`success=false`、缺少合法 `value.matchResult`，统一作为错误，沿用错误退避。
- 某场未出现在响应、`sectionsNo999` 无法解析、常规比赛阶段未结束，作为该场未完成，沿用未完成退避。
- 不将批量“未命中候选”当作空结果写入，也不自动用单场接口补发，避免 WAF 触发时扩大请求量。
- 原有单场方法只保留给订单页手动获取赛果；单场方法本身不改接口或解析语义。

## 前端状态与持久化

- `bettingResultFetchingMatchIds` 从当前单场 ID 扩展为当前批量日期区间中仍待处理的候选 ID 集合；已有 `MatchCard` 的 `resultLoading` 负责将 `VS` 替换为加载 icon。
- 每页处理结果时，通过标准化比赛 ID 合并到 `matchesRef.current`，同步 `setMatches` 和 `saveCachedMatches`，确保投注页立即显示全场/半场比分。
- `resultUpdates` 持续收集本轮成功结果；所有批量日期区间和分页请求完成后只调用一次 `onCloudMatchesUpdate(resultUpdates)`，避免逐场 D1/API 写入和并发冲突。
- 云端返回结果仍按标准化比赛 ID合并回当前状态，不能用请求顺序覆盖其它比赛或投注选择。

## 兼容性与安全边界

- 不修改 D1 表结构、迁移、订单结构或结算规则。
- 不在客户端伪造 `sec-*`、`Origin`、`Referer` 等浏览器头；第三方请求只发送必要的 JSON Accept 头。
- 批量请求之间继续保留现有最小间隔，并通过日期范围、Map 去重和重试退避控制访问量。
- EdgeOne 567 仍可能由接口方自定义规则、速率限制或 Bot 管理触发；代码只做降频和正常错误处理，不绕过站点安全策略。

## 验证方案

- 单元测试：
  - URL 参数、空 `leagueId` 和分页参数。
  - 实际开赛日期解析，含跨业务日时间和无效时间。
  - 30 天闭区间及超过 30 天的连续区间切分。
  - `pages` 多页、服务端缩小 `pageSize`、重复 ID 和空页终止。
  - `goalLine`、半场/全场比分到现有玩法结果的转换。
  - 每页结果按 ID 合并且不覆盖其它比赛；未完成和异常进入正确重试类型。
- 运行全量 `npm test`、`npm run lint`、`npm run build`。
- 浏览器验证投注页：批量请求期间候选比赛显示加载 icon；收到任意一页后对应比赛立即显示比分，剩余比赛继续加载；超过 30 天时验证拆分；检查桌面/移动布局和控制台无新增错误。

## 发布影响

- 本次属于既有行为调整，若进入部署流程按项目规则更新 minor 版本、`UPDATE.md` 和所有版本派生位置；本次仅实现和验证不执行提交、推送或部署。
