# 安全策略

## 威胁模型

EpubStart 是一个本地优先的 EPUB 阅读器。主要威胁来源为：

1. **恶意 EPUB 文件**：攻击者可能构造 ZIP bomb、超深嵌套 XML、超大资源等来耗尽内存/磁盘
2. **渲染层攻击**：不可信 EPUB 内容（XHTML/CSS/JS）在 iframe 中渲染，可能尝试突破隔离
3. **路径遍历**：通过 `epub://` URI 中构造 `../` 试图访问 ZIP 外文件
4. **来源伪造**：前端传入的 `source_locator` 可能包含相对路径或非法 URI

## 敏感资产

- `books.source_locator`：桌面绝对路径或 Android `content://` URI，不应暴露到渲染层 UI
- `cover_cache_path`：应用数据目录下的绝对路径，应通过 `asset://` 协议中转
- 来源 Reader/Android 私有缓存：不得在应用状态保留整本 EPUB 原始字节
- 数据库文件 `epubstart.db`：位于 `app_data_dir`

## 已实施的安全措施

### 输入资源预算（ZIP bomb 防护）

| 限制项 | 值 | 位置 |
|---|---|---|
| 单条目最大解压体积 | 50 MiB | `epub/mod.rs`, `protocol/mod.rs` |
| 控制文件最大体积（container.xml/OPF） | 2 MiB | `epub/mod.rs` |
| ZIP 最大条目数 | 5,000 | `epub/mod.rs` |

当前已统一实施：压缩源 512 MiB、声明与实际总解压量 2 GiB、单项及整包压缩比 200:1；B2 搜索提取已加入单章节 8 MiB、单书 64 MiB、一次任务累计提取量 2 GiB 限制，所有计数使用溢出检查。2 GiB 是异常输入处理的安全上限，不是允许搜索索引常驻设备的体积目标。Android 已验证系统 picker 的 13.20 MiB 单次导入、超大章节拒绝和持久 URI 授权撤销后的来源失效，并记录过一次重建的主库/rollback journal 占用；缓存写入的常见存储耗尽 OS 错误已用内存错误对象覆盖，SQLite `SQLITE_FULL` 已通过限制 `max_page_count` 的真实写事务映射为稳定 `BOOK_RESOURCE_LIMIT_EXCEEDED:` 并验证回滚保留旧索引。Android 低存储与长期/2 GiB 导入压力仍未完成，经批准延期至固定镜像和受控 `/data` 容量的 Android 虚拟设备；该例外不替代 SAF、OEM、性能或手势实机证据。

这些限制当前针对 EPUB 资源链。P3 的 CBZ/图片 ZIP 和通用 ZIP 分发包必须重新评估条目数、嵌套层数、总解压量、单图尺寸、总像素、解码内存和暂存磁盘预算；不得因复用 `zip` crate 而自动沿用不充分的 EPUB 限制。

外层分发 ZIP 的规划安全基线为：默认最多检查一层嵌套；拒绝加密归档、符号链接、绝对路径、路径穿越、重名/大小写冲突和异常文件名；只解包到应用私有暂存目录；成功后原子转移，失败/取消清理；多书导入逐项事务化。该规划在 P3.0 前不构成实现批准。

所有 ZIP 条目读取使用 `std::io::Read::take(limit)` 包装。

### 内存与私有存储预算

已移除 `epub_bytes_cache`。桌面使用 `File + Read + Seek`，Android 使用应用私有来源缓存；缓存使用 size、mtime 与前 4 KiB 精确样本指纹，失配时原子重建，当前实现为单本 512 MiB、总量 1 GiB，并通过租约保护在用文件。ZIP 同时执行 5,000 条目、单项 50 MiB、控制文件 2 MiB、总解压 2 GiB 和 200:1 压缩比限制。

当前 1 GiB 是实现中的拒绝上限，不是产品目标。B2 规划将来源缓存改为软/硬上限 256/512 MiB、封面缓存 64/128 MiB，并要求缓存命中更新 `last_accessed_at`、按真实 LRU 淘汰、活动 `SourceLease` 不被删除；搜索索引已实施 256 MiB UTF-8 文本字节账面硬上限，全部可重建数据的合计硬上限不超过 1 GiB。达到硬上限且无法安全淘汰时必须返回稳定资源限制错误。数据库、阅读进度、批注、设置和用户明确保存的文件不属于可清理缓存。

### Android 体积探查基线（2026-08-15，规划证据）

本次只建立诊断基线，不声明 release 已达标：

- 当前官方构建的 arm64 universal debug APK 为 310,548,144 字节（296.16 MiB）；其中 `libepub_start_lib.so` 为 145.08 MiB。较早的 151.08 MiB 是旧/中间产物，不能作为最终 APK 基线。ELF 主要膨胀来自 `.debug_info`、`.debug_str`、`.debug_line`、`.debug_ranges` 等调试段；此前副本仅移除调试信息后，原生库降至 27.27 MiB。
- 前端 `dist` 约 0.57 MiB，DEX 压缩后约 5.19 MiB；当前 APK 还存在约 144.20 MiB 的 ZIP 对齐/保留空洞，需在 release 构建链中单独解释。因此设备显示约 338 MB 可合理解释为 debug APK、系统解包/优化及应用数据的合计，不能外推为 release 安装体积。
- 黑鲨设备应用私有数据约 31.45 MiB，其中来源缓存约 26.82 MiB、封面约 3.99 MiB；这证明运行时缓存会随使用增长，必须与发布制品分开治理。
- 本次 arm64 release 测量在 Tauri 插件生成缓存的目录冲突处失败：`tauri-plugin-fs/android/.tauri/tauri-api` 报“文件已存在（os error 183）”。未删除 Cargo 全局缓存、未加入本地构建绕过，因此尚无可信 release APK/AAB 基线。

B2 初始制品门禁为 arm64 release APK ≤ 40 MiB、Rust 原生库 ≤ 30 MiB、前端 `dist` ≤ 2 MiB，并对任一分项相对已提交基线增长超过 10% 要求解释。debug 包只用于诊断；发布候选禁止携带原生调试段、测试 EPUB、预置缓存或本机构建产物。首次干净 release 基线建立后，这些预算只允许收紧；放宽须经人工批准并同步项目文档。

### CSP 策略

```text
default-src 'self';
style-src 'self' 'unsafe-inline' epub: http://epub.localhost;
img-src 'self' epub: http://epub.localhost data: asset: http://asset.localhost;
font-src 'self' epub: http://epub.localhost;
script-src 'self';
connect-src 'self' ipc: http://ipc.localhost epub: http://epub.localhost
```

封面仅通过 Tauri asset protocol 暴露，文件系统 scope 限制为 `$APPDATA/covers/**`。

### Tauri Capabilities

渲染层沿用 `core:default` 与文件选择权限，并仅额外授予 `core:window:allow-set-fullscreen` 支持阅读器全屏切换；不授予窗口创建、任意文件系统或 Shell 权限。

### CORS 收紧

`epub://` 协议响应只反射受信任的应用 WebView 来源：开发态 `localhost:1420`、Tauri 生产来源和自定义协议的 opaque `null` 来源。外部 HTTP(S) 来源不会获得 `Access-Control-Allow-Origin`，不再使用通配符。

### 路径穿越防护

`epub://` URI 的 `entry_path` 经过多层校验：
- 禁止 `..` 和 `\`
- 禁止以 `/` 开头
- 通过 `Path::components()` 规范化后二次检查

同一规范化函数也用于 `save_book_image`；该 Command 只允许 `image/*`，复用 50 MiB 单条目和 ZIP 总预算，并在 Rust 端调用桌面保存对话框。前端只提交 `book_id` 与 EPUB 内部条目路径，不接收来源定位符、目标主机路径或图片字节。Android 在 SAF 创建文档写入链完成前明确拒绝导出。

### EPUB iframe 隔离

EPUB.js 默认禁用 iframe 中的脚本执行和弹窗。EPUB XHTML 内容渲染在独立的 `<iframe>` 中，与主 WebView 分离。

### 来源校验

- 桌面：强制绝对路径 + 文件存在性 + 可读性 + 扩展名验证
- Android：所有 `content://` URI 需通过 SAF 插件验证持久读取权限
- 前端传入的 `source_kind` 与 locator 格式交叉验证

### 数据库迁移事务

V1、V2、V3 迁移分别在 `BEGIN IMMEDIATE ... COMMIT` 中完成，错误分支执行回滚，避免半完成状态导致永久启动失败。当前绿色套件覆盖空库、V1 升级、重复启动、V2 冲突回滚、V1/V3 回滚断言和图书拥有关系的级联删除。V1/V3 回滚测试已完成“在目标失败分支注入 `COMMIT` 破坏回滚→目标断言变红→恢复→变绿”的自证，详细断言见 [BACKEND_AUDIT.md](BACKEND_AUDIT.md) 0.2.5。未覆盖：真实损坏数据库恢复、磁盘写满/断电等运行态故障。

### 错误脱敏

- 所有 Rust Command 返回 `Result<T, String>`，禁止泄露堆栈、原始 SQL 或完整 URI
- 前端 `tauri.ts` 通过 `mapError` 集中转换所有错误为 `Error` 对象
- `libraryStore.ts` 的 `userFacingError` 对已知错误前缀映射用户友好中文提示

## 漏洞报告

如果发现安全漏洞，请通过以下方式私下报告：

- 在 GitHub 仓库创建安全咨询（Security Advisory）
- 或发送邮件至项目维护者

请勿在公开 Issue 中披露安全漏洞细节。

## 依赖更新与发布修复

- 所有 Rust 和 npm 依赖变更必须先更新 README 白名单
- 安全修复优先于功能开发
- 每个发布版本需经过 `cargo test` + `tsc --noEmit` + `vite build` 验证

## 已知限制

- Android SAF 持久权限的运行时撤销检测依赖平台插件
- 当前无自动化的 Android 设备验收流水线
- Android SDK/NDK、Rust targets 与双机环境已经具备；官方干净 debug 构建和 B1 首次实机来源链门禁已完成，导入卡住 workaround 已有黑鲨 30 轮与荣耀连续导入记录。未覆盖自动化设备回归、所有 DocumentsProvider；长期压力和低存储故障因真机硬件条件延期至受控 Android 虚拟设备。
- 尚无可信的 arm64 release 体积基线；本次测量受 Tauri 插件生成缓存目录冲突阻塞。当前 debug APK 为 296.16 MiB，设备显示约 338 MB 不得写成 release 体积结论，B2/B3 必须完成分项预算与发布候选复测。
- legacy 前端/WebView 如何请求 EPUB 资源属于前端集成范围，不作为 B0 后端安全审计是否通过的判据
- EPUB.js 的 iframe 隔离依赖其内置安全策略，而非 Tauri 主 WebView 的 CSP
- 封面文件通过 `asset://` 协议暴露，需确认 `asset` scope 配置正确
- 外部网盘仍处于 P4 冻结区；当前没有网络授权、令牌存储、远程缓存或跨设备同步能力。未来接入前必须扩展威胁模型，且不得把令牌写入 `books`、日志或前端可见模型
