# EpubStart

一个基于 Tauri v2 和 React 的极简、高性能跨平台 EPUB 阅读器。项目优先交付 EPUB 的本地导入、渲染与阅读进度恢复；书架数据模型从一开始为 TXT、PDF、CBZ、CBR 预留扩展空间。

目标平台为 Windows、Linux、Android。iOS 不在当前路线图范围内。B2 已完成搜索/索引、目录资源契约、系列关系、标签 CRUD/继承/筛选、阅读设置、批注数据契约，以及 Android release 制品门禁和来源/封面缓存预算的代码与受控运行态收口。当前阶段为 B3：Windows legacy shell 已覆盖其实际具备的运行态链，系列/标签 UI 消费按 Backend First 边界留给 F2；2026-08-24 已从当前提交重新生成 arm64 APK/AAB，完整 arm64 lint 与静态体积/ABI/ELF 门禁通过，并在黑鲨 SKW-A0 与荣耀 PPG-AN00 上完成同一 release payload 的空白安装、首次启动和主进程运行态复测。当前仍缺固定样本运行时占用、release 私有 data 精确分项和正式 release 签名；更广 OEM/前端消费矩阵归 F2，状态见 [TODO.md](TODO.md)。

## 文档导航

仓库已包含可运行的 Tauri + React 应用。B0/B1 已于 2026-08-14 完成，B2 受控收口已覆盖活动读者、来源 hard-limit、六轮累计逻辑压力、SQLite 低余量和多记录业务/缓存恢复；封面 hard-limit 公共保护重叠仍只保留辅助逻辑证据。2026-08-24 的 B3 当前提交复测通过 181/181 Rust 测试、Windows x64 安装包构建、arm64 APK/AAB 静态审计和 `:app:lintArm64Release`（0 error、31 warning、1 hint）。Android arm64 空白安装与首次启动已在黑鲨 SKW-A0、荣耀 PPG-AN00 完成；固定样本运行时占用、release 私有 data 精确分项和正式 release 签名仍未完成。证据与边界见 [BACKEND_AUDIT.md](BACKEND_AUDIT.md)、[B3_ANDROID_RELEASE_CANDIDATE.md](B3_ANDROID_RELEASE_CANDIDATE.md)，执行顺序见 [TODO.md](TODO.md)。

当前开发策略已切换为 **Backend First**：先完成 Rust 后端、SQLite、来源/协议、平台适配、搜索/索引、阅读洞察和 IPC 契约，再重建和美化 React 前端。现有前端只作为 legacy shell 保留；后端阶段不再以页面完成度、截图或前端构建通过作为产品验收证据。B4 是在 B3 候选冻结之后经用户明确批准的追加后端变更，不追认 B3 已签发，也不提前解锁前端。具体阶段、门禁和冻结规则见 [ROADMAP.md](ROADMAP.md)，当前执行看板见 [TODO.md](TODO.md)。

- [ARCHITECTURE.md](ARCHITECTURE.md)：模块职责、目录边界与资源访问原则。
- [DATABASE.md](DATABASE.md)：SQLite 的唯一 Schema 定义与迁移规则。
- [IPC.md](IPC.md)：Rust Command 和 TypeScript 调用方的唯一公开契约。
- [CONVENTIONS.md](CONVENTIONS.md)：代码风格、依赖白名单和 Agent 行为约束。
- [CONTEXT.md](CONTEXT.md)：产品、文档与代码共享的领域词汇。
- [ROADMAP.md](ROADMAP.md)：阶段边界与冻结区。
- [TODO.md](TODO.md)：当前阶段的执行看板；开始开发前必须先阅读。
- [BACKEND_AUDIT.md](BACKEND_AUDIT.md)：B0 后端审计结论与缺口清单（2026-08-14）。
- [B3_WINDOWS_RUNTIME.md](B3_WINDOWS_RUNTIME.md)：2026-08-23 Windows 开发态与 release 桌面回归的已测项、未测项和搜索修复证据。
- [B3_ANDROID_RELEASE_CANDIDATE.md](B3_ANDROID_RELEASE_CANDIDATE.md)：2026-08-24 当前提交的 arm64 APK/AAB、完整 lint、静态门禁与待补设备占用证据。
- [B3_CONTRACT_FREEZE.md](B3_CONTRACT_FREEZE.md)：B3 Command、模型、错误、数据库、资源预算和来源状态的冻结候选及未签发条件。
- [docs/adr/0001-reading-duration-history.md](docs/adr/0001-reading-duration-history.md)：B4 阅读时长、历史独立性、继续阅读与离线推荐的已接受决策。
- [ANDROID_STORAGE_ACCEPTANCE.md](ANDROID_STORAGE_ACCEPTANCE.md)：B2 受控 Android 虚拟设备低存储、重启和长期压力验收包；已记录活动读者、来源 hard-limit、SQLite 低余量、长期压力和多记录恢复证据，并明确封面 hard-limit 与 B3/F2 设备矩阵边界。

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

# 前端与静态审计
cd ..
npm run build
npm run audit:unwrap
npm run audit:android-release

# 全局构建
npm run tauri build
```

需要同时运行前端和 Rust 后端并打开桌面窗口时，使用 `npm run tauri dev`。`audit:android-release` 只审计已经生成的 arm64 release APK/AAB、原生库与 `dist`，不会自行构建或证明 Android 运行态。Android SDK/NDK、Rust targets 和双机环境已经具备；桌面构建不能替代 Android 验收，普通模拟器也不能替代真实设备上的 SAF Provider、持久权限、OEM 进程回收、WebView、性能和手势证据。由于现有真机无法安全构造近满存储，B2 的 ENOSPC/SQLite 满盘、长期/2 GiB 压力及重启清理允许延期到固定 API、受控 `/data` 容量的可复现 Android 虚拟设备执行；该例外不外推到其他实机门禁。B1 首次真实设备来源链门禁已经完成；B2 受控 AVD 已补齐活动读者、来源 hard-limit、SQLite 低余量、六轮固定样本逻辑压力和多记录业务/缓存恢复，真实设备取消/进程终止/重建记录直接保留；封面 hard-limit 公共并发分支和更广 OEM/真实设备矩阵分别按边界记录，后者移至 B3/F2。详细证据见 [ANDROID_STORAGE_ACCEPTANCE.md](ANDROID_STORAGE_ACCEPTANCE.md) 与 [ROADMAP.md](ROADMAP.md)。

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
- EPUB ZIP 内部资源统一由 Rust 的 `epub` 协议处理，不能将 `asset://` 当作 ZIP 文件读取器；Windows/Android WebView 通过 `http://epub.localhost/...` 映射，其他桌面平台保留 `epub://localhost/...` 形式。
- P3 解锁后，外层 ZIP 只能作为导入分发容器，或在内容全为受支持图片时以 CBZ 漫画语义导入；项目不得新增 `BookFormat::Zip`。当前 `zip` crate 只批准用于 EPUB 与既有安全读取，不代表通用 ZIP/CBZ 已进入实现范围。
- 用户明确删除图书时会按数据库契约级联删除进度与批注；之后重新导入属于新记录。数据库中仍存在的同 `source_locator` 记录会复用原 `book_id`；文件移动后，通用导入也只会按指纹恢复唯一匹配的 `missing/error` 记录，多候选时拒绝猜测。
- 每次工作从 [TODO.md](TODO.md) 第一个未完成且无外部阻塞的 `[ ]` 任务开始，并满足该任务的完成标准后再勾选。后端 B0–B4 未通过前，禁止新增前端功能或视觉优化；仅允许为 IPC 契约同步、类型检查、安全修复和构建阻塞进行最小前端改动。
