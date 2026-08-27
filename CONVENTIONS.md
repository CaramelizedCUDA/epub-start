# 代码规范与 AI 行为准则

本文件是实现时的强制规则。依赖清单的唯一权威来源为 [README.md](README.md)，数据与 IPC 的具体定义分别以 [DATABASE.md](DATABASE.md) 和 [IPC.md](IPC.md) 为准。

## Backend First 工作边界

- B0–B4 后端阶段优先处理 `src-tauri/`、SQLite、平台、协议、后台任务和 IPC；现有 `src/` 视为 legacy shell。
- 后端阶段禁止新增前端功能、视觉优化或交互重构。只有 IPC 契约同步、类型检查、安全修复和构建阻塞允许最小前端改动。
- 后端完成必须以 Rust/数据库/协议/错误路径/运行态验收为证据；`npm run build`、页面截图和前端人工操作不能单独证明后端完成。
- 只有完成 [ROADMAP.md](ROADMAP.md) 的 B3 未签发条件与经批准追加的 B4 契约，才可进入前端 F1–F3。进入前端阶段后，先重建信息架构和状态处理，再做视觉美化。
- 后端契约冻结后，任何为 UI 便利而修改 Command、模型、错误前缀、数据库字段或资源预算的行为都必须重新记录迁移、更新契约并补充测试。

## Rust

- 业务逻辑、数据库访问、解析器和 Tauri Command 中严禁 `.unwrap()` 与 `.expect()`；使用 `?`、明确的错误映射或返回 `Result`。
- 所有 IPC 入参和返回模型必须 `#[derive(Serialize, Deserialize)]`。所有 Command 必须返回 `Result<T, String>`。
- Command 保持薄；文件 I/O、ZIP/XML、SQLite 和平台代码必须归入其职责模块。
- `platform/`、`source/`、`formats/`、`protocol/`、`services/` 必须遵守 ARCHITECTURE 的单向职责；`protocol/` 禁止引用 `formats::epub::*`。
- 格式能力不得以 `Option` 默认空结果、`panic!`、`todo!` 或 `unimplemented!()` 伪装支持；不支持的格式或能力返回稳定错误。
- 未来能力不得以空 Command、永远为 `null` 的字段、永不产生的枚举分支或通用 JSON 预占契约；进入对应阶段时通过显式契约变更加入。
- 任何来源读取前必须校验文件存在性/可读性或 Android URI 权限。失效时持久化 `missing` 状态并返回 `BOOK_SOURCE_UNAVAILABLE:`。
- 编写 Rust 后先在心中检查所有权、借用与生命周期，再使用 README 规定的 `cargo check` 验证。

## React 与样式

- 只使用函数式组件和 Hooks。
- 全局客户端状态只使用 Zustand；禁止引入 Redux，禁止以 Context API 承载可由 props、局部状态或 Zustand 管理的全局业务状态。
- 样式必须使用 TailwindCSS 工具类。禁止新建独立 CSS 文件；仅 EPUB.js iframe 的内容样式允许注入全局 CSS。
- React 通过 `src/lib/tauri.ts` 调用后端，必须处理成功、加载和错误状态；不得直接访问主机文件系统、SQLite 或 ZIP。

## IPC 同步铁律

修改 Tauri Command 的参数、返回值、共享模型或错误前缀时，必须在同一个变更中同步更新：

1. Rust `#[tauri::command]` 和 serde 模型；
2. [IPC.md](IPC.md) 的契约；
3. `src/types/models.ts` 与 `src/types/ipc.ts`；
4. `src/lib/tauri.ts` 及每个调用点；
5. 必要的测试和 [TODO.md](TODO.md) 状态。

## 平台代码规范

`src-tauri/src/platform/` 承载跨平台差异。所有平台特定代码必须通过 `#[cfg]` 条件编译隔离，禁止在 command 或 protocol 层内联平台条件逻辑。

### 目录结构

- `platform/mod.rs` — `#[cfg]` 条件导出统一平台 API（`FileMetadata`、`select_epub_sources`、`validate_epub_source`、`open_source_file`、`release_source_permission`、平台插件初始化）。整本 EPUB 不再通过 `Vec<u8>` 公共 API 传递。
- `platform/desktop.rs` — `#[cfg(not(target_os = "android"))]` 桌面实现：`std::fs::read`、路径校验、no-op 权限持久化。
- `platform/android.rs` — `#[cfg(target_os = "android")]` Android 实现：注册并调用项目自有 Tauri 移动插件。
- `gen/android/.../EpubSafPlugin.kt` — 持有 Activity 上下文，封装 `ACTION_OPEN_DOCUMENT`、持久权限、元数据查询和只读文件描述符。

### 公共接口签名

平台函数对桌面和 Android 保持同名，并显式接收 `AppHandle`，不得依赖全局 JNI 状态：

- `select_epub_sources(app: &AppHandle) → Future<Output = Result<Vec<SelectedSource>, String>>` — 桌面使用官方 Dialog；Android 通过异步移动插件调用等待 Activity 回调，选择、持久授权成功后才返回 URI。
- `validate_selected_source(source: &SelectedSource) → Result<(), String>` — 不信任前端回传的 `source_kind`，验证它与当前平台及 locator 类型一致。
- `validate_epub_source(app: &AppHandle, source_locator: &str) → Result<FileMetadata, String>` — 校验来源可访问并返回可获得的元数据。
- `open_source_file(app: &AppHandle, source_locator: &str) → Result<File, String>` — 桌面打开受校验路径；Android 从插件取得已转移所有权的只读文件描述符并由 Rust `File` 负责关闭。`source/` 在其上提供受控 Reader 和租约。
- `release_source_permission(app: &AppHandle, source_locator: &str) → Result<(), String>` — 桌面 no-op；Android 用于拒绝重新定位候选等不再需要授权的场景。
- `epub_root_url(book_id: &str) → String` — 平台层处理 Windows WebView2 的 localhost 映射与其他平台的自定义协议 URL，Command 不得内联平台分支。

### Android 移动插件规则

- 禁止 command 或 protocol 层直接调用 Kotlin、JNI 或 Android API；所有调用经 `platform/android.rs` 的 Tauri 移动插件句柄完成。
- `content://` URI 只作为 `source_locator` 存入 DB，不作为文件路径传递给 `std::fs` 或 `Path`。
- 文件选择与 `takePersistableUriPermission` 必须在同一个 Android Activity 结果回调中完成。授权成功前不得向 Rust 返回 URI；用户取消返回空选择。
- Kotlin 不得通过 JSON 返回整本 EPUB 字节。插件返回 `ParcelFileDescriptor.detachFd()` 得到的只读 FD 后，FD 所有权转移给 Rust；Rust 必须用拥有所有权的 `File` 包装并依靠 drop 关闭。
- SAF Provider 缺失的 size/mtime 返回 `0`，不得伪造。重启后必须重新查询持久权限；权限失效映射为 `BOOK_SOURCE_UNAVAILABLE:`。
- 修改生成 Android 工程前必须保留 `EpubSafPlugin.kt`；重新运行 Tauri Android 初始化时检查其是否被覆盖。

### Android 验证门禁

- 模拟器通常只用于构建和基础行为检查，真实设备仍负责 SAF Provider、持久授权、授权撤销、OEM 进程回收、WebView、性能与手势验证。唯一例外是现有真机无法安全构造的破坏性存储压力：固定 API、固定镜像并限制 `/data` 容量的受控 Android 虚拟设备可替代执行 ENOSPC/SQLite 满盘、长期/2 GiB 写入及重启清理；必须记录镜像、容量、初始/峰值/清理后占用和命令，不得把结果外推为真实设备性能或 OEM 行为。
- B1 第一次真实设备来源链门禁已经完成；B3 前必须完成来源链回归，否则不得宣称全平台后端冻结或开始 Android 前端功能接入。
- B2 在真实设备验证索引取消、系统终止恢复、大文件和可安全执行的缓存行为；低存储与长期/2 GiB 破坏性压力按上述受控虚拟设备例外延期。F2/F3 分别验证功能接入与体验/兼容性矩阵。
- 至少保留一台较低配置/较旧系统设备与一台当前主流设备；Android DocumentsProvider 云端来源只用于 SAF 兼容测试，不代表 P4 网盘功能已经实现。
- Android 体积报告必须分开记录 release APK/AAB、原生库、前端 `dist`、安装后 code 和应用 data/cache。debug 包与系统设置页的合计数字只可作诊断线索，不得作为发布大小结论。
- 体积门禁优先使用现有构建工具和可复现脚本；不得为了缩小包体删除安全检查、错误诊断能力或用户数据，也不得把调试段、测试 EPUB、本机缓存、`.so` 或构建目录提交入库。
- `npm run audit:android-release` 只读取当前 arm64 release 制品，并核对绝对/相对基线、工具链、ABI、ELF 调试段和禁止 payload；执行前必须先生成 APK/AAB 与 `dist`。脚本通过不等于 Gradle lint、签名发布或设备运行态通过。
- Android build type 角色固定为：debug 使用 debug Rust/JNI 调试；profile 使用 release Rust、`applicationIdSuffix=.profile`、应用可调试、JNI 不可调试、R8 关闭和 debug 签名；release 使用 release Rust/R8 且不携带运行时调试段。为 AVD 暂存到已忽略 `jniLibs` 的本地 `.so` 只能用于 profile 打包，禁止提交或当作官方 release 构建链。
- 破坏性存储验收必须先通过 `emulator-*` 序列号与 `ro.kernel.qemu=1` 双重检查，并按 [ANDROID_STORAGE_ACCEPTANCE.md](ANDROID_STORAGE_ACCEPTANCE.md) 留存证据；未执行时统一标记 Android 环境“阻塞”。

## 依赖管理与白名单控制（最高优先级）

### 当前允许使用的库

- 前端运行时：`react`、`react-dom`、`@tauri-apps/api`、`@tauri-apps/plugin-dialog`、`epubjs`、`zustand`。
- 前端构建与样式：`@tauri-apps/cli`、`vite`、`@vitejs/plugin-react`、TypeScript、`@types/react`、`@types/react-dom`、`tailwindcss`、`postcss`、`autoprefixer`。
- Rust：`tauri` v2、`tauri-build`、`tauri-plugin-dialog`、`serde`、`serde_json`、`rusqlite`、`zip`、`quick-xml`、`tokio`、`uuid`。项目不得直接添加 `jni`；Tauri 自身的传递依赖不视为项目白名单项。

### 严格引入协议

1. 禁止擅自引入：上述白名单外的任何 npm 包或 Rust crate 均不得加入、安装或在代码中引用。
2. 遇到能力瓶颈：若白名单无法实现功能（例如 PDF、RAR、复杂富文本），必须停止编码，不能以临时代码绕过限制。
3. 提案流程：向人类说明“我需要一个库来实现 [功能]”、“推荐 [库 A] 或 [库 B] 及理由”，等待确认将其加入 README 白名单后才可继续。
4. 冻结区：`ROADMAP.md` 标记为冻结区的 TXT、CBZ/图片 ZIP、PDF、CBR、通用 ZIP 分发包与外部网盘/远程来源，在当前阶段禁止触碰，禁止提前引入任何相关依赖或 Command。

现有 `zip` crate 仅批准用于 EPUB 和当前受控资源读取，不代表获准实现 CBZ、图片 ZIP 或通用 ZIP 分发包。P3 解锁前不得增加 `BookFormat::Zip`、`ImportInspector` 占位实现或外层归档导入入口。

### P3/P4 留存规则

当前无法可靠评估的页面渲染 trait、PDF/图像归档接口、Cargo Feature 拆包、新格式依赖、外部网盘 Provider、网络/OAuth/安全存储依赖、Android/Linux WebView 性能和跨端触控专项必须记录到 ROADMAP 对应冻结区。记录建议不代表批准实现；进入对应阶段后仍须重新评估并获得人类确认。

## Agent 工作流

- 每次开始实现前读取 [TODO.md](TODO.md)，只处理按顺序第一个未完成且无阻塞的任务，并先阅读其完成标准。
- 完成且验证通过后，才将该任务改为 `[x]`；不得提前勾选或声称未实现模块已完成。
- 不在任务范围内重构，不复制现有模块，不跳过阶段。发现冲突、缺少批准依赖或安全/权限风险时，记录阻塞并请求人类决策。
