# EpubStart

一个基于 Tauri v2 和 React 的极简、高性能跨平台 EPUB 阅读器。项目优先交付 EPUB 的本地导入、渲染与阅读进度恢复；书架数据模型从一开始为 TXT、PDF、CBZ、CBR 预留扩展空间。

目标平台为 Windows、Linux、Android。iOS 不在当前路线图范围内。

## 文档导航

仓库已包含可运行的 Tauri + React 应用。Phase 1 的 Windows 桌面 EPUB 导入、封面、删除、阅读、翻页与应用重启后的 CFI 恢复有历史验收记录。B0 后端审计与 B1 后端核心能力已于 2026-08-14 完成：V1/V3 迁移回滚测试已补齐变红自证，Android 官方命令已从干净 scaffold 产出 debug APK/AAB，双机来源链门禁与导入卡住修复已有记录；自动化未覆盖的 Android Provider、WebView 和长期压力行为仍按设备证据单独标注。当前阶段为 B2 后端业务能力，并新增 Android 发布制品与运行时存储预算规划；前端 WebView 如何消费资源 URL 不属于 B0/B1 后端完成判定。证据与边界见 [BACKEND_AUDIT.md](BACKEND_AUDIT.md)，执行顺序见 [TODO.md](TODO.md)。

当前开发策略已切换为 **Backend First**：先完成 Rust 后端、SQLite、来源/协议、平台适配、搜索/索引和 IPC 契约，再重建和美化 React 前端。现有前端只作为 legacy shell 保留；后端阶段不再以页面完成度、截图或前端构建通过作为产品验收证据。具体阶段、门禁和冻结规则见 [ROADMAP.md](ROADMAP.md)，当前执行看板见 [TODO.md](TODO.md)。

- [ARCHITECTURE.md](ARCHITECTURE.md)：模块职责、目录边界与资源访问原则。
- [DATABASE.md](DATABASE.md)：SQLite 的唯一 Schema 定义与迁移规则。
- [IPC.md](IPC.md)：Rust Command 和 TypeScript 调用方的唯一公开契约。
- [CONVENTIONS.md](CONVENTIONS.md)：代码风格、依赖白名单和 Agent 行为约束。
- [ROADMAP.md](ROADMAP.md)：阶段边界与冻结区。
- [TODO.md](TODO.md)：当前阶段的执行看板；开始开发前必须先阅读。
- [BACKEND_AUDIT.md](BACKEND_AUDIT.md)：B0 后端审计结论与缺口清单（2026-08-14）。

若文档间存在冲突，以职责更专门的文档为准：依赖与命令以本文件为准，目录职责以架构文档为准，表字段以数据库文档为准，Command 签名和错误语义以 IPC 文档为准。

## 技术栈白名单

除非先获得人类确认并同步更新本节，项目只能使用下列第三方依赖。

| 范围 | 允许使用 |
| --- | --- |
| 桌面/移动框架 | Tauri v2、`@tauri-apps/cli`、`@tauri-apps/api`、`@tauri-apps/plugin-dialog`、`tauri-plugin-dialog`、项目自有 Android SAF 移动插件（不引入额外第三方依赖） |
| 前端运行时 | React 18、React DOM、EPUB.js（npm 包 `epubjs`）、Zustand |
| 前端构建与样式 | Vite、`@vitejs/plugin-react`、TypeScript、`@types/react`、`@types/react-dom`、TailwindCSS、PostCSS、Autoprefixer |
| Rust | `tauri` v2、`tauri-build`、`serde`、`serde_json`、`rusqlite`、`zip`、`quick-xml`、`tokio`、`uuid` |
| 存储 | SQLite（通过 `rusqlite`） |

`@tauri-apps/plugin-dialog` 与 `tauri-plugin-dialog` 是已批准的唯一额外官方插件，用于 Windows/Linux 原生文件选择。其 Android 实现不提供 Phase 1 所需的持久 SAF 授权，因此 Android EPUB 选择必须使用仓库内的 Tauri 移动插件，通过 `ACTION_OPEN_DOCUMENT` 完成；该插件属于项目源码，不是新的 npm 包或 Rust crate。项目不得直接依赖 `jni` crate，移动端桥接使用 Tauri v2 已提供的插件通道。PDF、RAR/CBR、远程网盘、WebDAV、HTTP/OAuth 或厂商 Provider SDK 相关依赖不在白名单内，详见 [ROADMAP.md](ROADMAP.md) 的冻结区。

## 快速启动

使用以下命令启动与验证。Agent 必须使用这些命令进行验证：

```powershell
# 前端启动
npm run dev

# Rust 编译检查
cd src-tauri && cargo check

# 全局构建
npm run tauri build
```

需要同时运行前端和 Rust 后端并打开桌面窗口时，使用 `npm run tauri dev`。Android SDK/NDK、Rust targets 和双机环境已经具备；桌面构建与模拟器不能替代真实设备上的 SAF Provider、持久权限、进程回收、低存储、WebView 和手势验收。B1 首次真实设备来源链门禁已经完成；B2 继续验证后台任务、低存储以及发布制品/运行时存储预算，B3 再执行发布候选回归，详细矩阵见 [ROADMAP.md](ROADMAP.md)。

## 测试 EPUB

`这里是终末停滞委员会/` 是本地功能验收用的 EPUB 样本目录，仅保留在工作区、不纳入版本库（已在 `.gitignore` 排除），作为功能回归测试的固定样本。以下两本是当前主要验收文档：

### `这里是终末停滞委员会 - 04.epub`（TODO #5 主要验收文档）

- OPF 位于 `OEBPS/content.opf`（非根目录），spine href 相对 OPF 目录，用于验证 entryPath 解析是否保留 OPF 所在目录前缀。
- 全页插图使用 `<svg><image xlink:href="../Images/204617.jpg"/></svg>`，用于验证 SVG `<image>` 检测、边缘翻页与图片查看器联动。
- `rendition:spread-none` 属性的封面/前页章节用于验证 spread 模式下边缘翻页与 image 优先原则的交互。

### `6（x）=.epub` / `epub/6.epub`（Phase 1 基线验收文档）

- Phase 1 的导入、封面提取、删除、EPUB 阅读、可见翻页与应用重启后的 CFI 恢复均以此书验收。
- OPF 位于 `item/standard.opf`（根目录下的子目录），与 vol04 的 `OEBPS/` 结构不同，用于验证不同 OPF 路径布局的兼容性。
- 全页插图使用 `<svg><image xlink:href="../image/i-071.jpg"/></svg>`（单数 `image/` 目录），用于验证 SVG `<image>` 检测在另一种路径布局下的行为。
- 正文章节含 `page-spread-left` / `page-spread-right` 属性，用于验证 spread 双页模式下左右 View 的 click handler attach 及边缘翻页稳定性。

## 开发原则

- React 负责 UI 与 EPUB.js iframe 渲染；Rust 负责文件、ZIP/XML、SQLite、权限和自定义协议。
- 前端只通过 Tauri `invoke` 访问本地数据，必须处理 `Result<T, String>` 的错误结果。
- EPUB ZIP 内部资源统一由 Rust 的 `epub://` 自定义协议提供，不能将 `asset://` 当作 ZIP 文件读取器。
- P3 解锁后，外层 ZIP 只能作为导入分发容器，或在内容全为受支持图片时以 CBZ 漫画语义导入；项目不得新增 `BookFormat::Zip`。当前 `zip` crate 只批准用于 EPUB 与既有安全读取，不代表通用 ZIP/CBZ 已进入实现范围。
- 用户明确删除图书时会按数据库契约级联删除进度与批注；之后重新导入属于新记录。数据库中仍存在的同 `source_locator` 记录会复用原 `book_id`；文件移动后，通用导入也只会按指纹恢复唯一匹配的 `missing/error` 记录，多候选时拒绝猜测。
- 每次工作从 [TODO.md](TODO.md) 第一个未完成且无外部阻塞的 `[ ]` 任务开始，并满足该任务的完成标准后再勾选。后端 B0–B3 未通过前，禁止新增前端功能或视觉优化；仅允许为 IPC 契约同步、类型检查、安全修复和构建阻塞进行最小前端改动。
