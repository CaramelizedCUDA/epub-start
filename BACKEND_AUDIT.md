# 后端审计与健康基线（B0 交付物）

审计日期：2026-08-14。审计对象：`src-tauri/`（生产代码、测试、迁移、协议、平台适配），以及 [IPC.md](IPC.md)、`src/types/ipc.ts`、`src/lib/tauri.ts` 的契约一致性。

本文件是 B0 阶段的验收产出，四个状态定义如下（与 [TODO.md](TODO.md) 0.3 一致）：

- **已实现**：代码真实存在且可定位。
- **已自动验证**：存在自动化测试/构建命令且本次审计中实际执行通过。
- **已桌面运行态验证**：在 Windows 桌面运行态人工验收过（历史记录）。
- **受 Android 环境阻塞**：代码存在，但缺少 SDK/NDK/设备环境，无法构建或实机验证。

## 0.1 基线验证

### 发布构建（本次审计完成）

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `npm.cmd run tauri build`（第一次） | 通过 | 2026-08-14 11:48 产出 `EpubStart_0.1.0_x64_en-US.msi`（5.20 MB）与 `EpubStart_0.1.0_x64-setup.exe`（3.01 MB）；exe 11.65 MB |
| `npm.cmd run tauri build`（第二次，验证可重复性） | 通过，exit 0 | 2026-08-14 11:53 同一产物路径二次产出，`EXIT=0` |
| 锁文件 | 存在 | `src-tauri/Cargo.lock`（2026-07-21）、`package-lock.json`（2026-07-18）；构建期间无依赖漂移 |

环境阻塞记录（与项目代码无关，仅供复现参考）：本会话沙箱在受限模式下禁止 esbuild/cargo 派生子进程（spawn EPERM），需要在提权模式下运行构建；用户侧正常环境不受影响。PowerShell 的 `2>&1` 会把 npm 的 stderr `Info` 行包装成 NativeCommandError 噪音，第二次用 `cmd /c` 重定向验证 exit code 为 0，构建本身无错误。

### 自动化测试（本次审计执行）

- `cargo test`：67/67 通过，exit 0（2026-08-14；65 个既有测试 + 本次审计新增 2 个迁移失败回滚测试）。
- `cargo fmt --check`：通过（2026-08-14，含新增测试代码，无格式差异）。

### Android 环境（受外部阻塞，状态：受 Android 环境阻塞）

- ANDROID_HOME / ANDROID_SDK_ROOT / ANDROID_NDK_HOME 未设置；标准 SDK 路径（`%LOCALAPPDATA%\Android\Sdk` 等）不存在。
- `adb` 不在 PATH；JAVA_HOME 指向 `C:\Program Files\Android\Android Studio\jbr` 但该目录不存在；Android Studio 未安装。
- Rust Android target 未安装（仅 `x86_64-pc-windows-msvc`）。
- 无模拟器、无真实设备连接。
- 固定 EPUB 样本已就绪：`这里是终末停滞委员会/`（01–05、6（x）=.epub、外传）与 `epub/6.epub` 共 8 本，已在本工作区。
- Kotlin 插件源码存在：`src-tauri/gen/android/app/src/main/java/com/epubstart/reader/EpubSafPlugin.kt`，静态审查通过（见 0.2.6），但工程构建需要 SDK/NDK。

**负责人**：用户本人（需提供 Android SDK/NDK 与设备环境）。
**所缺资源**：Android SDK、NDK、JDK（或 Android Studio）、`aarch64-linux-android` 等 Rust target、一台真实设备。
**下一次复核条件**：环境就绪后执行 `tauri android init`（保留 EpubSafPlugin.kt 不被覆盖）与 `tauri android build`，并在 B1 首次实机门禁前完成 SAF 选择/持久权限/重启/撤销/重新定位/私有缓存/FD 生命周期/协议资源读取验证。

## 0.2 生产代码健康审计

### 0.2.1 panic/unwrap/expect 与锁生命周期 — 通过

- `panic!`、`todo!`、`unimplemented!`、`unreachable!`：生产代码 0 处（grep 全量确认）。
- `.unwrap()`：按“包含调用的源码行”统计为 205 行（共 212 次调用），全部位于 `#[cfg(test)]` 测试模块内，无一处出现在生产路径。测试中的 unwrap 按 TODO 规则允许保留。
- `.expect()`：生产代码仅 1 处，`lib.rs:93` 的 `.run(tauri::generate_context!()).expect("error while running tauri application")`。这是 Tauri 事件循环的标准启动收口；`setup` 闭包内的目录/数据库/迁移错误均已用 `map_err` + `?` 转成可诊断错误。风险等级：低。修复任务：可选，B1 前保留现状即可。
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

### 0.2.5 数据库迁移清单 — 通过（补 V1/V3 回滚测试后）

| 迁移 | 内容 | 幂等 | 失败回滚 | 测试 |
| --- | --- | --- | --- | --- |
| V1 | books/reading_progress/notes + 4 索引 | 版本表 `_migrations` 门控 | BEGIN IMMEDIATE…COMMIT/ROLLBACK | 建表、升级保留数据、索引、幂等、**本次补失败回滚测试** |
| V2 | source_cache_entries/series/标签/设置/search_documents + FTS5 trigram/search_index_state + notes.cfi_range | 同上 | 同上 | 冲突回滚、级联删除 |
| V3 | 阅读设置新字段 + 数据转换 + 表重建 | 同上 | 同上 | 旧值转换、默认值、**本次补失败回滚测试** |

- 外键级联：`PRAGMA foreign_keys = ON` 在迁移入口开启；`test_v2_cascade_removes_all_book_owned_rows` 覆盖 books 删除后 8 张子表级联清空，系列/标签定义保留。
- FTS5 trigram 虚拟表已在 V2 建立（仅 Schema），索引逻辑按 TODO B2 交付，无假进度。
- 本次审计新增 `test_v1_failure_rolls_back_every_v1_object` 与 `test_v3_failure_rolls_back_every_v3_object`，使 V1/V2/V3 三层失败回滚均有自动化测试。验证命令：`cd src-tauri && cargo test db::migrations`。

### 0.2.6 安全边界清单 — 通过，1 个计划内缺口

| 边界 | 实现位置 | 状态 |
| --- | --- | --- |
| 来源校验 | `platform/desktop.rs`（绝对路径+存在+可读+扩展名）、`platform/android.rs`（content:// 校验 + 插件持久权限复核） | 已实现/已自动验证（桌面）/受 Android 环境阻塞 |
| Reader 租约 | `source/reader.rs` + `source/cache.rs`：SourceLease + Arc 守护；桌面直读文件、Android 私有缓存原子复制 + 指纹复核 | 已实现/已自动验证（桌面）/受 Android 环境阻塞 |
| ZIP 预算 | `formats/epub/mod.rs`：5000 条目、2 MiB 控制文件、50 MiB 单条目、2 GiB 总解压、200:1 压缩比、`checked_add` 溢出检查、`take()` 包装 | 已实现/已自动验证（压缩比与超限测试） |
| 协议路径 | `services/format_service.rs::normalize_entry_path`：拒绝 `..`、`\`、`/` 开头、空段；Components 规范化二次检查 | 已实现/已自动验证 |
| MIME | `formats/epub/mod.rs::mime_for_path` 扩展名白名单；响应带 `X-Content-Type-Options: nosniff` | 已实现/已自动验证 |
| Range | **未实现**；TODO B1 任务（补齐 Range 与并发 Reader 测试） | 计划内缺口，风险等级：低 |
| CORS | `protocol/mod.rs::allowed_cors_origin` 白名单（开发源 + Tauri 源 + opaque null），外部源不反射 | 已实现/已自动验证 |
| 错误脱敏 | `protocol/mod.rs::sanitize_source_error` 只保留前缀；`image_service` 同样脱敏；前端 mapError 兜底 | 已实现/已自动验证 |
| 单条目图片导出 | `services/image_service.rs`：仅 `image/*` MIME、文件名清洗、桌面保存对话框、Android 明确返回 `FORMAT_NOT_SUPPORTED:` | 已实现；MIME、文件名清洗和来源错误脱敏已自动验证；桌面保存对话框与实际写入为 2026-07-24 历史运行态验收；Android 导出受环境与 `ACTION_CREATE_DOCUMENT` 缺失阻塞 |
| Android 权限 | `EpubSafPlugin.kt`：takePersistableUriPermission 成功后才返回 URI；inspectUri/openReadFd 每次复核 persistedUriPermissions；releasePermission 释放授权 | 已实现（静态审查通过）/受 Android 环境阻塞 |

## 0.3 B0 完成标准

1. 本文件即审计结果，缺口清单见下。
2. 四种状态已在各节标注。
3. 文档一致性核对：
   - README/ROADMAP/TODO/CONVENTIONS/ARCHITECTURE/DATABASE/SECURITY 与实现一致（本审计逐项核对，未发现冲突）。
   - [IPC.md](IPC.md) 补上 `BOOK_RESOURCE_NOT_FOUND:` 前缀行（与 Rust、协议层、tauri.ts 已有实现对齐）——本次审计中已修复。

## 缺口清单

| # | 缺口 | 文件位置 | 风险 | 修复任务 | 验证命令 |
| --- | --- | --- | --- | --- | --- |
| 1 | 进度保存的业务校验/时间戳/回查在 Command 内 | `src-tauri/src/commands/save_reading_progress.rs` | 低 | 下沉到 `services/`（如 library_service 进度用例），Command 保持薄适配 | `cargo test` |
| 2 | 两个只读 Command 直连 repository，绕过 services 层 | `commands/get_reading_progress.rs`、`commands/list_books.rs` | 低 | 经 services 编排（或文档化例外） | `cargo test` |
| 3 | 51 处小写 `internal error:` 前缀 | 多个 services/commands 文件 | 低 | 统一为 `INTERNAL_ERROR:`（B1 任务「为所有公开 Command 固定稳定错误前缀」） | `cargo test` + grep 复核 |
| 4 | `epub://` 协议无 Range 支持 | `src-tauri/src/protocol/mod.rs` | 低 | TODO B1 补齐 Range 与并发 Reader 测试 | `cargo test` |
| 5 | lib.rs 事件循环 `expect` | `src-tauri/src/lib.rs:93` | 低 | 可选：保持 Tauri 惯例 | `cargo check` |
| 6 | Android SDK/NDK/设备环境缺失 | 环境（非代码） | 外部阻塞 | 见 0.1「Android 环境」节 | 环境就绪后 `tauri android build` |

## 修复记录

- 2026-08-14：`src-tauri/src/db/migrations.rs` 新增 V1/V3 失败回滚测试。
- 2026-08-14：[IPC.md](IPC.md) 错误契约表新增 `BOOK_RESOURCE_NOT_FOUND:` 行。
