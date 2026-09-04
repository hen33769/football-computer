# 订单页失败比赛重新获取赛果 Planning

## 目标

- 将订单中“失败但没有保存赛果值”的比赛放入订单页赛果卡片。
- 允许用户沿用现有单场接口获取赛果，并用“一键判断并保存”更新订单。
- 不重复暴露已经有保存赛果值的失败比赛，不改变现有结算和云端数据结构。

## 实施步骤与 TODO

- [x] 在 `app/results.ts` 增加失败比赛缺少保存赛果的纯函数判断。
- [x] 在 `app/FootballApp.tsx` 的 `resultMatches` 候选集合复用该判断，保持标准化 ID 去重与全局比赛优先。
- [x] 在 `tests/calculator.test.ts` 补充手动失败、已有部分赛果、已有完整赛果和接口结果修正失败状态的覆盖。
- [x] 运行相关测试、`npm test`、`npm run lint` 和 `npm run build`。

## 数据与兼容策略

- 不新增 API、D1 字段、迁移或订单压缩字段。
- 仅基于现有订单的 `failedMatches` 与 `resultValues` 判断候选；`resultValues` 为空时保留待获取资格。
- 现有 `requestMatchResult`、`matchResults`、`judgeLoadedOrdersWithResults` 和订单保存接口不改协议。

## 验证方式

- 纯函数验证：失败标记且无结果值为待获取；失败标记且有部分/完整结果值不为待获取；无失败标记的未判断比赛仍可进入候选。
- 判断流程验证：接口结果命中时清除失败标记并写入结果；接口结果不命中时保留失败并写入结果。
- 运行全量测试、lint、build，确认无类型或编译回归。

## 发布影响

- 本次是订单页既有行为调整，若进入部署流程按仓库约定提升 minor 版本，并同步 `package.json`、`package-lock.json`、`APP_VERSION` 派生版本和 `UPDATE.md`；当前仅实现与验证，不提交、推送或部署。
