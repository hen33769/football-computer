# 队伍信息配置与图标 Planning

## 实施计划

- [x] 新增 D1 迁移和 Drizzle schema 字段，保持旧数据兼容。
- [x] 扩展队伍名称组类型、索引解析、服务端校验及现有 POST/PATCH 返回数据。
- [x] 扩展 API client、路由状态和 standalone 数据流，确保图标随公共配置同步。
- [x] 设置页将 Card 改名为“队伍信息配置”，加入管理员上传预览、移除和保存图标的编辑能力。
- [x] 投注页接入队伍图标并调整主客队布局，保留无图标和移动端兼容行为。
- [x] 补充/调整测试，运行 `npm test`、`npm run lint`、`npm run build`，并进行页面关键流程验证。

## 接口与数据结构

- `shared_team_name_groups.icon_data_url TEXT NULL`。
- `TeamNameGroup.iconDataUrl: string | null`。
- 创建/更新 payload 增加 `iconDataUrl: string | null`；仍使用原名称组接口和 revision 并发控制，不新增上传接口。
- 图标格式白名单为 `image/png`、`image/jpeg`、`image/webp` 的 base64 data URL，长度上限 350,000 字符。

## 兼容与发布影响

- 旧名称组迁移后图标为空，别名解析和页面行为不变。
- 图标和名称在同一个批处理/同一个 revision 中提交，失败时保持整组更新失败。
- 这是新增能力与既有页面行为调整，发布时按 minor 版本处理；本次开发阶段不执行提交、推送或部署，除非另行收到发布指令。

## 验证结果

- `npm test`：120 项全部通过。
- `npm run lint`：0 errors；保留 3 个框架对 data URL `<img>` 的性能 warning。
- `npm run build`：通过；保留项目已有的大 chunk、动态 API 分类和图标 barrel export warning。
- 本地页面：普通账号不显示管理员配置卡；投注页桌面 30 张比赛卡加载正常，无图标时不生成图标节点；390px 移动视口无控制台错误。
