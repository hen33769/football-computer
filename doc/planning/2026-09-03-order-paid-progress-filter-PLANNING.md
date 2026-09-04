# 订单进度已支付过滤 Planning

## TODO

- [x] 扩展订单进度类型、UI 选项和本地过滤。
- [x] 扩展客户端/API/服务端查询参数，将 `paid` 映射到 `payment_status = 'paid'`。
- [x] 增加云端进度过滤回归测试。
- [x] 运行 `npm test`、`npm run lint`、`npm run build`，并验证桌面端与移动端订单页面交互。

## 实施方案

1. 将 `paid` 加入 `OrderProgressFilter` / `OrderProgressQuery`，订单进度选择器加入“已支付”，本地通过 `isOrderPaid` 保留支付状态判断。
2. 让 API 路由接受 `progress=paid`，服务端将其转换为 `payment_status = 'paid'`，并继续与日期、订单状态等条件按 AND 组合。
3. 为 `listOrders` 增加 SQL 条件断言，确认已支付进度可与订单状态等其他条件按 AND 组合。

## 接口、数据与兼容策略

- 订单查询接口新增支持的进度值 `paid`；未传或未知进度仍按不限处理。
- 不修改 D1 表结构，不新增迁移；复用已有 `payment_status` 字段。
- 保留订单状态多选中的既有“已支付”选项及其 OR 语义。

## 验证

- 单元测试覆盖 `progress: 'paid'` 生成 `payment_status = 'paid'`，并与订单状态条件保持 AND。
- 完整运行测试、Lint 和 Cloudflare 构建。
- 本地页面检查订单进度下拉包含“已支付”；桌面端和 390px 移动端均无控制台错误与横向溢出。

## 实施结果

- `paid` 已贯通订单进度筛选的前端、客户端类型、API 路由和 D1 查询；本地页面选择后请求使用 `progress=paid`。
- `npm test` 通过 129 项；`npm run lint` 通过（3 个既有 `<img>` warning）；`npm run build` 通过。
- 桌面端和 390×844 移动端验证通过；移动端内容宽度为 375，无横向溢出，控制台无 error。

## 发布影响

- 当前仅实现和验证，不提交、推送或部署；因此不修改版本号和 `UPDATE.md`。如后续进入部署流程，按仓库约定以 minor 版本发布并补充更新日志。
