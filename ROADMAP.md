# 项目长期路线图

本文件规定阶段顺序和冻结边界。当前可执行任务以 [TODO.md](TODO.md) 为准，依赖引入规则以 [README.md](README.md) 为准。

## 核心原则

- 严格按 Phase 顺序推进，禁止跨阶段开发。
- 新增任何依赖都必须先获得人类确认，并同步更新 README 白名单和 CONVENTIONS。
- 支持平台仅为 Windows、Linux、Android；iOS 不在路线图范围内。

## Phase 1：核心阅读引擎（功能开发结束）

目标：实现 EPUB 文件选择、持久化导入、OPF 元数据解析、基础 EPUB.js 渲染，以及关闭后恢复 CFI 阅读进度。

依赖：Tauri v2、React、EPUB.js、rusqlite、zip、quick-xml、桌面官方 Dialog 插件，以及不引入新第三方依赖的项目自有 Android SAF 移动插件。

交付物：Windows 桌面已完成本地 EPUB 选择、书架元数据与封面、删除、打开、翻页、重启进度恢复和来源重新定位。Android 代码链保留，但 SDK/NDK、Rust/Kotlin 构建与设备持久权限验收列为外部阻塞，因此 Phase 1 不等同于全平台认证完成。

## Phase 2：沉浸式阅读体验

目标：目录树、高亮批注、全局搜索、字体/主题等阅读设置。

依赖：以 Phase 1 的书籍、进度与 `notes` Schema 为基础。不得改变 Phase 1 已发布的来源与进度契约，除非同时提供迁移。

执行前置：整本 EPUB `Vec<u8>` 内存缓存、来源指纹、受控 Reader、Android 私有缓存、ZIP 总解压预算和格式能力边界已经完成整改。当前继续交付图形化目录、高亮批注、当前书与同系列搜索、系列、标签组/标签以及全局加单书覆盖的阅读设置。

## Phase 3：多格式扩展（冻结区）

目标：支持 PDF、TXT、CBZ、CBR。

严格约束：PDF 渲染、RAR 解压、图像归档和相关 npm/Rust 依赖目前均不在白名单。Phase 1 和 Phase 2 禁止实现这些格式或提前引入相关依赖。进入本阶段前，必须向人类提交技术选型（例如 PDF Web 渲染与原生渲染的比较），获批并更新 README 后才可开始。

### Phase 3 待评估建议（未批准实现）

- 重新评估 PDF、CBZ、CBR 的页面模型，届时再决定是否引入 `PageProvider`，不得复用 Phase 2 文本流接口硬套页面格式。
- 比较 PDF Web 渲染、原生渲染和混合方案；比较 CBZ ZIP 与 CBR RAR 的解析依赖、安全预算和授权风险。
- 当至少存在两个获批格式实现时，评估 Cargo Feature 隔离；Phase 2 不为空占位处理器增加 feature。
- TXT 是否需要目录、编码检测和精确位置模型必须单独设计，不假定 EPUB CFI。

## Phase 4：跨端体验适配

目标：完成 Windows、Linux、Android 的体验适配，包括触控翻页、深色模式原生跟随、不同 WebView CSS 兼容性和大文件内存诊断。

Android 的基础 SAF `ACTION_OPEN_DOCUMENT`、持久 URI 权限、重启校验和失效 URI 重新选择属于 Phase 1，不得推迟到本阶段。本阶段只在该基础上处理触控、WebView 与性能体验。

### Phase 4 待评估建议（未批准实现）

- Android/Linux 不同 WebView 对自定义协议、Range、字体和 iframe 选区的兼容性矩阵。
- 触控翻页、手势冲突、系统深色模式跟随、窄屏双抽屉和无鼠标操作验收。
- Android 图片查看器的双指缩放/拖动/长按手势实机验收，以及私有 SAF 插件通过 `ACTION_CREATE_DOCUMENT` 导出单个 EPUB 图片；在该能力完成前不得宣称 Android“另存为”可用。
- Android 私有来源缓存的大文件磁盘诊断、后台清理、低存储空间降级与 Provider 性能。
- 各平台崩溃恢复、日志脱敏、内存/磁盘压力监控和自动化设备流水线。
