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

先按 [验证策略](VERIFICATION.md) 选择影响面。下面是命令字典，不是每次必跑清单；仅文档修改检查链接、差异与状态，不构建应用。

| 触发条件 | 命令 |
| --- | --- |
| 前端生产代码/样式变化 | `npm run build` |
| libraryStore 并发/加载行为变化 | `npm run test:frontend -- --library library` |
| Rust 源码变化 | `cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml`，以及 `cargo test --manifest-path src-tauri/Cargo.toml <相关测试过滤器>` |
| Rust 跨模块影响或后端阶段回归 | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Rust 源码或当前统计登记变化 | `npm run audit:unwrap`，核对并同步登记后 `npm run audit:check` |
| 只修改测试运行器/测试 | 执行对应测试；新增/改变行为时自证红绿，不因此构建未变化的产品或设备制品 |

过滤测试时确认实际命中了预期测试；零个测试不是通过证据。不要把字典整段复制执行。

### 前端回归

现有 TypeScript 编译器加 Node 内置测试运行器，无新增依赖。命令从仓库根目录执行：

```powershell
npm run test:frontend -- --list
npm run test:frontend -- --library library
```

默认 `npm run test:frontend` 执行当前登记的全部前端自动测试；日常优先选择受影响子集。目前只有 `library`：编译实际 `src/stores/libraryStore.ts`，仅替换 IPC 边界，在隔离目录验证旧列表不覆盖新列表、删除刷新不被旧列表恢复、并发加载与失败后的恢复。成功输出场景数、源码摘要和退出码，失败返回非零；不需要启动应用或连接设备。

新增/改变该组测试时运行一次自证（普通重跑不必）：

```powershell
npm run test:frontend -- --library library --red-green
```

自证只改变 `target/` 下隔离副本，执行目标缺陷失败及干净源码恢复；生产源文件不注入缺陷。临时构建位于已忽略的 `target/frontend-tests/`，不得提交。此入口不验证 React 页面、真实 IPC/SQLite、CFI 或 SAF；对应机械步骤与阶段分配见 [验证策略](VERIFICATION.md#前端机械执行路径)。未来仅在相关功能变更时加入高价值回归。

### 平台构建

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

新增或改变测试行为按 [验证策略](VERIFICATION.md) 自证；原缺陷复现变红即可，不重复为未改测试注入。记录必须同时写明测了什么、没测什么、版本与平台；构建和静态审查不能替代设备运行态。Android 破坏性存储实验只能按 [受控验收流程](../ANDROID_STORAGE_ACCEPTANCE.md) 在确认的受限虚拟设备执行。

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
