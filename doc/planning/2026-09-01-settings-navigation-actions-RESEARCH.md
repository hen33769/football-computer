# 设置与页面导航按钮调整 Research

## 需求范围

- 移除订单页和设置页的“返回投注”按钮。
- 将 header 中的“保存页面”按钮移到设置页原“返回投注”按钮位置。
- 在设置页“保存页面”按钮左侧增加 GitHub 更新日志链接按钮，使用 `GithubOutlined` 图标。

## 现有实现

- `app/components/AppShellHeader.tsx` 在 `hero-actions` 中渲染 header 的“保存页面”按钮，并通过 `onSavePage` 接收 `saveRepositoryPage`。
- `app/FootballApp.tsx` 的订单页和设置页标题操作区分别渲染“返回投注”按钮，均调用 `navigateToView("betting")`。
- `saveRepositoryPage` 位于 `app/FootballApp.tsx`，生成并下载 `SMGR.html`，不依赖当前页面视图，可直接绑定到设置页按钮。
- 当前项目已使用 `@ant-design/icons`，`GithubOutlined` 可与现有 Ant Design `Button` 一起使用。

## 设计结论

- 从 `AppShellHeader` 删除 `SaveOutlined`、`onSavePage` 及对应按钮；不改变其它 header 导航。
- 从订单页和设置页删除“返回投注”按钮。
- 设置页标题操作区保留联赛颜色数量 `Tag`，依次放置 GitHub 外链按钮和“保存页面”按钮。
- GitHub 地址使用 `https://github.com/hen33769/football-computer/blob/main/UPDATE.md`，新标签页打开并设置 `rel="noreferrer"`。

## 风险与验证重点

- 需要确认 header 组件 props 删除后没有调用方遗漏。
- 需要确认桌面端和移动端标题操作区仍能换行，外链不影响页面状态。
- 需要运行项目测试、lint、build，并对设置页和订单页进行浏览器 smoke test。
