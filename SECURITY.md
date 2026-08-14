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

当前已统一实施：压缩源 512 MiB、声明与实际总解压量 2 GiB、单项及整包压缩比 200:1。搜索提取将在 TODO 的 B2 搜索任务随索引实现加入单章节 8 MiB、单书 64 MiB、索引总量 2 GiB 限制；所有计数必须使用溢出检查。

这些限制当前针对 EPUB 资源链。P3 的 CBZ/图片 ZIP 和通用 ZIP 分发包必须重新评估条目数、嵌套层数、总解压量、单图尺寸、总像素、解码内存和暂存磁盘预算；不得因复用 `zip` crate 而自动沿用不充分的 EPUB 限制。

外层分发 ZIP 的规划安全基线为：默认最多检查一层嵌套；拒绝加密归档、符号链接、绝对路径、路径穿越、重名/大小写冲突和异常文件名；只解包到应用私有暂存目录；成功后原子转移，失败/取消清理；多书导入逐项事务化。该规划在 P3.0 前不构成实现批准。

所有 ZIP 条目读取使用 `std::io::Read::take(limit)` 包装。

### 内存缓存上限

已移除 `epub_bytes_cache`。桌面使用 `File + Read + Seek`，Android 使用应用私有来源缓存；缓存使用 size、mtime 与前 4 KiB 精确样本指纹，失配时原子重建，单本 512 MiB、总量 1 GiB，并通过租约保护在用文件。ZIP 同时执行 5,000 条目、单项 50 MiB、控制文件 2 MiB、总解压 2 GiB 和 200:1 压缩比限制。

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

V1、V2、V3 迁移分别在 `BEGIN IMMEDIATE ... COMMIT` 中完成，错误分支执行回滚，避免半完成状态导致永久启动失败。当前绿色套件覆盖空库、V1 升级、重复启动、V2 冲突回滚、V1/V3 回滚断言和图书拥有关系的级联删除；但新写的 V1/V3 回滚测试没有留存故意破坏实现后的变红证据，因此这两项只能记为“测试代码存在且当前为绿”，不能记为“回滚已自证有效”。未覆盖：真实损坏数据库恢复、磁盘写满/断电等运行态故障。

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
- Android SDK/NDK、Rust targets 与双机环境已经具备，并有 SAF/权限/缓存/错误前缀和后端协议响应的初步探查记录；未覆盖稳定导入和自动化设备回归
- Android 导入存在间歇性卡住，官方 `tauri android build` 也尚未在无本地绕过的干净 scaffold 上稳定复现；B1 后端/平台首次真实设备门禁因此未通过，B3 前不得宣称 Android 后端已冻结或可发布
- legacy 前端/WebView 如何请求 EPUB 资源属于前端集成范围，不作为 B0 后端安全审计是否通过的判据
- EPUB.js 的 iframe 隔离依赖其内置安全策略，而非 Tauri 主 WebView 的 CSP
- 封面文件通过 `asset://` 协议暴露，需确认 `asset` scope 配置正确
- 外部网盘仍处于 P4 冻结区；当前没有网络授权、令牌存储、远程缓存或跨设备同步能力。未来接入前必须扩展威胁模型，且不得把令牌写入 `books`、日志或前端可见模型
