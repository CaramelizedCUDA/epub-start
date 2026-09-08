# E5 Reader 封面与排版修复记录（2026-09-08）

## 影响面

本轮处理手动验收发现的两个具体问题：书架封面缺失，以及 EPUB 正文/图片在分页边界溢出。翻页边缘优先于文字点击的批注交互按用户决定暂缓，未修改 `imageInteractions`。

没有新增格式处理器、IPC 契约或依赖。E5 的 CFI、重启恢复、跨端阶段验收仍未完成。

## 根因与改动

- EPUB3 可以用 manifest item 的 `properties="cover-image"` 标识封面，旧解析器只看 EPUB2 的 `meta name="cover"` 和包含 `cover` 的 item id，导致部分书籍导入后没有封面缓存路径。EPUB parser 现在同时处理 `Start`/`Empty` item，并按空白分隔识别 `cover-image`；新增 fixture 验证封面字节确实写入缓存。
- 普通重排时，EPUB.js 会在最终分页几何确定前按自然正文高度调整图片，导致高于当前页的 SVG/图片跨页或溢出。Reader engine 现在在 content/layout 之后按当前页高设置图片/SVG 的 `height: auto`、`max-height`、`max-width`、块级显示和不跨页约束。
- 固定版式 EPUB 由 EPUB.js 的全局 `pre-paginated` 元数据处理；Reader 自定义的重排边距和图片约束会跳过固定版式。混合 `itemref` 版式仍需要独立的固定页定位模型，暂不伪装支持。

## 本轮检查

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml formats::epub::tests:: -- --nocapture`：15 项通过，包含 EPUB3 `cover-image` 回归。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过。
- `npm.cmd run test:frontend -- --reader`：6 项通过。
- `npm.cmd run build`：通过。
- `npm.cmd run audit:check`：通过，Rust 统计仍为 672 行 / 687 次。
- Edge 临时 fixture 的目标红绿复现：修复前 `scrollHeight=845` 且存在垂直溢出，修复后 `scrollHeight=820` 且无垂直溢出。

## 未覆盖与承接

当前没有对正式桌面窗口或 Android 设备重新执行真实 Reader 视口、CFI 恢复和固定/混合版式矩阵；已有缓存路径但前端 asset 不可见的运行态失败也没有可重复的请求/控制台证据，因此没有凭猜测修改 `convertFileSrc`、CSP 或 asset scope。无图像源的 EPUB 仍应显示标题 fallback。

这份记录只关闭本轮两个可复现的实现缺口，不勾选 E5 阶段验收。真实 Reader 打开、重排、恢复和 Android 差异在后续有正常视口的 E5/E10 场景承接。
