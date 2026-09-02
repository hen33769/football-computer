# 串关明细排序与日期比赛复制格式 Research

## 需求边界

- 明细抽屉中的“串关明细”在保留单场、`n 串 1` 分组的前提下，按每组计算出的总倍率降序排列。
- 投注页面按日期复制比赛时，每行队伍名称后附带让球方向与绝对让球数，例如负让球显示“主让 2”，正让球显示“客让 1”。
- 保留现有日期行、比赛筛选、剪贴板成功/失败提示和订单数据结构。

## 现有实现

- `app/FootballApp.tsx` 的 `PassMultiplierDetails` 先用 `sortMatchesForDisplay` 排列比赛，再调用 `calculatePassMultipliers`；页面按 `passes` 分组，但每组直接使用计算结果的组合生成顺序，没有按 `item.multiplier` 排序。
- `app/calculator.ts` 的 `PassMultiplierDetail.multiplier` 是该串关组合所有选项倍率的乘积，也是明细中第二个倍率值（完整总倍率）；`hitMultiplier` 是当前命中项倍率，不能用来代替排序键。
- `app/FootballApp.tsx` 的 `copyMatchesForDate` 当前只复制 `${home} vs ${away}`。日期分组传入的 `items` 已包含完整 `MatchItem`，无需再次请求数据。
- `app/types.ts` 将让球数保存于 `markets` 中 `type === "rqspf"` 的 `handicap` 字段。`app/sporttery.ts` 从官方 `goalLine` 解析该值；`winningOptionId` 使用“主队得分 + handicap”计算结果，因此负值表示主队让球，正值表示客队让球。
- 当前比赛卡片对缺失或 0 让球数显示中性短横线，但保留有效 0 值供业务计算；本次复制格式可将有效 0 表示为“平手”，缺失值不虚构方向或数值。

## 约束与风险

- 排序只能影响明细展示，不得改变投注组合计算、赔率、命中状态或串关分组顺序。
- 排序应使用完整总倍率 `multiplier`，不是实时命中倍率 `hitMultiplier`；相同总倍率保持原有组合顺序，避免无意义跳动。
- 复制文本应读取当前页面比赛快照中的 `rqspf.handicap`，负值和正值均以绝对值展示；缺失盘口需要安全降级。
- 不新增接口、数据库字段或迁移。

## 修复方向

- 在计算工具中提供稳定的总倍率降序排序函数，由 `PassMultiplierDetails` 对每个串关分组调用。
- 增加独立的比赛复制行格式化函数，统一生成大写 `VS`、中文全角括号及主/客让球文案，并在复制函数中复用。
- 添加纯函数回归测试，覆盖总倍率排序、负让球、正让球、0 盘口和缺失盘口。

## 待验证

- 同一串关分组中总倍率从高到低显示，相同倍率顺序稳定。
- 日期复制文本保留日期行，负值输出“（主让 n）”，正值输出“（客让 n）”，0 输出“（平手）”，缺失盘口不附加文本。
- `npm test`、`npm run lint`、`npm run build` 通过；投注页复制按钮和明细抽屉无控制台错误。
