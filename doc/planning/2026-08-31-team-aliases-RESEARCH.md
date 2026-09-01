# 队伍别名 Research

日期：2026-08-31

## 需求理解

- 在设置页“数据管理”卡片上方增加“队伍别名”卡片；管理员可添加一组主名/副名并保存。
- 投注页的比赛队名命中已配置的名称时，在当前队名旁以小号灰色文字显示另一个名称：
  - 当前名称是主名：`(副名)主名`，例如 `(尤加尔登)佐加顿斯`。
  - 当前名称是副名：`主名(副名)`，例如 `佐加顿斯(尤加尔登)`。
- 未配置别名的队伍保持原样；别名对所有正式版用户共用，只有管理员账号可以写入。

## 当前实现

### 设置与账号

- `app/settings.ts` 的 `AppSettings` 只有联赛标签颜色；`normalizeAppSettings`、JSON 导入导出和 `user_settings` 都围绕账号私有设置设计。
- `app/FootballRoute.tsx` 启动时为已登录账号加载订单、账本和 `getUserSettings()`；`syncSettings` 调用 `PATCH /api/users/me/settings`，写入当前账号并用 `settingsRevision` 做并发保护。
- `app/api/users/me/settings/route.ts` 只要求登录，没有管理员角色判断；因此不能复用该接口存储公共别名，否则每个账号会得到自己的别名且普通用户具备写权限。
- `db/schema.ts` 已有 `users.role`，取值为 `admin | user`；首个账号在 `app/api/users/session/route.ts` 中被创建为管理员。`app/api/matches/cleanup/route.ts` 已有服务端 `role === "admin"` 校验，可复用同一鉴权模式。
- `app/components/AppShellHeader.tsx` 会显示当前账号角色，但设置页目前没有按角色隐藏或禁用管理控件。

### 公共比赛与投注页

- `app/api/matches/current/route.ts`、`app/api/matches/route.ts` 的读取接口不要求登录；`app/server/matches-service.ts` 把比赛保存到公共 `shared_matches`，所有用户读取同一份比赛缓存。
- `app/types.ts` 的 `MatchItem` 只保存 `home`、`away` 字符串，没有稳定的队伍 ID。`app/sporttery.ts` 的 `convertSportteryMatches` 也只把体彩接口的 `homeTeamAbbName`、`awayTeamAbbName` 转成这两个字符串。
- `app/FootballApp.tsx` 的 `MatchCard` 是投注页比赛列表的主要队名渲染点，当前直接输出 `match.home` 和 `match.away`。比赛选中详情、更多玩法标题、赛事前瞻/官方趋势标题及复制文本也直接使用原始队名。
- 比赛 ID、主客队名参与 `sporttery.ts` 的 `sameMatch` 身份兜底和订单/缓存合并。直接把别名改写进 `MatchItem.home/away` 会影响比赛匹配、历史订单和官方刷新，因此别名应只在展示层装饰，不应回写比赛对象。
- `app/FootballRoute.tsx` 的启动流程已经把公共比赛加载放在账号判断之前；公共别名读取也应放在这一层，保证未登录用户投注页可以显示别名。管理员保存后需要把最新别名回传给 `FootballApp`，使列表立即重新渲染。

### 数据库与迁移

- `shared_matches` 是全局公共比赛表，包含 `updated_by`、`updated_at`；没有现成的公共配置表或公共别名字段。
- D1 迁移位于 `drizzle/`，当前数据库模型由 `db/schema.ts` 维护。队伍别名属于新的共享持久化数据，应该新增不可改写历史迁移，而不是写入 `user_settings` 或前端 `localStorage`。
- 现有数据导入导出中的 `settings` 是账号/游客个人设置；把公共别名混入普通设置导入会让非管理员具备间接修改共享数据的路径。首版应与现有个人 JSON 备份解耦，除非另有管理员专用备份需求。

## 结论：需要新增接口

需要。原因有三点：

1. 别名必须跨账号共享，不能使用按 `user_id` 存储的 `user_settings`。
2. 未登录用户也要在投注页看到别名，因此至少需要一个无需登录的公共读取入口。
3. “仅管理员可以设置”必须在服务端强制执行；前端隐藏添加按钮只能改善体验，不能作为权限控制。

建议的最小接口边界如下：

- `GET /api/team-aliases`：公开读取全部有效别名，供投注页和设置页展示。
- `POST /api/team-aliases`：登录且 `role = admin` 才能新增主名/副名；服务端校验必填、长度、主副名不能相同和主名重复。
- `PATCH /api/team-aliases/[id]`：管理员修改已有记录，便于纠正翻译。
- `DELETE /api/team-aliases/[id]`：管理员删除错误或过期的记录。虽然当前需求只明确“添加”，但没有删除能力会导致错误配置无法维护。

建议新增 `app/api-client/team-aliases.ts`、`app/server/team-aliases-service.ts`，并在每个写接口复用 `requireAuthenticatedCloudAccount` 后显式判断 `authenticated.value.account.role !== "admin"`。读取接口不应依赖登录态。

## 建议的数据结构

新增共享表，例如 `shared_team_aliases`：

- `id`：稳定 ID，便于修改和删除。
- `main_name`、`alias_name`：保留用户填写的展示文本。
- `main_name_key`：对主名做 NFKC、trim、合并空白、大小写归一化后的匹配键，并建立唯一约束。
- `alias_name_key`：副名的同样归一化匹配键；是否要求全局唯一取决于是否允许多个队伍使用同一翻译名。
- `updated_by`、`updated_at`：记录最后修改管理员和时间，沿用 `shared_matches` 的审计字段习惯。

服务端返回前应按稳定 ID 或主名排序，避免设置页每次刷新跳动。写入时应同时保存原文和匹配键；前端只使用返回的原文和匹配键，不自行改变公共数据。

## 建议的前端数据流

1. `FootballRoute.bootstrap` 与公共比赛并行请求 `GET /api/team-aliases`，无论是否登录都保存到页面状态。
2. 将 `teamAliases` 和管理员写入回调传给 `FootballApp`。管理员进入设置页时显示添加按钮和可编辑行；普通账号显示只读列表并说明“公共配置，仅管理员可修改”。
3. 在 `FootballApp.tsx` 增加纯展示函数或 `TeamNameWithAlias` 组件：
   - 当前名称规范化后匹配主名，渲染灰色小号副名在前、当前名称在后；
   - 当前名称规范化后匹配副名，渲染主名在前、灰色小号副名在后；
   - 无匹配时只渲染当前名称。
4. 首要接入 `MatchCard` 的投注列表。若确认投注页内所有队名标题都应显示别名，再复用该组件接入选中比赛详情、更多玩法、前瞻/趋势标题；订单页和历史订单中的原始快照不应因当前公共别名变化而被改写。
5. 设置页新增卡片放在联赛标签颜色卡片与“数据管理”卡片之间。添加按钮生成一行草稿，输入主名/副名后逐行保存；保存成功后更新共享列表，其他已经打开的页面不会自动收到推送，下一次刷新或重新进入时读取最新值。

## 约束与风险

- **匹配只能依赖名称**：当前 `MatchItem` 没有队伍 ID。若同名队伍跨联赛出现，单纯按名称可能误配；本需求若接受该风险，建议在 UI 中明确主名/副名是全局名称映射。
- **必须支持两种来名**：根据示例，官方数据可能返回主名，也可能返回副名；两者都应命中同一条记录，并按当前名称决定括号顺序。
- **不要改变比赛快照**：别名是展示层信息，不能把 `home/away` 替换为拼接后的文本，否则会影响订单匹配、搜索、比赛合并和后续官方刷新。
- **权限不能只靠前端**：普通用户即使手动调用 POST/PATCH/DELETE，也必须得到 403；未登录请求应得到 401 或公开读取结果。
- **并发写入**：若允许多个管理员或多个标签页编辑，建议写接口带记录版本/更新时间校验，避免后保存者覆盖先保存者。当前系统实际上通常只有首个账号是管理员，但接口仍应按共享数据处理。
- **缓存时效**：公共别名读取应使用 `cache: "no-store"`，与当前 API client 一致；页面本地可只缓存当前内存状态，不把共享配置当成用户私有设置长期保存。
- **游客 Demo**：`standalone/entry.tsx` 对 GitHub Pages 游客版直接渲染 `FootballApp`，不连接 D1 或云端 API。因此正式版公共别名能否同步显示到游客 Demo，需要单独决定；不能默认认为 GitHub Pages 与 Worker 共享数据。
- **备份边界**：现有 JSON“设置/完整数据”是个人数据流程。若要备份和恢复公共别名，需要另设管理员专用接口/文件类型和权限校验，不应沿用普通用户设置导入。

## 预计影响文件

- `db/schema.ts`：新增共享队伍别名表定义。
- `drizzle/0004_*.sql`（具体编号按迁移状态确定）：新增共享别名表、唯一键和索引。
- `app/server/team-aliases-service.ts`：读取、校验、管理员写入和删除。
- `app/api/team-aliases/route.ts`、`app/api/team-aliases/[id]/route.ts`：公开 GET 与管理员写接口。
- `app/api-client/team-aliases.ts`：前端请求封装。
- `app/FootballRoute.tsx`：启动读取公共别名并向页面传递，保存后更新状态。
- `app/FootballApp.tsx`：队名别名展示组件、设置卡片、管理员/普通账号 UI 分支。
- `app/globals.css`：别名小号灰色字体、卡片行和移动端布局。
- `app/types.ts` 或独立类型文件：共享别名响应/前端模型。
- `tests/`：匹配顺序、空值/重复校验、API 服务权限和并发冲突测试。

## 待确认问题

1. 示例是否确认采用“双向命中”规则：比赛返回主名时显示 `(副名)主名`，返回副名时显示 `主名(副名)`？这是当前对示例最直接的理解。
2. 一个主名是否只允许配置一个副名？如果同一队伍可能有多个翻译，希望维护多个副名，需要从一对一记录改成一对多结构。
3. “所有用户”是否包括 GitHub Pages 游客 Demo？正式版未登录用户可以通过公开接口显示；游客 Demo 当前没有 D1/API 通道，需要决定是否暂不支持、改为请求正式版公共接口，或另行发布静态配置。
4. 别名是否需要纳入现有 JSON 导出/导入？建议首版不纳入普通个人备份，以免普通用户通过导入修改共享配置；如需要，应单独做管理员专用备份。

本轮仅完成 Research 文档和代码阅读，未修改业务代码、数据库迁移、版本号或更新日志，也未进入 Planning/Implementation。
