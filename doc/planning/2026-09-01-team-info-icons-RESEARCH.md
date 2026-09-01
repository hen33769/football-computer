# 队伍信息配置与图标 Research

## 需求范围

- 设置页的“队伍名称别名” Card 改名为“队伍信息配置”。
- 管理员可以为一个已有的队伍名称组手动上传一个队伍图标。
- 投注页比赛队伍名称两侧按主队“(别名) 主队 图标”、客队“图标 客队 (别名)”展示；未配置图标时不渲染占位。
- 队伍名称和图标都是公共配置，普通用户只读取，只有管理员可写。

## 现有实现

- `app/team-aliases.ts` 以队伍名称组为单位维护多个名称及两个激活槽位，`buildTeamNameIndex` 将所有名称映射到同一组，投注页通过 `TeamNameWithAlias` 解析主副名。
- `app/server/team-aliases-service.ts` 使用 `shared_team_name_groups` 和 `shared_team_names`，创建/更新接口已经有管理员鉴权、名称规范化、跨组名称唯一校验和 revision 并发保护。
- `app/api-client/team-aliases.ts` 的 POST/PATCH 复用同一份名称组保存接口；`app/FootballRoute.tsx` 与 standalone 入口都消费公共 GET 数据。
- 设置卡片已限制为管理员显示，编辑状态由 `FootballApp.tsx` 管理；现有 `Upload` 组件可复用。
- 投注卡片 `MatchCard` 使用五列 grid：主队在第 1 列，比分/VS 在中间，客队在第 5 列。别名由灰色小字号组件渲染。

## 存储与接口研究

- `wrangler.jsonc` 只有 D1 和 `IMAGES` binding。`worker/index.ts` 中的 `IMAGES` 仅用于 `/_vinext/image` 的尺寸/格式转换，没有 R2 或 Cloudflare Images 的持久化上传能力。
- 本需求的图标数量和尺寸适合直接作为受白名单约束的 data URL 存在队伍名称组记录中：不新增独立上传接口，现有 POST/PATCH 在保存名称组时同时保存图标，公共 GET 自然返回图标给投注页。
- 为避免 D1 膨胀和不安全内容，服务端只接受 PNG、JPEG、WebP 的 base64 data URL，限制 data URL 长度为 350,000 字符（约 256 KiB 原始图片以内）；SVG、外部 URL、任意 HTML 均拒绝。前端同步限制并提示格式和大小。

## 设计结论

- 图标归属于名称组而非某个名称。名称组代表同一支队伍，接口返回任意历史名称都解析到同一图标。
- 新增字段 `shared_team_name_groups.icon_data_url`，类型为可空 TEXT；新增迁移，不改已发布的 `0004`。
- `TeamNameGroup`、`TeamNameGroupDraft`、服务端 payload 和 API client 增加 `iconDataUrl`；`TeamNameResolution` 携带图标，新增解析函数供投注布局按队伍名称取图标。
- 编辑器提供上传预览、移除图标和保存；无图标时不输出 `<img>`，避免出现空白占位。
- 主队侧使用“名称 + 图标”并右对齐，客队侧使用“图标 + 名称”并左对齐，保持中间 VS/比分列不变；图标设置固定小尺寸并使用 `object-fit: contain`。

## 风险与验证重点

- D1 migration、旧数据兼容：旧名称组的图标字段为 NULL，现有别名展示必须保持不变。
- 并发编辑：图标和名称跟随同一个 revision 一起更新，避免只更新图标时绕过现有冲突保护。
- 安全与容量：服务端不能只信任前端 `accept`，必须重新校验 MIME、base64 格式和长度；公共 GET 返回 data URL 会增加响应体，需要限制单图大小。
- 需要覆盖管理员保存、普通用户无写入口、无图标不渲染、接口名命中历史名称仍能拿到图标，以及桌面/移动投注卡片布局。

## 待确认事项

- 本次按“每个名称组一个共享图标、PNG/JPEG/WebP、单图约 256 KiB 以内、D1 data URL”实现。若后续需要大图、批量图标或每个名称单独图标，应改为 R2/Cloudflare Images 对象存储并增加独立上传/删除接口。
