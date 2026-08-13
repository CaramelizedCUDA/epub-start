# EpubStart

一个基于 Tauri v2 和 React 的极简、高性能跨平台 EPUB 阅读器。项目优先交付 EPUB 的本地导入、渲染与阅读进度恢复；书架数据模型从一开始为 TXT、PDF、CBZ、CBR 预留扩展空间。

目标平台为 Windows、Linux、Android。iOS 不在当前路线图范围内。

## 文档导航

仓库已包含可运行的 Tauri + React 应用。Phase 1 的 Windows 桌面 EPUB 导入、封面、删除、阅读、翻页与应用重启后的 CFI 恢复已验收。Phase 1 功能开发已经结束；Android SAF 的 Rust/Kotlin 构建与设备验收因缺少 SDK/NDK 和设备环境列为外部阻塞，不得据此宣称全平台验收完成。当前开发阶段为 Phase 2；来源指纹、受控 Reader、ZIP 安全预算、格式注册表、V2/V3 迁移、基础图形工具栏、嵌套目录、数字步进阅读设置、批注/系列/标签的基础 IPC，以及图形化高亮批注（选区浮动菜单、纯高亮、批注文字、改色、编辑、删除、列表与点击跳转、重启恢复）已经落地；完整搜索和书架管理仍按 TODO 推进。

- [ARCHITECTURE.md](ARCHITECTURE.md)：模块职责、目录边界与资源访问原则。
- [DATABASE.md](DATABASE.md)：SQLite 的唯一 Schema 定义与迁移规则。
- [IPC.md](IPC.md)：Rust Command 和 TypeScript 调用方的唯一公开契约。
- [CONVENTIONS.md](CONVENTIONS.md)：代码风格、依赖白名单和 Agent 行为约束。
- [ROADMAP.md](ROADMAP.md)：阶段边界与冻结区。
- [TODO.md](TODO.md)：当前阶段的执行看板；开始开发前必须先阅读。

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

`@tauri-apps/plugin-dialog` 与 `tauri-plugin-dialog` 是已批准的唯一额外官方插件，用于 Windows/Linux 原生文件选择。其 Android 实现不提供 Phase 1 所需的持久 SAF 授权，因此 Android EPUB 选择必须使用仓库内的 Tauri 移动插件，通过 `ACTION_OPEN_DOCUMENT` 完成；该插件属于项目源码，不是新的 npm 包或 Rust crate。项目不得直接依赖 `jni` crate，移动端桥接使用 Tauri v2 已提供的插件通道。PDF、RAR/CBR 或图片解压相关依赖不在白名单内，详见 [ROADMAP.md](ROADMAP.md)。

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

需要同时运行前端和 Rust 后端并打开桌面窗口时，使用 `npm run tauri dev`。Android 设备验收还需要已配置的 Android SDK/NDK、模拟器或真实设备；桌面构建通过不能替代 Android 重启后的持久权限验收。

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
- 用户明确删除图书时会按数据库契约级联删除进度与批注；之后重新导入属于新记录。数据库中仍存在的同 `source_locator` 记录会复用原 `book_id`；文件移动后，通用导入也只会按指纹恢复唯一匹配的 `missing/error` 记录，多候选时拒绝猜测。
- 每次工作从 [TODO.md](TODO.md) 第一个未完成且无外部阻塞的 `[ ]` 任务开始，并满足该任务的完成标准后再勾选。
