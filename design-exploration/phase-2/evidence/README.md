# Phase 2 Visual Evidence

本目录中的 PNG 由 `../capture-evidence.ps1` 从本地静态 `../index.html` 生成。截图证明的是布局与静态交互状态可渲染，不证明 Tauri、EPUB.js、IPC、数据库、Android WebView 或生产应用运行态。本次已保留 6 张目标尺寸快照；桌面使用 1.0 设备缩放，移动使用 0.8 设备缩放以抵消本机 Windows DPI 对 Edge 无头视口的影响。

| 文件 | 视口 | 评审目标 |
| --- | --- | --- |
| `desktop-library-100.png` | 1440×960 | 100 本封面密度、detail leaf、开放藏书场 |
| `desktop-library-1000-compact.png` | 1440×960 | 1000 本紧凑书目、长标题、来源状态 |
| `desktop-search-indexing.png` | 1440×960 | Content 搜索、building 34/135、取消与部分结果 |
| `desktop-reader-controls.png` | 1440×960 | Reader 控件态、目录 sheet、可发现翻页 |
| `mobile-library.png` | 390×844 | Android 重排、10 本密度、底部导航 |
| `mobile-reader-controls.png` | 390×844 | Android Reader、bottom sheet、48px 触点 |

重新生成会覆盖这些 PNG，但所有写入仍在 `phase-2` 内。浏览器临时 profile 使用 `evidence/.browser-profile`，脚本在验证其绝对路径位于本目录后清理。也可以用下列 URL 参数直接评审，不依赖截图：`?view=library&count=1000&layout=compact&review=1`、`?view=library&search=1&scope=content&index=building`、`?view=reader&reader=controls&panel=settings`。

## 视觉 QA 记录

六张快照已直接复核：

- 阅读缝线在 Library、Search、Reader 和 Android 中可追踪，但没有演变成装饰边框。
- 100 本 grid 仍以封面而非卡片为主；1000 本 compact 只显示书目信息。
- Search overlay 能区分 Library / Series / Content 的真实范围。
- Reader quiet 与 controls 的 chrome 差异清晰；正文宽度不因 sheet 出现而伪装生产 reflow。
- Android 采用 bottom navigation / bottom sheet，而非缩小桌面 rail / detail leaf。
- 长标题、missing cover、source unavailable、index building 保持可读；移动 Reader 标题已限制为可换行的排版宽度。
- 截图不作为生产运行态、B3 或跨端验收证据。

## 交互烟测

2026-08-24 使用 Edge 无头模式加载本地原型并通过同源 iframe 点击验证：100 → 1000 册切换后 DOM 生成 1000 个书目；封面网格 → 紧凑布局；Library 搜索打开；搜索范围切换到 Content 并更新 `aria-selected` 与标题；打开 Reader 后切换到控件态和排版设置面板。以上只证明静态原型事件链，不证明生产 React/Tauri、数据库、EPUB.js 或 Android WebView 行为。
