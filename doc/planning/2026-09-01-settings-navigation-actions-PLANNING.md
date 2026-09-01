# 设置与页面导航按钮调整 Planning

## 实施计划

- [x] 从 `AppShellHeader` 移除 header“保存页面”按钮及其无用 props/import。
- [x] 删除订单页、设置页“返回投注”按钮，并在设置页原位置加入 GitHub 与“保存页面”按钮。
- [x] 更新本计划 TODO，运行 `npm test`、`npm run lint`、`npm run build`。
- [x] 使用浏览器检查设置页按钮顺序、订单页按钮移除、外链属性和控制台错误。
- [x] 按发布流程将版本升为 `v1.18.0` 并更新 `UPDATE.md`。

## 接口与数据结构

- 不改变 API、组件对外页面行为接口以外的数据结构、数据库和迁移。
- `AppShellHeaderProps` 删除只服务于 header 保存按钮的 `onSavePage` 属性。

## 兼容与发布影响

- 保存页面行为保持不变，只改变入口位置；GitHub 链接为新增外部导航入口。
- 本次按用户请求进入发布流程，版本为 `v1.18.0`；提交、推送和 Cloudflare 部署需保持 `UPDATE.md`、代码和版本号在同一发布提交中。

## 验证结果

- `npm test`：120 项全部通过。
- `npm run lint`：0 errors；保留项目已有的 3 个 `<img>` 性能 warning。
- `npm run build`：通过；保留项目已有的图标 barrel export、chunk 大小和动态 API 分类 warning。
- 本地页面：桌面设置页显示 GitHub 外链和保存页面按钮，订单页与设置页不显示“返回投注”，header 不显示“保存页面”；390px 移动视口下操作区正常纵向排列、不横向溢出；保存按钮点击后显示原成功提示；控制台错误为 0。
