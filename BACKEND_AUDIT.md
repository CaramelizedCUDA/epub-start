# 后端审计与健康基线（B0 交付物）

审计日期：2026-08-14。审计对象：`src-tauri/`（生产代码、测试、迁移、协议、平台适配），以及 [IPC.md](IPC.md)、`src/types/ipc.ts`、`src/lib/tauri.ts` 的契约一致性。

本文件是 B0 阶段的审计产出。2026-08-14 复核时曾撤回原“B0 完成”证明，随后在 V1/V3 变红自证与 Android 干净构建补齐后重新签发；B1 也已完成。下列状态仍用于避免把代码存在、命令为绿和人工探查混为一谈：

- **已实现**：代码真实存在且可定位。
- **辅助逻辑（静态/单元）**：可由审查或自动化命令覆盖；必须同时写明已测与未测范围。
- **桌面端**：需要 Windows/Linux 人工运行态证据；历史记录不自动升级为本次验证。
- **Android 环境**：SDK/NDK/targets/设备已具备；B1 已有双机运行态记录，但未自动化的 Provider/WebView、低存储和长期压力行为仍须单列，不能由桌面测试代替。

## 0.1 基线验证

### 发布构建（本次审计完成）

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `npm.cmd run tauri build`（第一次） | 通过 | 2026-08-14 11:48 产出 `EpubStart_0.1.0_x64_en-US.msi`（5.20 MB）与 `EpubStart_0.1.0_x64-setup.exe`（3.01 MB）；exe 11.65 MB |
| `npm.cmd run tauri build`（第二次，验证可重复性） | 通过，exit 0 | 2026-08-14 11:53 同一产物路径二次产出，`EXIT=0` |
| 锁文件 | 存在 | `src-tauri/Cargo.lock`（2026-07-21）、`package-lock.json`（2026-07-18）；构建期间无依赖漂移 |

环境阻塞记录（与项目代码无关，仅供复现参考）：本会话沙箱在受限模式下禁止 esbuild/cargo 派生子进程（spawn EPERM），需要在提权模式下运行构建；用户侧正常环境不受影响。PowerShell 的 `2>&1` 会把 npm 的 stderr `Info` 行包装成 NativeCommandError 噪音，第二次用 `cmd /c` 重定向验证 exit code 为 0，构建本身无错误。

### 自动化命令（执行事实与覆盖边界）

- `cargo test`：B1 收尾时 108/108 通过，exit 0（2026-08-14）。已测：迁移回滚、协议 Range、资源读取、并发租约、来源纯逻辑、错误脱敏、仓储事务及系列/标签/设置/批注错误路径；本次新增测试均完成变红自证，详见修复记录。未测：自动化 Android Provider/Activity、真实磁盘写满/断电、长期压力和所有 WebView 版本。
- `cargo fmt --check` 与 `cargo check`：B1 收尾时通过（2026-08-14）。

### Android 环境（B1 首次门禁已完成）

- 已具备 JDK 17、Android SDK/NDK、四个 Rust Android targets、荣耀 PPG-AN00（Android 15）和黑鲨 SKW-A0（Android 9）；固定 EPUB 样本共 8 本。
- `cargo check --target aarch64-linux-android` 在显式设置 NDK 编译器后通过，证明 Rust 目标可编译；未证明完整 Tauri Android 工程可干净复现。
- 官方 `npm.cmd run tauri -- android build --debug --target aarch64` 已在干净 scaffold 上通过（2026-08-14，exit 0，产出 debug APK 与 AAB；`gen/android` 删除后重新 `tauri android init --ci` 生成、`EpubSafPlugin.kt` 放回、无任何本地构建绕过）。
- 双机已有后端/平台探查，协议处理器可返回资源、状态码和 MIME；导入卡住已通过 Tauri MainPipe 唤醒窗口 workaround 关闭并完成设备回归。legacy 前端/WebView 如何消费资源 URL 属于前端集成范围，不参与 B0/B1 后端完成判定。

**下一次复核条件**：干净官方构建已通过；导入卡住已修复（见 0.4）；B1 实机门禁已在双机完成（SAF 选择、重启、撤销、重新定位、缓存、FD 生命周期、协议状态码/MIME/CORS/Range/路径防护），详细证据见 0.4 探查矩阵与修复记录。

## 0.2 生产代码健康审计

### 0.2.1 panic/unwrap/expect 与锁生命周期 — 通过

- `panic!`、`todo!`、`unimplemented!`、`unreachable!`：生产代码 0 处（grep 全量确认）。
- `.unwrap()`：`npm run audit:unwrap` 只扫描 `src-tauri/src`，按“包含调用的源码行”自动统计为 273 行（共 280 次调用），全部位于 `#[cfg(test)]` 测试模块内，无一处出现在生产路径；不再把 `src-tauri/target` 生成代码计入结果。
- `.expect()`：生产代码仅 1 处，`lib.rs:94` 的 `.run(tauri::generate_context!()).expect("error while running tauri application")`。这是 Tauri 事件循环的标准启动收口；`setup` 闭包内的目录/数据库/迁移错误均已用 `map_err` + `?` 转成可诊断错误。风险等级：低。修复任务：可选，B1 前保留现状即可。
- 安全 unwrap 变体（`unwrap_or`/`unwrap_or_else`/`unwrap_or_default`）：43 处，均为带默认值的非 panic 形式，合格。
- 锁与生命周期：`AppState.db: Mutex<Connection>`，服务层统一经 `lock_db` 辅助函数获取并把 poisoning 映射为错误；`source/cache.rs` 的 `active: Mutex<HashMap<String, Weak<()>>>` 同样映射 poisoning，租约由 `Arc<()>` 守护。未发现手动 `spawn` 线程或生命周期漏洞。
- 忽略错误（`let _ =`）14 处：均为 best-effort 清理（迁移 ROLLBACK 失败、缓存文件删除、SAF 权限释放、封面清理），语义合理，不需要处理。

### 0.2.2 Command 薄适配审计 — 通过（3 个缺口已关闭，2026-08-14）

36 个 Command 现在全部为薄适配（参数解析 + 服务调用 + 错误转换）。原 3 个缺口均已修复：

1. `commands/save_reading_progress.rs`：progression 范围校验、unix 时间戳、upsert 与回查已下沉到 `services::save_reading_progress`（`services/library_service.rs`）。
2. `commands/get_reading_progress.rs` 与 `commands/list_books.rs`：已改为经 `services::get_reading_progress` / `services::list_books` 编排（统一 `lock_db` 与错误转换）。
3. 错误前缀不一致：51 处小写 `internal error:` 已全部统一为 `INTERNAL_ERROR:`（grep 复核 0 处小写残留，大写共 73 处）。

### 0.2.3 lib.rs 启动错误语义 — 通过

- `setup` 内 app_data_dir 解析、目录创建、SourceManager 创建、SQLite 打开、迁移执行全部用 `map_err` + `?` 传播为带上下文的错误；任何失败都会中止启动并显示可诊断原因，无启动期 panic 掩盖。
- 插件注册（dialog、epub_saf 平台插件）与 `epub` 协议注册为声明式注册，失败由 Tauri 框架统一报告。
- 唯一 `expect` 见 0.2.1，为事件循环收口。

### 0.2.4 Command 注册清单比对 — 36/36 一致，1 个文档缺口

Rust 注册（`lib.rs` invoke_handler）36 个 Command，与 [IPC.md](IPC.md)（Phase 1 9 个 + 后端业务 27 个）、`src/types/ipc.ts`、`src/lib/tauri.ts` 逐一比对：

- **命名一致**：36 个 Command 名称在 Rust/IPC.md/tauri.ts 三方完全一致，无命名漂移。
- **入参/返回一致**：ipc.ts 声明的 Args 类型覆盖所有带参 Command；`save_global_reading_settings` 的 Rust 参数为 `settings`（直接参数，非嵌套对象），tauri.ts 对应传 `{ settings }`，符合 Tauri v2 约定。
- **未实现**：B2 搜索 Command（`ensure_series_search_index` 等 5 个）未注册、无 stub，符合 IPC.md 与 TODO B2 的规定。
- **未调用**：18 个系列/标签目录 wrapper（`list_series`…`list_book_tags`）在后端已实现并有测试，但 legacy shell 前端未调用。这符合 B 阶段「前端冻结」策略，不视为缺陷，在 F2 接入。
- **文档缺口**：`BOOK_RESOURCE_NOT_FOUND:` 前缀在 Rust（`formats/epub/mod.rs:45`）、协议层（`protocol/mod.rs:79`）与前端 `mapError` 中均已使用，但 [IPC.md](IPC.md) 错误契约表缺少该行。本次审计已补上（见下方修复记录）。

### 0.2.5 数据库迁移清单 — 通过（V1/V3 已补变红自证）

| 迁移 | 内容 | 幂等 | 失败回滚 | 测试 |
| --- | --- | --- | --- | --- |
| V1 | books/reading_progress/notes + 4 索引 | 版本表 `_migrations` 门控 | BEGIN IMMEDIATE…COMMIT/ROLLBACK | 建表、升级保留数据、索引、幂等；回滚测试已完成变红自证 |
| V2 | source_cache_entries/series/标签/设置/search_documents + FTS5 trigram/search_index_state + notes.cfi_range | 同上 | 同上 | 冲突回滚、级联删除 |
| V3 | 阅读设置新字段 + 数据转换 + 表重建 | 同上 | 同上 | 旧值转换、默认值；回滚测试已完成变红自证 |

- 外键级联：`PRAGMA foreign_keys = ON` 在迁移入口开启；`test_v2_cascade_removes_all_book_owned_rows` 覆盖 books 删除后 8 张子表级联清空，系列/标签定义保留。
- FTS5 trigram 虚拟表已在 V2 建立（仅 Schema），索引逻辑按 TODO B2 交付，无假进度。
- `test_v1_failure_rolls_back_every_v1_object` 与 `test_v3_failure_rolls_back_every_v3_object` 已完成变红自证（2026-08-14 补证）：将对应失败分支的 `ROLLBACK;` 临时替换为 `COMMIT;` 破坏事务回滚——V1 测试变红且失败断言为 `books was not rolled back`（migrations.rs:640，证明失败发生在 V1 的 `notes` 冲突步骤之后）；V3 测试变红且失败断言为 `font_size_px` 列存在（left: 1，migrations.rs:682，证明失败发生在 V3 的 `global_reading_settings_v3` 冲突步骤之后）；恢复实现后 `cargo test db::migrations` 9/9 通过、完整 `cargo test` 通过（见修复记录）。

### 0.2.6 安全边界清单 — 辅助逻辑有覆盖，运行态仍有缺口

| 边界 | 实现位置 | 状态 |
| --- | --- | --- |
| 来源校验 | `platform/desktop.rs`（绝对路径+存在+可读+扩展名）、`platform/android.rs`（content:// 校验 + 插件持久权限复核）、`platform/mod.rs`（共享 SAF 纯逻辑：picker 响应转换 + content:// 非空 authority 校验，2026-08-14） | 辅助逻辑：桌面 `validate_selected_source` 3 个测试 + SAF 9 个测试（均变红自证，2026-08-14）；未测：自动化 Android Provider/撤销链（Kotlin 真机行为，双机探查为准） |
| Reader 租约 | `source/reader.rs` + `source/cache.rs`：SourceLease + Arc 守护；桌面直读文件、Android 私有缓存原子复制 + 指纹复核 | 辅助逻辑：租约共享/重建/并发与临时文件清理 5 个测试 + 变红自证（2026-08-14）；Android 自动化 FD/缓存恢复仍为设备抽样 |
| ZIP 预算 | `formats/epub/mod.rs`：5000 条目、2 MiB 控制文件、50 MiB 单条目、2 GiB 总解压、200:1 压缩比、`checked_add` 溢出检查、`take()` 包装 | 辅助逻辑已测压缩比与超限；未测真实设备低存储/大文件运行态 |
| 协议路径 | `services/format_service.rs::normalize_entry_path`：拒绝 `..`、`\`、`/` 开头、空段；Components 规范化二次检查 | 辅助逻辑已测路径规范化；Android 后端路由有初步设备探查；前端消费方式不在本审计范围 |
| MIME | `formats/epub/mod.rs::mime_for_path` 扩展名白名单；响应带 `X-Content-Type-Options: nosniff` | 辅助逻辑已测扩展名映射；Android 后端响应有初步设备探查；WebView 渲染不在本审计范围 |
| Range | `protocol/mod.rs::serve_range`：单段 `bytes=start-end`、开放结尾、suffix、越界 416 + `Content-Range: bytes */len`、多段/非法回退全文；`Accept-Ranges: bytes` | 已实现/已自动验证（8 个单元测试 + 变红自证，2026-08-14） |
| CORS | `protocol/mod.rs::allowed_cors_origin` 白名单（开发源 + Tauri 源 + opaque null），外部源不反射 | 辅助逻辑已测白名单；未测各 Android WebView 版本的真实 Origin 行为 |
| 错误脱敏 | `protocol/mod.rs::sanitize_source_error` 只保留前缀；`image_service` 用白名单化前缀脱敏（2026-08-14 修复盘符冒号缺陷）；services 层 `INTERNAL_ERROR:` 后不再透传 rusqlite 原始错误；前端 mapError 兜底 | 辅助逻辑已测稳定前缀与状态码映射（协议层 2 个 + image_service 白名单/盘符回归 2 个，2026-08-14，均有变红自证）；未测所有设备/Provider 错误文本 |
| 单条目图片导出 | `services/image_service.rs`：仅 `image/*` MIME、文件名清洗、桌面保存对话框、Android 明确返回 `FORMAT_NOT_SUPPORTED:` | 辅助逻辑已测 MIME、文件名和来源错误脱敏；桌面写入仅有历史人工记录；Android 仅观察到未支持错误，未实现 SAF 写入 |
| Android 权限 | `EpubSafPlugin.kt`：takePersistableUriPermission 成功后才返回 URI；inspectUri/openReadFd 每次复核 persistedUriPermissions；releasePermission 释放授权 | 静态实现存在且 B1 双机门禁已通过；未有自动化 Provider/Activity 覆盖，长期压力与低存储仍待 B2/B3 |

## 0.3 B0 完成标准（已满足，2026-08-14 重新签发）

1. 审计结果与缺口清单已经形成，IPC.md 的 `BOOK_RESOURCE_NOT_FOUND:` 文档缺口已经修复。
2. 已按辅助逻辑、桌面端、Android 环境三类重写证据口径，并同步 README/ROADMAP/TODO/SECURITY。
3. B0 原未满足项已全部关闭（2026-08-14）：V1/V3 回滚测试已完成变红自证（见 0.2.5）；Android 平台工程已用官方命令从干净、已审查的 scaffold 稳定构建（见 0.1）。B0 完成证明重新签发；其后 Android 稳定导入缺口也已在 B1 关闭。前端/WebView 资源请求方式不参与 B0/B1 后端判定。

## 0.4 Android 初步实机探查与 B1 收口（2026-08-14）

### 环境与设备

- 工具链（命令行轻量方案，`D:\Android\Sdk`）：Temurin JDK 17.0.20（`D:\Android\jdk17`）、cmdline-tools 15859902、platform-tools 37.0.1、platforms;android-35、build-tools;35.0.0、NDK 27.3.13750724；用户级 `JAVA_HOME`/`ANDROID_HOME`/`NDK_HOME`/`PATH` 已设置。
- Rust Android targets 已装：aarch64/armv7/i686/x86_64-linux-android。
- `gen/android` 已通过 `tauri android init --ci` 从干净 scaffold 重新生成，项目自有 `EpubSafPlugin.kt` 已保留；本地绕过与构建产物未入库，边界见本节末尾。
- 设备 1：荣耀 PPG-AN00（Android 15/API 35，arm64，WebView 150.0.7871.181），无线调试接入。
- 设备 2：黑鲨 SKW-A0（Android 9/API 28，arm64，WebView 79.0.3945.116），USB 接入。
- 官方构建可重复性已恢复（2026-08-14）：干净 scaffold + 官方命令 exit 0；历史本地绕过链不再使用。

### 探查矩阵与证据边界

| 项 | 内容 | 结果 |
| --- | --- | --- |
| A | 启动/崩溃 | 双机可启动/重启，观察到数据库与缓存目录；官方干净构建已通过（2026-08-14），产物验证并入 B1 门禁 |
| B1 | SAF 选择 | 初步探查时曾间歇性卡住；MainPipe 唤醒 workaround 后，黑鲨 30 轮导入/删除与荣耀 8 本连续导入全部完成，B1 门禁关闭 |
| B2 | 持久授权（重启） | 观察到重启后记录保留；后端等价路由可返回资源 200，可作为处理器运行态线索；不评价前端消费方式 |
| B3 | 授权撤销/来源失效 | 观察到 `BOOK_SOURCE_UNAVAILABLE:` 稳定前缀；尚无自动化设备覆盖 |
| B4 | 重新定位 | 观察到来源恢复后 `open_book` 成功；尚无完整 UI 回归记录 |
| B5 | FD 生命周期 | `open_book` ×40 抽样时 fd 308→341→310；只是不见稳定泄漏的观察，非压力/长期证明 |
| B6 | 私有缓存 | 观察到 `.source` 与 `.fingerprint.json`；未验证低存储、损坏或并发恢复 |
| C | 后端协议处理 | 等价路由观察到 container.xml/OPF/XHTML/图片/CSS 的 200 与 MIME、路径穿越 400、失效来源 404；属于后端处理器的运行态线索，仍需可重复的直接测试/设备记录 |
| D | 图片导出 | 观察到稳定 `FORMAT_NOT_SUPPORTED:`；Android SAF create-document 写入尚未实现 |
| E | 数据持久化 | 抽样观察到进度/批注在 force-stop 后保留；未形成自动化或完整设备矩阵 |
| F | 错误脱敏 | 抽样观察到稳定错误前缀；未覆盖所有 Provider/系统错误文本 |

### 已确认修复与未关闭问题

1. **移动端入口（保留修复）**：缺少 `#[cfg_attr(mobile, tauri::mobile_entry_point)]` 时 Android 报 `UnsatisfiedLinkError: No implementation found for Rust.create`；`src-tauri/src/lib.rs` 已补属性，桌面检查/构建不受影响。
2. **旧 WebView 语法兼容（只保留 Vite target）**：`vite.config.ts` 使用 `build.target="es2019"`。对 Vite 原始产物的 AST 检查未发现可选链或空值合并语法；额外 `scripts/postbuild-es2019.mjs` 会重复转换，并且直接使用未在白名单/`package.json` 声明的传递依赖 `esbuild`，因此不入库。
3. **导入卡住（已修复，2026-08-14）**：根因为 Tauri 上游 bug——从 `ACTION_OPEN_DOCUMENT` 返回后 wry `MainPipe` 直到下一次 IPC 写入才唤醒，picker 响应无法送达前端（tauri#14994 / plugins-workspace#1741，上游已合并未发布）。定位证据：卡住时日志链停在 `select_epub_sources: picker returned` 之后、`import_book` 从未被调用；后端压测 41 轮全过。修复：`platform/android.rs::select_epub_sources` 在返回前端前 `sleep(200ms)` 给事件循环唤醒窗口（上游发版后移除）。双机验证：黑鲨 30 轮导入/删除循环无卡住；荣耀 8 本连续导入（22:20:04–22:20:15，间隔 1–2 秒）全部完成、UI 回到空闲。
4. **范围说明**：曾观察到 Android WebView 对某种前端 `fetch(epub://...)` 用法不兼容；这是 legacy 前端集成问题，不作为 B0 后端或 B1 后端处理器是否正常的判据，留待 F 阶段处理。

### 构建与 scaffold 入库边界

- 官方 Android 构建已修复并验证（2026-08-14）：`gen/android` 删除后重新 `tauri android init --ci` 生成，仅放回项目自有 `EpubSafPlugin.kt`，无任何本地构建绕过（无 `BuildTask.kt` 修改、无手动 `.so` 复制、无 `local.properties`、无 `assets/` 预置）；`npm.cmd run tauri -- android build --debug --target aarch64` exit 0 产出 APK 与 AAB。
- 入库边界不变：禁止入库 `app/src/main/assets/`、`.so`、`build/`、`.gradle/`、`local.properties`、生成 schema 副本和本地绕过；已跟踪的 `EpubSafPlugin.kt` 必须保留；scaffold 由 `gen/android/.gitignore` 与项目根 `.gitignore` 控制。

## 0.5 Android 体积与缓存探查（2026-08-15，B2 规划输入）

本节记录测量事实与未覆盖项，不签发 release 体积完成证明。

| 分项 | 测量结果 | 结论边界 |
| --- | --- | --- |
| universal arm64 debug APK | 158,415,466 字节（151.08 MiB） | 仅为 debug 产物，不代表 release |
| `lib/arm64-v8a/libepub_start_lib.so` | 143.97 MiB，约占 APK 95% | 主要由 Rust/NDK 调试段构成；副本仅移除调试信息后为 27.27 MiB |
| 前端 `dist` | 约 0.57 MiB | 不是本次膨胀主因 |
| DEX | 压缩后约 5.19 MiB | 次要占用 |
| 设备应用私有数据 | 约 31.45 MiB | 其中来源缓存约 26.82 MiB、封面约 3.99 MiB；会随使用增长 |

ELF 分段检查显示主要调试段包括 `.debug_info`、`.debug_str`、`.debug_line` 和 `.debug_ranges`。因此设备设置页观察到约 338 MB，可合理解释为 debug APK、系统解包/运行时优化和应用数据的合计；不能据此声称 release 安装包为 338 MB，也不能据此声称 release 已达标。

本次 arm64 release 构建已经进入 Rust release 编译，但在现有 Tauri 插件生成缓存处失败：`tauri-plugin-fs/android/.tauri/tauri-api` 创建目录时报“文件已存在（os error 183）”。本次没有删除 Cargo 全局缓存、没有修改生成任务、没有手动复制 `.so`，因此可靠 release APK/AAB 基线仍缺失。B2 接手方向与初始预算见 [TODO.md](TODO.md)“Android 制品与运行时存储预算”；B3 前必须形成可重复 release 分项报告。

当前 `source/cache.rs` 的总上限为 1 GiB，淘汰按文件 `modified` 排序；缓存命中提前返回，不会把访问时间写回文件或 `source_cache_entries.last_accessed_at`，因此不能称为真实 LRU。活动租约受保护，但跳过活动项后没有形成可证明的硬上限闭环；封面缓存也没有独立总预算。这些均为 B2 未完成项，不能在本节标记“已验证”。

## 缺口清单

| # | 缺口 | 文件位置 | 风险 | 修复任务 | 验证命令 |
| --- | --- | --- | --- | --- | --- |
| 1 | 进度保存的业务校验/时间戳/回查在 Command 内 | `src-tauri/src/commands/save_reading_progress.rs` | 低 | **已修复**（2026-08-14）：下沉到 `services::save_reading_progress` | `cargo test` |
| 2 | 两个只读 Command 直连 repository，绕过 services 层 | `commands/get_reading_progress.rs`、`commands/list_books.rs` | 低 | **已修复**（2026-08-14）：经 `services::get_reading_progress` / `services::list_books` | `cargo test` |
| 3 | 51 处小写 `internal error:` 前缀 | 多个 services/commands 文件 | 低 | **已修复**（2026-08-14）：全部统一为 `INTERNAL_ERROR:`，grep 复核 0 处小写残留 | `cargo test` + grep 复核 |
| 4 | `epub://` 协议无 Range 支持 | `src-tauri/src/protocol/mod.rs` | 低 | **已实现**（2026-08-14）：`serve_range` 单段/开放结尾/suffix/416/回退 + `Accept-Ranges`；8 个单元测试 + 变红自证；并发 Reader 租约 5 个测试 + 变红自证 | `cargo test` |
| 5 | lib.rs 事件循环 `expect` | `src-tauri/src/lib.rs:94` | 低 | 可选：保持 Tauri 惯例 | `cargo check` |
| 6 | Android 官方构建不可从干净 scaffold 复现 | `src-tauri/gen/android`、Tauri Android 生成/构建链 | 高/阻塞 B0 完成证明 | **已关闭**（2026-08-14）：干净再生成 scaffold（保留 EpubSafPlugin.kt）、无本地绕过，官方命令 exit 0 产出 APK/AAB | `npm.cmd run tauri -- android build --debug --target aarch64` |
| 7 | Android 导入偶发卡住 | `platform/android.rs`、SAF 插件/来源缓存链 | 高/阻塞 B1 实机门禁 | **已关闭**（2026-08-14）：根因 tauri#14994 MainPipe 唤醒，`select_epub_sources` 返回前 200ms sleep workaround；黑鲨 30 轮循环导入无卡住 | 双机后端/平台验收 |
| 8 | V1/V3 回滚测试缺少变红自证 | `src-tauri/src/db/migrations.rs` | 中/阻塞 B0 完成证明 | **已补证**（2026-08-14）：V1/V3 分别在目标步骤注入 `COMMIT;` 破坏回滚并确认目标断言变红（V1: `books was not rolled back`@640；V3: `font_size_px` 列@682），恢复后 9/9 与完整套件通过 | `cargo test db::migrations` + `cargo test` |
| 9 | Android release 制品缺少可重复分项基线 | Gradle/Tauri release 构建链、体积报告脚本 | 中/阻塞 B3 冻结 | **B2 待处理**：先解决 `tauri-plugin-fs/android/.tauri/tauri-api` 目录冲突，再测 arm64 release APK/AAB、原生库、前端 dist 与安装后 code；不得用 debug 338 MB 代替 | 干净 arm64 release 构建 + 分项体积报告 |
| 10 | 来源/封面缓存缺少真实 LRU 与完整软硬预算 | `source/cache.rs`、`source_cache_entries`、封面清理逻辑 | 中/长期膨胀风险 | **B2 待处理**：来源 256/512 MiB、封面 64/128 MiB，命中更新 `last_accessed_at`，活动租约保护，合计可重建数据硬上限 ≤ 1 GiB；低存储与孤儿清理需变红自证 | 单元/集成变红验证 + Android 分项占用回归 |

## 修复记录

- 2026-08-14：`src-tauri/src/db/migrations.rs` 新增 V1/V3 失败回滚测试；2026-08-14 复核时因缺少变红自证撤回“已验证”结论，测试代码保留等待补证。
- 2026-08-14：[IPC.md](IPC.md) 错误契约表新增 `BOOK_RESOURCE_NOT_FOUND:` 行。
- 2026-08-14：`src-tauri/src/lib.rs` 补 `#[cfg_attr(mobile, tauri::mobile_entry_point)]`（Android JNI glue 缺失，P0，见 0.4）。
- 2026-08-14：`vite.config.ts` 保留 `build.target="es2019"`；删除不必要且依赖未声明 `esbuild` 的 postbuild 二次转换。
- 2026-08-14：修复 `scripts/audit-unwrap.mjs` 仅扫描 `src-tauri/src`，排除 `target` 生成代码；BACKEND_AUDIT/TODO 自动同步为 202 行/209 次。
- 2026-08-14：删除误提交的 `.tmp_probe_ports.js`、`.tmp_sqlite_dump.js`，并用 `.gitignore` 的 `.tmp_*` 防止同类前缀临时脚本再次入库。
- 2026-08-14：撤回 B0 完成证明（V1/V3 迁移测试缺少变红证据、Android 官方干净构建未通过）与 B1 Android 后端/平台完成证明（稳定导入待完成）；前端 `fetch` 行为明确移出 B0 判定。
- 2026-08-14：V1/V3 回滚测试完成变红自证（注入 COMMIT 破坏回滚 → 目标断言变红 → 恢复 → 9/9 绿），B0 缺口 #8 关闭。
- 2026-08-14：`gen/android` 干净再生成（无本地绕过）后官方 `tauri android build` exit 0，B0 缺口 #6 关闭，B0 完成证明重新签发。
- 2026-08-14：B1 缺口 #1/#2/#3 关闭——`save_reading_progress`/`get_reading_progress`/`list_books` 下沉 `services::library_service`，51 处小写 `internal error:` 统一为 `INTERNAL_ERROR:`。
- 2026-08-14：B1 缺口 #4 关闭——`epub://` 协议实现 Range（单段/开放/suffix/416/回退 + `Accept-Ranges`）；新增协议层 10 个测试、format_service 3 个资源读取测试、cache 5 个并发租约测试，均完成变红自证；完整 `cargo test` 85/85 通过。
- 2026-08-14：B1 缺口 #7 关闭——导入卡住根因定位为 tauri#14994（wry MainPipe 唤醒），`select_epub_sources` 增加 200ms 唤醒窗口 workaround；导入链路加 `[EPUB-IMPORT]` 可观测日志（Rust eprintln + Kotlin Log.d）；黑鲨 30 轮循环导入/删除无卡住。
- 2026-08-14：B1 收尾审计与测试补齐完成（TODO 1.50/1.51/2.58/2.59 关闭，B1 完成证明签发）：① `save_book_image` 审计——修复 `sanitize_source_error` 用 `split_once(':')` 会把 Windows 盘符（如 `C:\...`）当作错误前缀的缺陷，改为已知前缀白名单（BOOK_SOURCE_UNAVAILABLE / BOOK_RESOURCE_LIMIT_EXCEEDED / INTERNAL_ERROR）+ 3 个测试；② SAF 纯逻辑抽至 `platform/mod.rs`（picker 响应转换 + content:// 前缀与非空 authority 校验），桌面构建新增 9 个 SAF 测试与 3 个桌面 `validate_selected_source` 测试；③ 仓储审计——`delete_book` 的 SELECT+DELETE 两步竞态窗口以 BEGIN IMMEDIATE 单事务闭合；services 层 41 处 rusqlite 原始错误透传（`: {error}`）全部移除，错误消息只保留稳定前缀；④ 系列/标签/设置/批注新增 12 个并发创建、失败保留、事务回滚释放、删除级联与稳定错误测试（并发测试验证无死锁与行数守恒，不做强线性一致声明）。全部新测试 10 组变红自证（注入→目标断言变红→恢复→变绿）通过；`cargo test` 108/108、`cargo fmt --check` 干净、`cargo check` 通过；`audit:unwrap` 自动统计 273 行/280 次（全部位于测试模块）。
- 2026-08-15：新增 Android 体积与缓存探查记录，并将治理任务纳入 B2、冻结门禁纳入 B3。只记录 debug 制品和设备分项事实；由于 arm64 release 构建受 Tauri 插件生成缓存目录冲突阻塞，未签发 release 体积完成证明。IPC 未新增缓存 Command，避免在设计前注册 stub。
