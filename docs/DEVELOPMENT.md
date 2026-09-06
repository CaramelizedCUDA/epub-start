# 开发指南

本文件是开发环境与验证命令的权威入口。依赖白名单与审批规则见 [CONVENTIONS](../CONVENTIONS.md)，执行顺序见 [TODO](../TODO.md)，文档职责见 [索引](README.md)。

## 环境准备

- 使用 Node.js/npm、Rust 与目标平台的 Tauri v2 构建前置；安装 npm 依赖使用 `npm ci`，保留锁文件。
- Windows 使用项目现有 MSVC/WebView2 构建环境；Linux 须准备对应发行版的 Tauri/WebKitGTK 构建依赖，不能用 Windows 构建代替 Linux 验收。
- Android 使用 JDK、SDK、NDK 与对应 Rust target；遵循项目构建配置，工具链基线见 `release-baselines/android-arm64-release.json` 和 [Android 候选记录](../B3_ANDROID_RELEASE_CANDIDATE.md)。设备和本机路径记录不能证明其他开发环境已经就绪。
- 本文命令从仓库根目录执行。PowerShell 如受脚本执行策略影响，可将 `npm` 写作 `npm.cmd`。

## 启动与验证

桌面开发：

```powershell
npm ci
npm run tauri dev
```

仅开发前端资源时使用 `npm run dev`，不能用浏览器页面证明 Rust/SQLite/SAF 功能正常。

按改动范围执行验证；仅文档修改执行链接、差异检查及统计核对，不要求重新构建应用。代码验证命令如下：

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
npm run audit:unwrap
npm run audit:check
```

桌面发布构建：

```powershell
npm run tauri build
```

Android 静态审计须先按 [候选构建流程](../B3_ANDROID_RELEASE_CANDIDATE.md) 生成同一版本的 arm64 release APK/AAB 与前端 dist，然后执行：

```powershell
npm run audit:android-release
```

该脚本不负责生成制品，也不证明 Gradle lint、正式签名或设备运行态通过。诊断 feature 不得注册到普通 release；正式签名凭据不得进入聊天、日志或版本库。

## 验证记录规则

新增测试必须按 [AGENTS](../AGENTS.md) 完成目标缺陷变红、恢复变绿自证。记录必须同时写明测了什么、没测什么、版本与平台；构建和静态审查不能替代设备运行态。Android 破坏性存储实验只能按 [受控验收流程](../ANDROID_STORAGE_ACCEPTANCE.md) 在确认的受限虚拟设备执行。

`audit:unwrap` 输出当前统计；`audit:check` 核对 BACKEND_AUDIT/TODO 中登记的当前数字。历史归档中的旧数字是当时的事实，不改写为当前统计。

## 测试 EPUB

`测试文档存放处/epub/` 是本地功能验收用的 EPUB 样本目录，仅保留在工作区、不纳入版本库（已在 `.gitignore` 排除）。B3 历史固定样本集记录了 37 个唯一 EPUB；B3 arm64 的扩大样本口径与哈希见 [B3_ANDROID_SAMPLE_MANIFEST.md](../B3_ANDROID_SAMPLE_MANIFEST.md)。以下两本保留为结构差异最明确的主要验收文档：

### `这里是终末停滞委员会 - 04.epub`（插图与目录结构回归样本）

- OPF 位于 `OEBPS/content.opf`（非根目录），spine href 相对 OPF 目录，用于验证 entryPath 解析是否保留 OPF 所在目录前缀。
- 全页插图使用 `<svg><image xlink:href="../Images/204617.jpg"/></svg>`，用于验证 SVG `<image>` 检测、边缘翻页与图片查看器联动。
- `rendition:spread-none` 属性的封面/前页章节用于验证 spread 模式下边缘翻页与 image 优先原则的交互。

### `测试文档存放处/6（x）=.epub` / `测试文档存放处/epub/6.epub`（Phase 1 基线验收文档）

- Phase 1 的导入、封面提取、删除、EPUB 阅读、可见翻页与应用重启后的 CFI 恢复均以此书验收。
- OPF 位于 `item/standard.opf`（根目录下的子目录），与 vol04 的 `OEBPS/` 结构不同，用于验证不同 OPF 路径布局的兼容性。
- 全页插图使用 `<svg><image xlink:href="../image/i-071.jpg"/></svg>`（单数 `image/` 目录），用于验证 SVG `<image>` 检测在另一种路径布局下的行为。
- 正文章节含 `page-spread-left` / `page-spread-right` 属性，用于验证 spread 双页模式下左右 View 的 click handler attach 及边缘翻页稳定性。
