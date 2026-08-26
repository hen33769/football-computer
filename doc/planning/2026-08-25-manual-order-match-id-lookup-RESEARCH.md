# 手动订单按 matchId 查询比赛与自定义创建时间 Research

## 需求范围

- 手动添加订单的“选择比赛”支持输入大于 5 位的纯数字；该数字作为官方比赛 `matchId`，调用 `getFixedBonusV1.qry` 查询比赛。
- 查询成功的比赛作为下拉选项；用户选中后自动把比赛信息写入对应 textarea。
- 查询得到的比赛仅在当前手动订单弹窗内临时保存；选择投注项时优先从临时比赛中查找，弹窗关闭后清空。
- 手动添加订单增加可选的订单创建时间；留空时在提交订单时使用当前时间。
- 本轮只做 Research，不开始实现或发布。

## 当前实现与数据流

### 手动订单比赛选择

- `app/FootballApp.tsx` 的 `ManualOrderEntry` 只保存 `key`、`matchId` 和 textarea 文本。
- 比赛下拉选项 `manualMatchOptions` 只由全局 `matches` 生成；`Select` 使用 `showSearch` 和本地 `optionFilterProp="searchText"`，当前没有 `onSearch`、异步加载状态或远端结果。
- 当前 `searchText` 不含比赛 ID，因此即使比赛已在本地，直接输入 `matchId` 也不一定能过滤出该选项。
- `selectManualOrderMatch` 从全局 `matches` 查找比赛，清空已选项后调用 `formatManualMatchText` 填充 textarea。
- `openManualMatchPicker` 同样只从全局 `matches` 查找比赛，然后把 textarea 中已选玩法重新映射到最新比赛赔率。
- `applyManualPickerSelection` 把选择结果格式化回 textarea；最终 `addManualOrder` 再逐场解析 textarea，因此临时比赛本身不应进入公共比赛缓存、云端比赛数据或浏览器持久化。
- 手动订单最多支持 8 场；如果远端查询可能用于多场比赛，单个 `MatchItem | null` 会在查询下一场时覆盖上一场，无法保证此前条目仍能打开投注项选择器。

### 比赛 ID 约束

- `parseRecognizedText` 当前只识别正好 7 位的“比赛 ID”。
- `addManualOrder` 也用 `^\d{7}$` 再次校验，因此即使异步查询成功，6 位历史 `matchId` 仍会在保存时失败。
- 新需求明确规定“大于 5 位的纯数字”，应统一把手动订单查询、textarea 解析和最终保存校验调整为至少 6 位纯数字，不能只修改 Select 的触发条件。

### 订单创建时间

- `persistNewOrder` 当前固定以 `new Date().toISOString()` 写入 `SavedSlip.savedAt`；该方法目前只被手动添加订单调用。
- `savedAt` 会传到账号版 API 并存入 D1 的 `user_orders.saved_at`，游客版也会原样存储。
- 订单列表排序、订单日期筛选以及已支付订单的趋势支出归属日期都使用 `savedAt`；因此选择历史创建时间会同时改变这些页面口径，这是预期的业务影响。
- 订单编辑弹窗已经有成熟的 `DatePicker + showTime + showNow` 实现，可复用其桌面/移动配置。手动新增时应让字段初始为空；提交时为空才取提交瞬间的当前时间。

## 官方接口实测结论

实测接口：

- `GET https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=<matchId>`
- 当前比赛 `2041051`、历史比赛 `2040585` 和 6 位历史比赛 `123456` 均能成功返回。

`value.oddsHistory` 稳定包含：

- `matchId`、主客队名称、主客队 ID、联赛名称与联赛 ID。
- `hadList`、`hhadList`、`crsList`、`ttgList`、`hafuList`，可以用各列表最后一条有效记录构建五类玩法当前赔率。
- `hhadList.goalLine`，可以构建让球胜平负的让球数。
- `singleList`，可以补充玩法单关可用信息。

但该接口实测不包含：

- 业务日期 `businessDate`。
- 实际比赛日期和开赛时间 `matchDate`、`matchTime`。
- `matchNum`、`matchNumStr`、周几和三位场次号。
- 可用于可靠推导上述字段的其它元数据。

赔率记录的 `updateDate` / `updateTime` 是赔率更新时间，不是开赛时间，不能冒充比赛日期或开赛时间。`matchId` 后三位也不是三位场次号，例如当前 `2041051` 的实际场次号是“周二003”。

当前 textarea 格式和 `parseRecognizedText` 需要日期、开赛时间以及带三位场次号的“主队 VS 客队”标题。仅靠 fixed bonus 响应无法可靠生成一段可保存且信息正确的完整文本。

## 建议实现方案

### 1. 异步查询与临时比赛字典

- 新增弹窗级临时字典 `Record<string, MatchItem>`（或 `Map<string, MatchItem>`），以标准化后的 `matchId` 为键。虽然需求称“一个对象”，字典仍是单一临时对象，同时支持一个订单查询多场比赛。
- `Select.onSearch` 对 trim 后满足 `^\d{6,}$` 的输入进行防抖查询；非纯数字或不足 6 位时只执行现有本地过滤。
- 复用 `fetchSportteryFixedBonusPayload`，继续使用现有同一 ID 的在途请求合并逻辑；页面层增加请求序号或弹窗 generation，忽略旧输入和弹窗关闭后才返回的响应。
- 查询结果只有在响应中的 `oddsHistory.matchId` 与当前搜索 ID 一致、且能组成完整 `MatchItem` 时才加入临时字典。
- `manualMatchOptions` 合并全局比赛与临时比赛，按标准化 ID 去重，临时比赛优先；所有选项的 `searchText` 都加入 `matchId`。
- 选中选项后沿用 `formatManualMatchText` 自动填充 textarea；仅输入或查询成功不应直接覆盖用户已编辑的 textarea。
- `selectManualOrderMatch` 和 `openManualMatchPicker` 的来源顺序统一为：临时字典同 ID 比赛 → 全局 `matches` 同 ID 比赛。
- 弹窗关闭时统一清空临时字典、查询 loading/error、请求 generation 和投注项子弹窗状态；成功添加订单、取消、关闭按钮都必须走同一清理路径。

### 2. fixed bonus 比赛转换

- 在 `app/sporttery.ts` 增加纯函数，把 `oddsHistory` 的最后一条有效赔率转换为页面五类 `Market`，复用现有 `createMarkets`、赔率 key 映射、让球解析和赔率历史工具，避免在 React 组件内重复解释官方字段。
- 若同 ID 已存在于全局 `matches`，以现有比赛提供日期、时间、周几和场次号，以 fixed bonus 提供队伍/联赛和最新玩法赔率。
- 若全局比赛不存在，建议再从现有官方 `getMatchListV1.qry` 结果按 ID 补齐元数据，然后用 fixed bonus 覆盖玩法赔率。
- 如果当前比赛列表仍找不到该 ID，应提示“已取得赔率，但官方 fixed bonus 未返回比赛日期/场次号，无法自动生成完整比赛，请继续手填”，不要用赔率更新时间或 `matchId` 尾号伪造元数据。
- 临时比赛不调用 `setMatches`，不进入 `mergeSportteryMatchCache`，也不触发公共比赛同步。

### 3. 创建时间

- 增加 `manualOrderSavedAt` 状态，打开弹窗时重置为空。
- 在手动订单元信息区域增加“订单创建时间” DatePicker，沿用订单编辑器的秒级格式、`showNow` 和移动端只读输入配置，并允许清空。
- `persistNewOrder` 接受可选 `savedAt`；有效值转为去除毫秒的 ISO 字符串，空值在点击“添加订单”时取当前时间。
- 不改变订单 ID 的生成方式；ID 仍表示实际创建操作，`savedAt` 表示用户选择的业务创建时间。
- 与现有订单编辑行为保持一致，暂不额外禁止未来时间；若产品希望限制未来时间，应另行明确。

## 状态与时序风险

- 用户先输入 6 位、随后快速补到 7 位时可能发出两次请求，必须防抖并忽略旧响应，避免旧比赛覆盖新搜索结果。
- 多个比赛条目可查询不同 ID，loading 最好按 entry key 或 matchId 记录，不能用单一布尔值阻塞所有 Select。
- 删除一个手动比赛条目时，可保留字典中的比赛到弹窗关闭；数据量最多 8 场，无需在弹窗内复杂回收。
- fixed bonus 可能返回历史比赛、已停售比赛或部分玩法空赔率。手动添加本来允许历史/手填订单，因此可以展示，但无有效赔率的投注项必须继续禁用。
- 自动填充后用户仍可直接修改 textarea；重新打开投注项选择器时应保持现有逻辑，以临时比赛为底稿，再叠加 textarea 中已选项。
- 选择历史创建时间会影响订单筛选、排序及支付后的支出趋势日期，需要在 UI 帮助文字中明确。

## 验证重点

- 6 位和 7 位纯数字触发查询；不足 6 位、混合字符、空输入不请求。
- 防抖、同 ID 在途复用、快速换 ID、弹窗关闭后响应返回等竞态。
- fixed bonus 五类玩法、让球数、单关信息和空赔率转换。
- 临时比赛优先于全局同 ID 比赛；一个订单连续查询多场后，每场仍可打开投注项选择器。
- 选中后 textarea 自动填充，用户修改后重新打开选择器仍能恢复已选项。
- 弹窗取消、关闭、成功保存后临时字典都被清空；重新打开不残留。
- textarea 解析和保存同时接受至少 6 位纯数字 ID，重复 ID 检查仍按标准化值执行。
- 创建时间留空使用提交瞬间当前时间；自定义时间正确写入游客数据和 D1，并影响订单日期筛选、排序及趋势归属。
- 桌面端与移动端下拉搜索、loading、错误提示、DatePicker 和嵌套投注项弹窗交互。

## 需要确认的问题

1. fixed bonus 缺少比赛日期、开赛时间和场次号。建议“先查 fixed bonus；本地没有元数据时再查当前比赛列表补齐；仍补不齐则提示手填，不生成伪造数据”。是否接受这个降级策略？
2. 为支持一个手动订单查询多场比赛，建议“一个临时对象”实现为按 `matchId` 索引的字典，而不是只能保存最后一场的单个 `MatchItem`。是否按此实现？

在这两个问题确认前不进入 Planning 和 Implementation。
