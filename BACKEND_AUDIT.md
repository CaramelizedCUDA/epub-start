# 后端审计与健康基线（B0 交付物）

审计日期：2026-08-14。审计对象：`src-tauri/`（生产代码、测试、迁移、协议、平台适配），以及 [IPC.md](IPC.md)、`src/types/ipc.ts`、`src/lib/tauri.ts` 的契约一致性。

本文件是 B0 阶段的审计产出。2026-08-14 复核时撤回了原“B0 完成”证明；下列状态用于避免把代码存在、命令为绿和人工探查混为一谈：

- **已实现**：代码真实存在且可定位。
- **辅助逻辑（静态/单元）**：可由审查或自动化命令覆盖；必须同时写明已测与未测范围。
- **桌面端**：需要 Windows/Linux 人工运行态证据；历史记录不自动升级为本次验证。
- **Android 环境**：SDK/NDK/targets/设备已具备；后端/平台代码链、干净构建或来源导入未通过时标记为阻塞。

## 0.1 基线验证

### 发布构建（本次审计完成）

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `npm.cmd run tauri build`（第一次） | 通过 | 2026-08-14 11:48 产出 `EpubStart_0.1.0_x64_en-US.msi`（5.20 MB）与 `EpubStart_0.1.0_x64-setup.exe`（3.01 MB）；exe 11.65 MB |
| `npm.cmd run tauri build`（第二次，验证可重复性） | 通过，exit 0 | 2026-08-14 11:53 同一产物路径二次产出，`EXIT=0` |
| 锁文件 | 存在 | `src-tauri/Cargo.lock`（2026-07-21）、`package-lock.json`（2026-07-18）；构建期间无依赖漂移 |

环境阻塞记录（与项目代码无关，仅供复现参考）：本会话沙箱在受限模式下禁止 esbuild/cargo 派生子进程（spawn EPERM），需要在提权模式下运行构建；用户侧正常环境不受影响。PowerShell 的 `2>&1` 会把 npm 的 stderr `Info` 行包装成 NativeCommandError 噪音，第二次用 `cmd /c` 重定向验证 exit code 为 0，构建本身无错误。

### 自动化命令（执行事实，不等于所有测试已自证）

- `cargo test`：当前 67/67 通过，exit 0（2026-08-14；65 个既有测试 + 2 个新增迁移失败回滚测试）。已测：当前代码下完整 Rust 测试套件为绿色。未测：新增 V1/V3 回滚测试没有留存“故意注入缺陷→目标测试变红→恢复→变绿”的自证，因此不能据此标记为“已验证/已覆盖”。
- `cargo fmt --check`：通过（2026-08-14，含新增测试代码，无格式差异）。

### Android 环境（环境已具备，代码链仍阻塞）

- 已具备 JDK 17、Android SDK/NDK、四个 Rust Android targets、荣耀 PPG-AN00（Android 15）和黑鲨 SKW-A0（Android 9）；固定 EPUB 样本共 8 本。
- `cargo check --target aarch64-linux-android` 在显式设置 NDK 编译器后通过，证明 Rust 目标可编译；未证明完整 Tauri Android 工程可干净复现。
- 官方 `npm.cmd run tauri -- android build --debug --target aarch64` 当前失败于 `android\.tauri\tauri-api` 目录冲突（Windows os error 183）。现有 `gen/android` 含未跟踪 scaffold、构建产物及本地 BuildTask 绕过，不能整体入库或作为可重复构建证据。
- 双机已有后端/平台初步探查，协议处理器可返回资源、状态码和 MIME；导入仍存在间歇性卡住。legacy 前端/WebView 如何消费资源 URL 属于前端集成范围，不参与 B0 后端完成判定。

**下一次复核条件**：用干净生成且已审查的 Android scaffold 通过官方构建；保留项目自有 `EpubSafPlugin.kt`；定位导入卡住后，在双机直接验证 Rust/插件的 SAF 选择、重启、撤销、重新定位、缓存、FD 生命周期以及协议状态码/MIME/CORS/路径防护。

## 0.2 生产代码健康审计

### 0.2.1 panic/unwrap/expect 与锁生命周期 — 通过

- `panic!`、`todo!`、`unimplemented!`、`unreachable!`：生产代码 0 处（grep 全量确认）。
- `.unwrap()`：`npm run audit:unwrap` 只扫描 `src-tauri/src`，按“包含调用的源码行”自动统计为 202 行（共 209 次调用），全部位于 `#[cfg(test)]` 测试模块内，无一处出现在生产路径；不再把 `src-tauri/target` 生成代码计入结果。
- `.expect()`：生产代码仅 1 处，`lib.rs:94` 的 `.run(tauri::generate_context!()).expect("error while running tauri application")`。这是 Tauri 事件循环的标准启动收口；`setup` 闭包内的目录/数据库/迁移错误均已用 `map_err` + `?` 转成可诊断错误。风险等级：低。修复任务：可选，B1 前保留现状即可。
- 安全 unwrap 变体（`unwrap_or`/`unwrap_or_else`/`unwrap_or_default`）：43 处，均为带默认值的非 panic 形式，合格。
- 锁与生命周期：`AppState.db: Mutex<Connection>`，服务层统一经 `lock_db` 辅助函数获取并把 poisoning 映射为错误；`source/cache.rs` 的 `active: Mutex<HashMap<String, Weak<()>>>` 同样映射 poisoning，租约由 `Arc<()>` 守护。未发现手动 `spawn` 线程或生命周期漏洞。
- 忽略错误（`let _ =`）14 处：均为 best-effort 清理（迁移 ROLLBACK 失败、缓存文件删除、SAF 权限释放、封面清理），语义合理，不需要处理。

### 0.2.2 Command 薄适配审计 — 基本通过，3 个缺口

36 个 Command 中绝大多数只做参数解析 + 服务调用 + 错误转换。缺口如下（均记录修复任务，见「缺口清单」）：

1. `commands/save_reading_progress.rs`：progression 范围校验、unix 时间戳、upsert 后回查都在 Command 内，属于业务逻辑留在 Command。风险等级：低。
2. `commands/get_reading_progress.rs` 与 `commands/list_books.rs`：直接调用 `db::repository` 并自行锁库，绕过 `services/` 编排层，与其余 Command 分层不一致。风险等级：低。
3. 错误前缀不一致：生产代码存在 51 处小写 `internal error:`，与 [IPC.md](IPC.md) 规定的稳定前缀 `INTERNAL_ERROR:` 不符。前端 `mapError` 会把未知前缀兜底为通用 INTERNAL_ERROR，因此不会泄漏细节，但契约要求稳定前缀。风险等级：低。

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

### 0.2.5 数据库迁移清单 — 实现存在，V1/V3 测试自证待补

| 迁移 | 内容 | 幂等 | 失败回滚 | 测试 |
| --- | --- | --- | --- | --- |
| V1 | books/reading_progress/notes + 4 索引 | 版本表 `_migrations` 门控 | BEGIN IMMEDIATE…COMMIT/ROLLBACK | 建表、升级保留数据、索引、幂等；回滚测试代码存在但未做变红自证 |
| V2 | source_cache_entries/series/标签/设置/search_documents + FTS5 trigram/search_index_state + notes.cfi_range | 同上 | 同上 | 冲突回滚、级联删除 |
| V3 | 阅读设置新字段 + 数据转换 + 表重建 | 同上 | 同上 | 旧值转换、默认值；回滚测试代码存在但未做变红自证 |

- 外键级联：`PRAGMA foreign_keys = ON` 在迁移入口开启；`test_v2_cascade_removes_all_book_owned_rows` 覆盖 books 删除后 8 张子表级联清空，系列/标签定义保留。
- FTS5 trigram 虚拟表已在 V2 建立（仅 Schema），索引逻辑按 TODO B2 交付，无假进度。
- `test_v1_failure_rolls_back_every_v1_object` 与 `test_v3_failure_rolls_back_every_v3_object` 当前运行为绿，但没有变红验证记录，完成证明已撤回。接手方向：分别在 V1/V3 的目标失败步骤故意注入会破坏事务回滚的缺陷，确认对应测试确实失败且失败发生在目标步骤；随后恢复实现，执行 `cargo test db::migrations` 与完整 `cargo test` 并记录结果。

### 0.2.6 安全边界清单 — 辅助逻辑有覆盖，运行态仍有缺口

| 边界 | 实现位置 | 状态 |
| --- | --- | --- |
| 来源校验 | `platform/desktop.rs`（绝对路径+存在+可读+扩展名）、`platform/android.rs`（content:// 校验 + 插件持久权限复核） | 辅助逻辑：桌面单元测试与 Android 静态审查；未测：自动化 Android Provider/撤销链；设备仅有初步探查 |
| Reader 租约 | `source/reader.rs` + `source/cache.rs`：SourceLease + Arc 守护；桌面直读文件、Android 私有缓存原子复制 + 指纹复核 | 辅助逻辑：桌面 Reader/缓存测试；未测：Android 自动化 FD/缓存恢复；设备仅有抽样计数 |
| ZIP 预算 | `formats/epub/mod.rs`：5000 条目、2 MiB 控制文件、50 MiB 单条目、2 GiB 总解压、200:1 压缩比、`checked_add` 溢出检查、`take()` 包装 | 辅助逻辑已测压缩比与超限；未测真实设备低存储/大文件运行态 |
| 协议路径 | `services/format_service.rs::normalize_entry_path`：拒绝 `..`、`\`、`/` 开头、空段；Components 规范化二次检查 | 辅助逻辑已测路径规范化；Android 后端路由有初步设备探查；前端消费方式不在本审计范围 |
| MIME | `formats/epub/mod.rs::mime_for_path` 扩展名白名单；响应带 `X-Content-Type-Options: nosniff` | 辅助逻辑已测扩展名映射；Android 后端响应有初步设备探查；WebView 渲染不在本审计范围 |
| Range | **未实现**；TODO B1 任务（补齐 Range 与并发 Reader 测试） | 计划内缺口，风险等级：低 |
| CORS | `protocol/mod.rs::allowed_cors_origin` 白名单（开发源 + Tauri 源 + opaque null），外部源不反射 | 辅助逻辑已测白名单；未测各 Android WebView 版本的真实 Origin 行为 |
| 错误脱敏 | `protocol/mod.rs::sanitize_source_error` 只保留前缀；`image_service` 同样脱敏；前端 mapError 兜底 | 辅助逻辑已测稳定前缀；未测所有设备/Provider 错误文本 |
| 单条目图片导出 | `services/image_service.rs`：仅 `image/*` MIME、文件名清洗、桌面保存对话框、Android 明确返回 `FORMAT_NOT_SUPPORTED:` | 辅助逻辑已测 MIME、文件名和来源错误脱敏；桌面写入仅有历史人工记录；Android 仅观察到未支持错误，未实现 SAF 写入 |
| Android 权限 | `EpubSafPlugin.kt`：takePersistableUriPermission 成功后才返回 URI；inspectUri/openReadFd 每次复核 persistedUriPermissions；releasePermission 释放授权 | 静态实现存在并有设备探查；未有自动化覆盖，且稳定导入未通过 |

## 0.3 B0 完成标准（未满足）

1. 审计结果与缺口清单已经形成，IPC.md 的 `BOOK_RESOURCE_NOT_FOUND:` 文档缺口已经修复。
2. 已按辅助逻辑、桌面端、Android 环境三类重写证据口径，并同步 README/ROADMAP/TODO/SECURITY。
3. B0 未满足项：V1/V3 回滚测试缺少变红自证；Android Kotlin/Rust 平台工程不能用官方命令从干净、已审查的 scaffold 稳定构建。Android 稳定导入是 B1 运行态缺口；前端/WebView 资源请求方式不参与 B0 判定。

## 0.4 Android 初步实机探查（2026-08-14，不等于门禁通过）

### 环境与设备

- 工具链（命令行轻量方案，`D:\Android\Sdk`）：Temurin JDK 17.0.20（`D:\Android\jdk17`）、cmdline-tools 15859902、platform-tools 37.0.1、platforms;android-35、build-tools;35.0.0、NDK 27.3.13750724；用户级 `JAVA_HOME`/`ANDROID_HOME`/`NDK_HOME`/`PATH` 已设置。
- Rust Android targets 已装：aarch64/armv7/i686/x86_64-linux-android。
- `gen/android` 曾经 `tauri android init --ci` 生成，项目自有 `EpubSafPlugin.kt` 已保留；但其余 scaffold 当前包含未跟踪文件、构建产物和本地绕过，尚未审查入库边界。
- 设备 1：荣耀 PPG-AN00（Android 15/API 35，arm64，WebView 150.0.7871.181），无线调试接入。
- 设备 2：黑鲨 SKW-A0（Android 9/API 28，arm64，WebView 79.0.3945.116），USB 接入。
- 曾通过本地绕过链产出 debug arm64 APK；这不构成官方构建可重复证据。

### 探查矩阵与证据边界

| 项 | 内容 | 结果 |
| --- | --- | --- |
| A | 启动/崩溃 | 本地 APK 在双机可启动/重启，观察到数据库与缓存目录；未验证干净官方构建产物 |
| B1 | SAF 选择 | 双机人工选择并产生 `android_content_uri` 记录；导入仍会间歇性卡住，不能标记稳定通过 |
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
3. **导入卡住（未修复）**：任意书均可能间歇性触发，杀后台重启后重导只是规避手段。接手 Agent 应用黑鲨 logcat/可观测日志定位 picker 回调、Rust command、FD 读取或缓存阶段的停点。
4. **范围说明**：曾观察到 Android WebView 对某种前端 `fetch(epub://...)` 用法不兼容；这是 legacy 前端集成问题，不作为 B0 后端或 B1 后端处理器是否正常的判据，留待 F 阶段处理。

### 构建与 scaffold 入库边界

- 官方 Android 构建当前失败于 `.tauri/tauri-api` 目录冲突；必须在干净生成工程上修复并重跑，不能提交“已有 `.so` 就跳过 Rust 构建”的 `BuildTask.kt` 本地绕过，因为它可能静默打包过期 native 库。
- 当前不要整体 `git add src-tauri/gen/android`。禁止入库 `app/src/main/assets/`、`.so`、`build/`、`.gradle/`、`local.properties`、生成 schema 副本和本地绕过。Android scaffold 应后续干净再生成、审查并独立提交；已跟踪的 `EpubSafPlugin.kt` 必须保留。

## 缺口清单

| # | 缺口 | 文件位置 | 风险 | 修复任务 | 验证命令 |
| --- | --- | --- | --- | --- | --- |
| 1 | 进度保存的业务校验/时间戳/回查在 Command 内 | `src-tauri/src/commands/save_reading_progress.rs` | 低 | 下沉到 `services/`（如 library_service 进度用例），Command 保持薄适配 | `cargo test` |
| 2 | 两个只读 Command 直连 repository，绕过 services 层 | `commands/get_reading_progress.rs`、`commands/list_books.rs` | 低 | 经 services 编排（或文档化例外） | `cargo test` |
| 3 | 51 处小写 `internal error:` 前缀 | 多个 services/commands 文件 | 低 | 统一为 `INTERNAL_ERROR:`（B1 任务「为所有公开 Command 固定稳定错误前缀」） | `cargo test` + grep 复核 |
| 4 | `epub://` 协议无 Range 支持 | `src-tauri/src/protocol/mod.rs` | 低 | TODO B1 补齐 Range 与并发 Reader 测试 | `cargo test` |
| 5 | lib.rs 事件循环 `expect` | `src-tauri/src/lib.rs:94` | 低 | 可选：保持 Tauri 惯例 | `cargo check` |
| 6 | Android 官方构建不可从干净 scaffold 复现 | `src-tauri/gen/android`、Tauri Android 生成/构建链 | 高/阻塞 B0 完成证明 | 干净生成并审查 scaffold；保留自有插件；移除 BuildTask 本地绕过与构建产物；修复 `.tauri/tauri-api` 冲突后用官方命令构建 | `npm.cmd run tauri -- android build --debug --target aarch64` |
| 7 | Android 导入偶发卡住 | `platform/android.rs`、SAF 插件/来源缓存链 | 高/阻塞 B1 实机门禁 | 用可观测日志定位 picker 回调、Command、FD 读取或缓存阶段停点；双机重复导入并验证重启/撤销/缓存/FD | 双机后端/平台验收 |
| 8 | V1/V3 回滚测试缺少变红自证 | `src-tauri/src/db/migrations.rs` | 中/阻塞 B0 完成证明 | 在目标迁移步骤故意注入破坏事务回滚的缺陷，确认目标测试变红，再恢复为绿并记录命令/结果 | `cargo test db::migrations` + `cargo test` |

## 修复记录

- 2026-08-14：`src-tauri/src/db/migrations.rs` 新增 V1/V3 失败回滚测试；2026-08-14 复核时因缺少变红自证撤回“已验证”结论，测试代码保留等待补证。
- 2026-08-14：[IPC.md](IPC.md) 错误契约表新增 `BOOK_RESOURCE_NOT_FOUND:` 行。
- 2026-08-14：`src-tauri/src/lib.rs` 补 `#[cfg_attr(mobile, tauri::mobile_entry_point)]`（Android JNI glue 缺失，P0，见 0.4）。
- 2026-08-14：`vite.config.ts` 保留 `build.target="es2019"`；删除不必要且依赖未声明 `esbuild` 的 postbuild 二次转换。
- 2026-08-14：修复 `scripts/audit-unwrap.mjs` 仅扫描 `src-tauri/src`，排除 `target` 生成代码；BACKEND_AUDIT/TODO 自动同步为 202 行/209 次。
- 2026-08-14：删除误提交的 `.tmp_probe_ports.js`、`.tmp_sqlite_dump.js`，并用 `.gitignore` 的 `.tmp_*` 防止同类前缀临时脚本再次入库。
- 2026-08-14：撤回 B0 完成证明（V1/V3 迁移测试缺少变红证据、Android 官方干净构建未通过）与 B1 Android 后端/平台完成证明（稳定导入待完成）；前端 `fetch` 行为明确移出 B0 判定。
