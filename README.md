# 以小博大模拟工具（Small Money Get Rich）

一个本地运行的 React + Ant Design 单页面应用，用于手动模拟以小博大选项、串关、奖金和利润范围。项目不连接购彩、支付或真实投注接口。

## 在线演示

[点击打开 Cloudflare Worker 云同步版](https://smgr.online/)

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
- 比赛、赔率与赛果作为所有账号共用的数据，由管理员统一更新
- 浏览器 `localStorage` 作为本机缓存，云端 D1 是账号数据的最终来源

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
