# 以小博大模拟工具（Small Money Get Rich）

一个本地运行的 React + Ant Design 单页面应用，用于手动模拟以小博大选项、串关、奖金和利润范围。项目不连接购彩、支付或真实投注接口。

[查看更新日志与版本迭代](./UPDATE.md)

## 在线演示

- [Cloudflare Worker 云同步正式版](https://smgr.online/)：无需登录即可查看官方比赛；输入账号后，订单、收支、设置和公共比赛通过 D1 跨设备同步。
- [GitHub Pages 游客 Demo](https://hen33769.github.io/football-computer/)：固定为游客登录，不使用账号服务器或 D1；订单、收支、设置和比赛缓存只保存在当前浏览器。

正式版登录窗口中的“游客登录”会直接跳转到游客 Demo。游客数据不会上传云端，
清理浏览器数据或更换设备后也不会自动恢复。

## 功能

- 默认显示胜平负、让球胜平负
- 更多玩法弹窗：比分、总进球数、半全场胜平负
- 手动添加比赛，并可编辑五类玩法的全部赔率
- 本地中英文 OCR 截图识别，识别结果可校对后导入
- 自由过关：单场与 2 串 1 至 8 串 1，多种关次可复选
- 每注 2 元，支持 1 至 50 倍
- 计算大于 0 的最低中奖奖金、最高奖金及对应利润范围
- 查看明细时点击已选项标记命中，实时计算当前奖金
- 使用唯一应用账号无密码登录
- 订单、收支和设置通过 Cloudflare D1 绑定账号并跨设备同步
- 所有用户（包括未登录用户与游客）都能直接获取体彩官方比赛接口数据
- 官方比赛接口数据优先于缓存；正式版登录账号会把完整比赛同步到公共 D1
- 游客 Demo 不连接 D1，所有个人数据仅保存在浏览器 `localStorage`
- 正式版浏览器缓存用于离线回退，D1 是登录账号个人数据与公共比赛缓存的云端来源

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

`npm run dev` 会先自动应用本地 D1 迁移，再启动开发服务器，无需手动创建
`shared_matches`、`users` 等表。

终端出现地址后，用浏览器打开 `http://localhost:3000/`。

## 构建与测试

```bash
npm run build
npm test
```

## Cloudflare Worker / D1 发布

### 一键发布

代码修改完成后，根据改动类型运行：

```bash
# 修复、样式或文案调整：1.0.0 -> 1.0.1
make release-patch

# 新增功能、删除功能或行为变化：1.0.0 -> 1.1.0
make release-minor

# 大改动：1.0.0 -> 2.0.0
make release-major
```

也可以直接运行 `make deploy`，默认按 `patch` 更新版本。脚本会依次：

1. 检查 `main` 分支、GitHub 远端及未解决冲突；
2. 运行全部测试与 Cloudflare 构建；
3. 同步更新 `package.json`、`package-lock.json` 和页面版本；
4. 创建发布提交并推送到 GitHub；
5. 应用远程 D1 迁移并发布 Cloudflare Worker；
6. 请求 `https://smgr.online/api/cloud/bootstrap` 验证正式域名。

若 macOS 本机 DNS 缓存暂时无法解析正式域名，发布脚本会自动尝试阿里、腾讯及
Cloudflare 等公共 DNS 获取地址并继续验证；公共 DNS 也不可用时会跳过本机
HTTP 检查，不会把已经成功的 Worker 部署误报为失败。

首次使用前需确保 GitHub SSH 推送权限有效，并已通过 `npx wrangler login`
登录 Cloudflare。可先运行 `make release-dry-run` 检查发布参数；该命令不会
提交、推送或部署。若仓库没有代码改动，`make deploy` 会跳过版本更新与提交，
直接重新发布当前版本。

### 手动发布

```bash
npm run deploy:cloudflare
```

部署配置位于 `wrangler.jsonc`，Worker 使用 `DB` 绑定连接 `smgr-cloud`
D1 数据库。首次创建数据库后，先执行：

```bash
npx wrangler d1 migrations apply smgr-cloud --remote
```

再运行发布命令。应用代码和静态资源部署在 Worker，账号、订单、收支、设置及
公共比赛数据存放在 D1。

### 正式域名

`smgr.online` 已在 `wrangler.jsonc` 中配置为 Worker Custom Domain。
运行 `npm run deploy:cloudflare` 会同时更新正式域名，并保留 `workers.dev`
备用地址。

OCR 的 Worker、WASM 和中英文语言模型已经放在 `public/ocr` 与 `public/tessdata`，正常本地运行时不会把上传图片发送到外部服务。

由于 OCR 需要 Web Worker 和 WASM，浏览器通常不允许它们从 `file://` 直接加载，因此本项目应通过 `npm run dev` 或本地静态服务器打开，不建议直接双击 HTML。

## 计算说明

- 每个串关组合中的单注奖金先按 `2 × 各场赔率连乘` 计算，并保留两位小数。
- 同一场选择多个玩法时，它们作为该场的多个备选项参与计注，不会在同一注里互相连乘。
- 最低奖金只统计至少中得一注的赛果，未中奖的 0 元不进入奖金范围。
- 单注奖金按照官方场次数量上限封顶，同时保留未封顶理论最高值供提示。

本工具仅用于规则演示和个人预测记录，最终规则及兑奖结果以中国体育彩票官方公布信息为准。
