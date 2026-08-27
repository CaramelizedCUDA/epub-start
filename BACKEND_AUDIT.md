# 后端审计与健康基线（B0 交付物）

审计日期：2026-08-14（B0 基线）；B4 追加复核：2026-08-28。审计对象：`src-tauri/`（生产代码、测试、迁移、协议、平台适配），以及 [IPC.md](IPC.md)、`src/types/ipc.ts`、`src/lib/tauri.ts` 的契约一致性。

本文件是 B0 阶段的审计产出。2026-08-14 复核时曾撤回原“B0 完成”证明，随后在 V1/V3 变红自证与 Android 干净构建补齐后重新签发；B1 也已完成。下列状态仍用于避免把代码存在、命令为绿和人工探查混为一谈：

- **已实现**：代码真实存在且可定位。
- **辅助逻辑（静态/单元）**：可由审查或自动化命令覆盖；必须同时写明已测与未测范围。
- **桌面端**：需要 Windows/Linux 人工运行态证据；历史记录不自动升级为本次验证。
- **Android 环境**：SDK/NDK/targets/设备已具备；B1 双机运行态记录与受控 AVD 证据分开保留，不能由桌面测试代替。受控 AVD 已补齐活动读者、来源 hard-limit、WebView、复制中断/重试、ENOSPC、SQLite 低余量、六轮固定样本压力和 4 本书/2 个系列的保存型业务与可重建缓存恢复；封面 hard-limit 的公共保护重叠分支仍只保留辅助逻辑证据。真实黑鲨 Android 9 的取消、进程终止与重建记录直接接受，更广 OEM/真实设备矩阵移至 B3/F2。

## 0.1 基线验证

### 发布构建（本次审计完成）

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `npm.cmd run tauri build`（第一次） | 通过 | 2026-08-14 11:48 产出 `EpubStart_0.1.0_x64_en-US.msi`（5.20 MB）与 `EpubStart_0.1.0_x64-setup.exe`（3.01 MB）；exe 11.65 MB |
| `npm.cmd run tauri build`（第二次，验证可重复性） | 通过，exit 0 | 2026-08-14 11:53 同一产物路径二次产出，`EXIT=0` |
| 锁文件 | 存在 | `src-tauri/Cargo.lock`（2026-07-21）、`package-lock.json`（2026-07-18）；构建期间无依赖漂移 |

环境阻塞记录（与项目代码无关，仅供复现参考）：本会话沙箱在受限模式下禁止 esbuild/cargo 派生子进程（spawn EPERM），需要在提权模式下运行构建；用户侧正常环境不受影响。PowerShell 的 `2>&1` 会把 npm 的 stderr `Info` 行包装成 NativeCommandError 噪音，第二次用 `cmd /c` 重定向验证 exit code 为 0，构建本身无错误。

### 自动化命令（执行事实与覆盖边界）

- `cargo test`：2026-08-24 当前提交重新执行 181/181 通过，exit 0；既有新增测试的目标变红→恢复变绿证据仍见各专项记录，本轮没有新增测试。已测：B1/B2 搜索、目录资源、系列、标签、阅读设置/迁移、批注，以及来源缓存持久 LRU/活动租约/软硬上限/重启协调、原子写入失败清理、租约与淘汰竞态，封面原子候选/并发预算/元数据一致性/软硬上限，统一 896 MiB 硬预算和 SQLite/文件系统存储耗尽稳定映射。未测：F2 的新前端消费、所有 WebView/OEM 版本、多进程/多连接数据库并发、宿主真实磁盘写满、断电、唯一物理 2 GiB 写入、封面公共保护重叠 hard-limit 和更广 OEM/真实设备矩阵；Android 受控 AVD 已另有运行态证据，不由单元测试替代。
- 2026-08-24 当前提交的 `cargo fmt --check`、`cargo check`、`npm.cmd run build`、`npm.cmd run audit:check`、`npm.cmd run audit:android-release` 与 Windows x64 `npm.cmd run tauri build` 均通过，unwrap 统计仍为 575 行/590 次。当前 arm64 APK/AAB 静态候选重新生成，`:app:lintArm64Release` 为 0 error、31 warning、1 hint；APK/AAB 分别为 11,960,465/11,769,321 B，相对基线增长 3.49%/3.55%，ABI/ELF/禁止载荷门禁通过。随后在黑鲨 SKW-A0 与荣耀 PPG-AN00 上完成同一 release payload 的卸载后空白安装、`primaryCpuAbi=arm64-v8a`、首次启动、WebView 和主进程内存复测；固定样本运行时占用、release 私有 data 精确字节分项和正式 release 签名仍未验证。详见 [B3_ANDROID_RELEASE_CANDIDATE.md](B3_ANDROID_RELEASE_CANDIDATE.md)。

### Android 环境（B1 首次门禁已完成）

- 已具备 JDK 17、Android SDK/NDK、四个 Rust Android targets、荣耀 PPG-AN00（Android 15）和黑鲨 SKW-A0（Android 9）；固定 EPUB 样本共 8 本。
- `cargo check --target aarch64-linux-android` 在显式设置 NDK 编译器后通过，证明 Rust 目标可编译；未证明完整 Tauri Android 工程可干净复现。
- 官方 `npm.cmd run tauri -- android build --debug --target aarch64` 已在干净 scaffold 上通过（2026-08-14，exit 0，产出 debug APK 与 AAB；`gen/android` 删除后重新 `tauri android init --ci` 生成、`EpubSafPlugin.kt` 放回、无任何本地构建绕过）。
- 双机已有后端/平台探查，协议处理器可返回资源、状态码和 MIME；导入卡住已通过 Tauri MainPipe 唤醒窗口 workaround 关闭并完成设备回归。legacy 前端/WebView 如何消费资源 URL 属于前端集成范围，不参与 B0/B1 后端完成判定。

**下一次复核条件**：干净官方构建已通过；导入卡住已修复（见 0.4）；B1 实机门禁已在双机完成（SAF 选择、重启、撤销、重新定位、缓存、FD 生命周期、协议状态码/MIME/CORS/Range/路径防护），详细证据见 0.4 探查矩阵与修复记录。

## 0.2 生产代码健康审计

### 0.2.1 panic/unwrap/expect 与锁生命周期 — 通过

- `panic!`、`todo!`、`unimplemented!`、`unreachable!`：生产代码 0 处（grep 全量确认）。
- `.unwrap()`：`npm run audit:unwrap` 只扫描 `src-tauri/src`，按“包含调用的源码行”自动统计为 672 行（共 687 次调用），全部位于 `#[cfg(test)]` 测试模块内，无一处出现在生产路径；不再把 `src-tauri/target` 生成代码计入结果。
- `.expect()`：生产代码仅 1 处，`lib.rs:106` 的 `.run(tauri::generate_context!()).expect("error while running tauri application")`。这是 Tauri 事件循环的标准启动收口；`setup` 闭包内的目录/数据库/迁移错误均已用 `map_err` + `?` 转成可诊断错误。风险等级：低。修复任务：可选，B2 保留现状即可。
- 安全 unwrap 变体（`unwrap_or`/`unwrap_or_else`/`unwrap_or_default`）均为带默认值的非 panic 形式，合格。
- 锁与生命周期：`AppState.db: Arc<Mutex<Connection>>` 由来源/封面服务共享，业务服务仍经 `lock_db` 辅助函数获取并把 poisoning 映射为错误；`source/cache.rs` 的 `active: Mutex<HashMap<String, Weak<()>>>` 同样映射 poisoning，租约由 `Arc<()>` 守护。未发现未受控线程或租约生命周期漏洞。
- `let _ =` 已逐项审查：生产路径只用于 ROLLBACK、候选/缓存文件、SAF 权限和替换封面的 best-effort 清理，或明确忽略预热失败；测试辅助项不计入生产结论。关键候选清理与事务一致性另有回归测试，不依赖无条件成功断言。

### 0.2.2 Command 薄适配审计 — 通过（3 个缺口已关闭，2026-08-14）

截至 B3 候选的 44 个 Command 全部为薄适配（参数解析 + 服务调用 + 错误转换）。原 3 个缺口均已修复；B2 新增的 5 个搜索 Command、系列关系读取 Command 以及标签读取/筛选 Command 也已接入真实服务。B4 当前 49 个 Command 的复核见 0.2.20：

1. `commands/save_reading_progress.rs`：progression 范围校验、unix 时间戳、upsert 与回查已下沉到 `services::save_reading_progress`（`services/library_service.rs`）。
2. `commands/get_reading_progress.rs` 与 `commands/list_books.rs`：已改为经 `services::get_reading_progress` / `services::list_books` 编排（统一 `lock_db` 与错误转换）。
3. 错误前缀不一致：51 处小写 `internal error:` 已全部统一为 `INTERNAL_ERROR:`（grep 复核 0 处小写残留，大写共 73 处）。

### 0.2.3 lib.rs 启动错误语义 — 通过

- `setup` 内 app_data_dir 解析、目录创建、SourceManager 创建、SQLite 打开、迁移执行全部用 `map_err` + `?` 传播为带上下文的错误；任何失败都会中止启动并显示可诊断原因，无启动期 panic 掩盖。
- 插件注册（dialog、epub_saf 平台插件）与 `epub` 协议注册为声明式注册，失败由 Tauri 框架统一报告。
- 唯一 `expect` 见 0.2.1，为事件循环收口。

### 0.2.4 Command 注册清单比对 — B3 历史 44/44 一致，历史文档缺口已修复

Rust 注册（`lib.rs` invoke_handler）44 个 Command，与 [IPC.md](IPC.md)、`src/types/ipc.ts`、`src/lib/tauri.ts` 逐一比对（B4 当前 49 个 Command 的复核见 0.2.20）：

- **命名一致**：44 个 Command 名称在 Rust/IPC.md/tauri.ts 三方完全一致，无命名漂移。
- **入参/返回一致**：ipc.ts 声明的 Args 类型覆盖所有带参 Command；`save_global_reading_settings` 的 Rust 参数为 `settings`（直接参数，非嵌套对象），tauri.ts 对应传 `{ settings }`，符合 Tauri v2 约定。
- **B2 搜索**：`ensure_series_search_index`、`get_search_index_status`、`cancel_search_index`、`search_series`、`rebuild_search_index` 已注册并调用真实服务；后台索引使用来源租约和指纹，预算超限返回稳定错误，任务在章节边界检查取消。
- **未调用**：21 个系列/标签目录 wrapper（`list_series`…`filter_books_by_tags`，含新增 `list_series_books`、`list_series_tags` 与 `filter_books_by_tags`）在后端已实现并有测试，但 legacy shell 前端未调用。这符合 B 阶段「前端冻结」策略，不视为缺陷，在 F2 接入。
- **文档缺口**：`BOOK_RESOURCE_NOT_FOUND:` 前缀在 Rust（`formats/epub/mod.rs:45`）、协议层（`protocol/mod.rs:79`）与前端 `mapError` 中均已使用，但 [IPC.md](IPC.md) 错误契约表缺少该行。本次审计已补上（见下方修复记录）。

### 0.2.5 B2 搜索与索引 — 自动化与 Android 限定范围运行态通过

- `formats/epub::extract_search_documents` 按 OPF spine 顺序读取 XHTML，受控解析相对路径、`..` 和百分号编码并拒绝越过 EPUB 根目录；单章节限制 8 MiB、单书限制 64 MiB，服务层以 `checked_add` 统计一次任务累计 2 GiB；不把整本 EPUB 读成一个 `Vec<u8>`。
- `services/search_service.rs` 使用 V2 FTS5 trigram 外部内容表，短于 3 个字符走参数化、转义通配符的 `LIKE`；索引记录来源 `SourceFingerprint`，指纹变化会重建，章节损坏会保留已提取文档并记录部分结果错误；持久化文本账面硬上限为 256 MiB，既有文本按 UTF-8 字节数统计，计数溢出和超限均返回 `BOOK_RESOURCE_LIMIT_EXCEEDED:`，超限重建回滚并保留原索引文档。
- 已注册并实现 5 个 Command：`ensure_series_search_index`、`get_search_index_status`、`cancel_search_index`、`search_series`、`rebuild_search_index`。同一系列最多一个活动任务，后台线程在章节边界检查取消；错误状态清理/FTS 重建/状态更新在单事务内完成，`SQLITE_FULL` 使用稳定资源错误且回滚保留旧索引，单任务内部错误不再扩散清空整个系列。取消、来源不可用、资源超限均不会把错误原文或宿主路径返回给前端。
- 自动化已测：spine 顺序、中日韩文本、相对/编码 href、取消、同系列任务去重、损坏章节部分结果、8 MiB 限制、短词 LIKE 与通配符字面查询、trigram 查询、结果上限、未就绪错误、进程重启状态恢复、ready/pending 聚合（含缺失状态和 ready 部分错误）、指纹失效判断、提取字节计数溢出、UTF-8 文本按字节计数、单任务 2 GiB 累计预算溢出/超限、索引预算超限稳定错误和超限回滚保留旧文档、错误状态事务失败回滚、真实 SQLite `SQLITE_FULL`/缓存存储错误映射、非满盘 SQLite I/O 保持内部错误；当前 175/175 全量测试通过。原搜索新增 5 个回归测试均按“恢复旧缺陷→目标测试变红→恢复修复→变绿”自证，本次目录/搜索契约补证见 0.2.6；SQLite 满盘使用受限 page_count 的真实写事务，缓存 OS 错误仍只构造内存错误对象，不填充设备存储。Android 当前 APK 真机复测：黑鲨 Android 9 单卷索引 34/34 并返回 trigram 摘要；七卷系列立即取消后保留 101/135 部分结果并进入 `error`；force-stop 后重启状态恢复为 `pending`（101/135），继续执行后恢复到 135/135 `ready`；系统 picker 导入 13.20 MiB EPUB 后，章节超限状态为 `ready`、0/1 且保留 `entry ... exceeds the size limit of 8388608 bytes`；一次性诊断探针调用现有 SAF `releasePermission` 后重建状态为 `error`，明细为 `BOOK_SOURCE_UNAVAILABLE: ... Persisted read permission is missing`；七卷 135/135 重建期间观测到 `epubstart.db` 11,640,832 B、峰值 rollback journal 8,309,808 B，未出现 `-wal`。补充 6 GiB AVD 另验证来源 hard-limit 稳定拒绝、活动读者在索引 `building` 中翻页 2 次并最终 `10/10 ready`、6 轮×46 固定 fixture 的逻辑累计输入 `2,352,070,068` 字节，以及 SQLite 低余量时 `search index storage is full` 的稳定错误和 rollback journal 峰值；WAL/SHM 未观察到。更广 WebView/OEM/真实设备矩阵移至 B3/F2。

### 0.2.6 B2 目录/搜索资源与错误契约 — 辅助逻辑已验证，运行态待 B3

- 当前真实格式接口为 `MetadataProvider`、`ResourceProvider`、`SearchContentProvider`；删除未实现的 `TocProvider`/`TextContentProvider` 占位接口。目录资源经 `ResourceProvider` 提供给 EPUB.js，搜索文本经 `ActiveFormat` 分派，`search_service` 不再直接依赖 `formats::epub::*`。
- 已测（辅助逻辑/自动化）：`container.xml`、OPF、NAV、NCX 的正文和 MIME；未知来源错误前缀脱敏；来源不可用/资源缺失、参数、预算、解析、不支持、内部错误的协议状态映射；EPUB 提取、LIKE 与 trigram 查询均把 `cfi` 固定为 `null`，旧索引中的伪 CFI 不再返回。变红证据：新增接口前目标测试编译失败；临时将 NCX MIME 降为通用 XML 后目标断言失败；保留旧伪 CFI 时提取/LIKE/trigram 三条断言分别失败；旧来源前缀和 500 映射分别触发目标失败。当前完整 175/175 通过。
- 未测：桌面端实际 EPUB.js 对 EPUB 2 NCX / EPUB 3 NAV 的完整运行态加载，标记为“待人工验证”；Android WebView 的同链路和版本矩阵，标记为“阻塞至 B3 设备回归”。当前只证明后端资源、分派和错误接口，不把 legacy shell 或构建通过写成目录体验完成。

### 0.2.7 B2 系列目录与关系事务 — 辅助逻辑已验证，运行态待 B3/F2

- `catalog_service` 是系列模块的公开 seam：生成 UUID/时间戳，修剪并校验名称/卷标，验证实体存在性，编排 CRUD、单系列归属、完整有序关系读取和重排；新增 `list_series_books` 已同步 Rust Command、IPC 和 TypeScript wrapper。名称的 NOCASE 唯一冲突只映射为稳定 `VALIDATION_ERROR:`，其他 SQLite 原始错误不外泄。
- 数据库语义：`book_series.book_id` 主键与单条 UPSERT 保证每书最多一个系列；列表按 `sort_order, book_id`；重排输入 ID 必须非空、唯一且属于目标系列，仓储使用 `BEGIN IMMEDIATE`，语句失败或 `COMMIT` 失败均回滚并释放；删除系列只级联关系，不删除图书。V2 Schema 足够，无新迁移。
- 已测（辅助逻辑/自动化）：CRUD、名称修剪与 `created_at` 保留、大小写不敏感重复名、缺失实体、并发创建、单系列替换、关系列表/卷标/排序、卷标修剪及 200/201 边界、重复或系列外重排拒绝、成功重排、第二条更新触发失败后的全量回滚、延迟外键导致 `COMMIT` 失败后的回滚释放、删除系列后关系清理且图书保留。新增 7 个测试和 1 个卷标强化均完成目标变红自证：缺失读取接口先编译失败；旧重复名映射返回 `INTERNAL_ERROR`；旧提交失败路径留下活动事务；临时破坏 `created_at`、卷标上限、错误分支回滚、重复 ID 与成员校验后，目标断言分别失败。恢复后系列服务 11/11、目录仓储 9/9、当前完整 175/175 通过。
- 未测：桌面 legacy shell 对系列 Command 的实际运行态消费，标记“待 B3/F2 人工验证”；Android 同链路、OEM 进程恢复和设备矩阵，标记“阻塞至 B3 设备回归”；当前应用只有单进程 `Mutex<Connection>`，不声明多进程/多连接并发语义。

### 0.2.8 B2 标签目录、继承筛选与关系事务 — 辅助逻辑已验证，运行态待 B3/F2

- `catalog_service` 是标签模块的公开 seam：统一校验和规范化标签组/标签输入，映射 NOCASE 唯一冲突，验证关系实体，读取系列标签，合并书籍直接/继承标签，并按全部所选有效标签筛选书籍。新增 `list_series_tags` 与 `filter_books_by_tags` 已同步 Rust Command、IPC 和 TypeScript wrapper；筛选返回 `BookSummary[]`，不暴露来源定位符。
- 数据库语义：`book_tags` 与 `book_series JOIN series_tags` 动态组成有效标签，直接/继承重复时读取优先直接关系；筛选使用 AND 与 `COUNT(DISTINCT tag_id)`，按 `updated_at DESC, title NOCASE, id` 稳定排序。关系替换使用 `BEGIN IMMEDIATE`，输入在写前完成非空/唯一/存在性校验；标签组删除只将标签置为未分组并保留关系，标签删除级联清理书籍/系列关系但保留图书/系列。V2 表和索引足够，无新迁移；SQLite 允许未分组标签同名的 `NULL` 唯一语义已写入 DATABASE.md。
- 已测（辅助逻辑/自动化）：标签组/标签 CRUD、名称/颜色规范化、`created_at` 保留、同组 NOCASE 冲突及跨组同名、缺失实体、系列标签读取与稳定排序、直接/继承标记和重复去重、AND 筛选、书架隐私模型与稳定排序、空/重复/缺失筛选 ID、书籍/系列关系原子替换失败保留、删除标签组后定义/关系保留、删除标签后两类关系清理且图书/系列保留。新增 4 个测试均完成变红自证：缺失两个公开接口时先编译失败；临时恢复内部错误映射、覆盖 `created_at`、删除组内标签、倒置系列标签/书籍排序、把 AND 改为任意匹配、移除空/重复/缺失 ID 校验、只删除书籍直接关系后，目标断言分别失败。恢复后 catalog 专项 24/24、完整 175/175 通过。
- 未测：桌面 legacy shell 对标签 Command 的实际运行态消费，标记“待 B3/F2 人工验证”；Android 同链路、OEM 进程恢复和设备矩阵，标记“阻塞至 B3 设备回归”；当前应用只有单进程 `Mutex<Connection>`，不声明多进程/多连接并发语义。

### 0.2.9 B2 阅读设置、字段覆盖与迁移回归 — 辅助逻辑已验证，运行态待 B3/F2

- `settings_service` 是阅读设置的公开 seam：全局设置整行保存，单书设置保存可空字段并按字段合并；`NULL` 只表示继承，清除覆盖删除单书行；服务层负责图书存在性、范围/枚举校验和 `updated_at`，Command 只做薄 IPC 适配。
- V2 的旧百分比字段经不可改写的 V3 转换为新字段；V4 只把仍保持 V2 原始默认值且 `updated_at = 0` 的未修改种子行左右边距归一为文档默认 3%，已保存旧值不被重写。V4 与 V1/V2/V3 一样使用 `BEGIN IMMEDIATE ... COMMIT/ROLLBACK`。
- 已测（辅助逻辑/自动化）：全字段默认值、全局整行保存、单书逐字段覆盖与有效值合并、全局变更后继承字段更新、清除覆盖、空覆盖清空字段、未知图书稳定错误、验证失败保留旧值、V3 全量旧字段转换、单书旧 NULL 继续继承、V4 默认值修正及提交步骤失败回滚。新增 4 个设置测试与 1 个 V4 回滚测试均完成目标变红自证：分别临时破坏一个继承字段映射与 V4 默认赋值，目标断言变红后恢复；完整 `cargo test` 175/175 通过。
- 未测：桌面 legacy shell 的设置运行态与 EPUB.js 重排消费，标记“待 B3/F2 人工验证”；Android WebView/设备矩阵与进程恢复运行态，标记“阻塞至 B3 设备回归”；真实损坏数据库、断电/满盘恢复；当前应用只有单进程 `Mutex<Connection>`，不声明多进程/多连接并发语义。

### 0.2.10 B2 批注数据契约 — 辅助逻辑已验证，运行态待 B3/F2

- `notes_service` 是批注公开 seam：创建/更新先修剪 CFI、选中文本、正文和颜色的外层空白；`cfi_start`/`cfi_end` 修剪后必须非空，空白 `cfi_range` 归一为 `NULL`。单个 CFI、`selected_text`、`content` 分别限制为 4,096、10,000、20,000 个 Unicode 字符；类似 HTML 的字符串只按字面纯文本保存，颜色规范为小写 `#RRGGBB`。更新不接受 `book_id/created_at`，并保留原值；缺失图书/批注使用稳定 `BOOK_NOT_FOUND:`/`NOTE_NOT_FOUND:`。
- 数据库语义：V1 `notes` 表保存起止 CFI、文本、颜色和审计字段，V2 仅追加可空 `cfi_range` 以兼容旧行；所有字段经参数绑定持久化。真实文件数据库关闭并重新打开后可恢复全部定位、文本、颜色和审计字段；删除图书依靠 `ON DELETE CASCADE` 清理批注。现有 V1/V2 Schema 足够，无新迁移或 Command。
- 已测（辅助逻辑/自动化）：创建/更新/读取/删除、空白规范化与空白 CFI 拒绝、字面纯文本、4096/10000/20000 Unicode 精确边界和越界、CFI 完整往返、颜色合法性/小写化、`book_id/created_at` 保留、缺失图书/批注、失败更新保留、并发创建、真实数据库重开恢复全部字段，以及删书后通过服务 seam 得到 `NOTE_NOT_FOUND:`。新增 3 个测试、强化 2 个测试，共 5 组目标变红自证：分别临时保留外层空白、把 CFI 上限收紧为 4,095、丢弃重开读取的 `cfi_range`、跳过起始 CFI 修剪、关闭外键级联；目标断言均在对应行为处失败，恢复后 notes 专项 21/21、完整 `cargo test` 175/175 通过。
- 未测：桌面 legacy shell/EPUB.js 的真实选区、创建、重绘、跳转和应用重启恢复，标记“待 B3/F2 人工验证”；Android WebView、OEM 进程恢复和设备矩阵，标记“阻塞至 B3/F2”；真实损坏数据库、断电/满盘恢复，以及多进程/多连接并发语义。

### 0.2.11 数据库迁移清单 — 通过（V1/V3/V4/V5 已补变红自证）

| 迁移 | 内容 | 幂等 | 失败回滚 | 测试 |
| --- | --- | --- | --- | --- |
| V1 | books/reading_progress/notes + 4 索引 | 版本表 `_migrations` 门控 | BEGIN IMMEDIATE…COMMIT/ROLLBACK | 建表、升级保留数据、索引、幂等；回滚测试已完成变红自证 |
| V2 | source_cache_entries/series/标签/设置/search_documents + FTS5 trigram/search_index_state + notes.cfi_range | 同上 | 同上 | 冲突回滚、级联删除 |
| V3 | 阅读设置新字段 + 数据转换 + 表重建 | 同上 | 同上 | 旧值转换、默认值；回滚测试已完成变红自证 |
| V4 | 未修改 V2 阅读设置种子行的左右边距默认值归一 | 同上 | 同上 | 默认值回归、提交步骤失败回滚；已完成变红自证 |
| V5 | 图书阅读状态、阅读活动/可见区段及历史快照 | 同上 | 同上 | 建表、旧进度补种、失败回滚、删书/删历史独立语义；已完成变红自证 |

- 外键级联：`PRAGMA foreign_keys = ON` 在迁移入口开启；`test_v2_cascade_removes_all_book_owned_rows` 覆盖 books 删除后 8 张子表级联清空，系列/标签定义保留。
- FTS5 trigram 虚拟表已在 V2 建立（仅 Schema），索引逻辑按 TODO B2 交付，无假进度。
- V5 迁移的 `test_v5_failure_rolls_back_every_v5_object` 在建表后由 `_migrations` 触发器制造后段失败，临时把失败路径改为提交后，目标断言确认 `book_reading_state` 残留并变红；恢复回滚后 V5 三项迁移测试通过。旧 `reading_progress` 补种与 V5 真实表/索引检查同样已覆盖。
- `test_v1_failure_rolls_back_every_v1_object` 与 `test_v3_failure_rolls_back_every_v3_object` 已完成变红自证（2026-08-14 补证）：将对应失败分支的 `ROLLBACK;` 临时替换为 `COMMIT;` 破坏事务回滚——V1 测试变红且失败断言为 `books was not rolled back`（证明失败发生在 V1 的 `notes` 冲突步骤之后）；V3 测试变红且失败断言为 `font_size_px` 列存在（证明失败发生在 V3 的 `global_reading_settings_v3` 冲突步骤之后）。本次 `test_v4_default_normalization_rolls_back_after_commit_step_failure` 在 V4 数据更新后用 `_migrations` 提交触发器制造目标步骤失败，确认左右边距更新回滚；恢复实现后迁移专项与完整套件通过。

### 0.2.12 安全边界清单 — 辅助逻辑有覆盖，运行态仍有缺口

| 边界 | 实现位置 | 状态 |
| --- | --- | --- |
| 来源校验 | `platform/desktop.rs`（绝对路径+存在+可读+扩展名）、`platform/android.rs`（content:// 校验 + 插件持久权限复核）、`platform/mod.rs`（共享 SAF 纯逻辑：picker 响应转换 + content:// 非空 authority 校验，2026-08-14） | 辅助逻辑：桌面 `validate_selected_source` 3 个测试 + SAF 9 个测试（均变红自证，2026-08-14）；未测：自动化 Android Provider/撤销链（Kotlin 真机行为，双机探查为准） |
| Reader 租约 | `source/reader.rs` + `source/cache.rs`：SourceLease + Arc 守护；桌面直读文件、Android 私有缓存原子复制、持久真实 LRU、256/512 MiB 与启动协调 | 辅助逻辑：`source::cache::tests` 18/18，通过租约先注册且淘汰持有同一 registry 锁直到文件删除来闭合竞态；Android 自动化 FD、真实淘汰/ENOSPC/恢复仍阻塞 |
| 封面缓存 | `CoverCache` + `formats/epub`：64/128 MiB、原子候选、旧封面保护、事务化缺失路径与孤儿清理 | 辅助逻辑：`cover_cache_service::tests` 8/8，含并发候选共享硬预算和元数据失败不先删文件；asset 命中不可观测，Android 真实满盘/重启仍阻塞 |
| ZIP 预算 | `formats/epub/mod.rs`：5000 条目、2 MiB 控制文件、50 MiB 单条目、2 GiB 总解压、200:1 压缩比、`checked_add` 溢出检查、`take()` 包装 | 辅助逻辑已测压缩比与超限；Android 已测持久 URI 的 8 MiB 章节拒绝和缓存重拷贝；未测低存储与完整大文件导入压力 |
| 协议路径 | `services/format_service.rs::normalize_entry_path`：拒绝 `..`、`\`、`/` 开头、空段；Components 规范化二次检查 | 辅助逻辑已测路径规范化；Android 后端路由有初步设备探查；前端消费方式不在本审计范围 |
| MIME | `formats/epub/mod.rs::mime_for_path` 扩展名白名单；响应带 `X-Content-Type-Options: nosniff` | 辅助逻辑已测扩展名映射；Android 后端响应有初步设备探查；WebView 渲染不在本审计范围 |
| Range | `protocol/mod.rs::serve_range`：单段 `bytes=start-end`、开放结尾、suffix、越界 416 + `Content-Range: bytes */len`、多段/非法回退全文；`Accept-Ranges: bytes` | 已实现/已自动验证（8 个单元测试 + 变红自证，2026-08-14） |
| CORS | `protocol/mod.rs::allowed_cors_origin` 白名单（开发源 + Tauri 源 + opaque null），外部源不反射 | 辅助逻辑已测白名单；未测各 Android WebView 版本的真实 Origin 行为 |
| 错误脱敏 | `protocol/mod.rs::sanitize_source_error` 只保留前缀；`image_service` 用白名单化前缀脱敏（2026-08-14 修复盘符冒号缺陷）；services 层 `INTERNAL_ERROR:` 后不再透传 rusqlite 原始错误；前端 mapError 兜底 | 辅助逻辑已测稳定前缀与状态码映射（协议层 2 个 + image_service 白名单/盘符回归 2 个，2026-08-14，均有变红自证）；未测所有设备/Provider 错误文本 |
| 单条目图片导出 | `services/image_service.rs`：仅 `image/*` MIME、文件名清洗、桌面保存对话框、Android 明确返回 `FORMAT_NOT_SUPPORTED:` | 辅助逻辑已测 MIME、文件名和来源错误脱敏；桌面写入仅有历史人工记录；Android 仅观察到未支持错误，未实现 SAF 写入 |
| Android 权限 | `EpubSafPlugin.kt`：takePersistableUriPermission 成功后才返回 URI；inspectUri/openReadFd 每次复核 persistedUriPermissions；releasePermission 释放授权 | 静态实现存在且 B1 双机门禁已通过；未有自动化 Provider/Activity 覆盖，长期压力与低存储仍待 B2/B3 |

### 0.2.13 B2 Android 制品与缓存收口 — 实现/辅助逻辑和完整 lint 通过，Android 存储运行态部分开放

- **构建冲突与角色**：`tauri-plugin-dialog` 改为非 Android target 依赖，dialog Capability 拆为 desktop-only；Android 根工程把位于工程外的 Tauri 子项目 build 目录重定向到自己的 build 树，原 `.tauri/tauri-api` `os error 183` 冲突消失；NDK 固定 27.3.13750724。新增 profile：继承 release 依赖并使用 release Rust，包名后缀 `.profile`，应用可调试、JNI 不可调试、R8 关闭、debug 签名。静态门禁先在缺失 profile/缺失 `isMinifyEnabled = false` 时失败，恢复配置后通过。
- **arm64 release 静态制品**：APK 12,212,328 B（11.647 MiB）、AAB 11,782,026 B（11.236 MiB）、Cargo release `.so` 14,304,656 B（13.642 MiB）、APK 内 `.so` 9,606,416 B（9.161 MiB）、`dist` 595,644 B（4 文件，0.568 MiB）。`scripts/audit-android-release.mjs` 核对工具链、arm64-only/AArch64、无 `.debug*`/`.symtab`/`.strtab`、无 EPUB/fixture/cache/宿主路径 payload、40/30/2 MiB 绝对门禁和 10% 基线门禁；临时把 APK 基线改为 1 B 后脚本按预期失败，恢复后通过。基线文件需随本次工作树提交后才成为已提交基线。
- **profile 制品**：arm64 profile APK/AAB 为 17,447,581/9,998,282 B；x86_64 profile APK/AAB 为 17,540,173/10,268,338 B。两者包名均为 `com.epubstart.reader.profile`、v2 debug 签名、应用可调试、单 ABI；APK 内原生库分别为 AArch64/x86-64，且无上述调试/符号表。profile 是诊断/AVD 制品，不是发布证明。
- **来源缓存（新增 8 个测试）**：覆盖命中推进持久时钟、最终文件真实大小、持久 LRU 不受 mtime 误导、活动租约跳过、受保护项超过 hard limit 的稳定错误、256/512 MiB 常量、重启孤儿/缺失协调、重启重新执行预算。变红自证包括临时移除活动判断、忽略 hard overflow、把软上限改为 255 MiB，以及在实现 seam 缺失/旧启动行为下的编译失败或目标断言失败；恢复后来源缓存 15/15。
- **封面与统一预算（新增 9 个测试）**：`CoverCache` 覆盖启动孤儿/缺失路径、按旧到新回落软上限、候选+旧封面保护、受保护 hard limit、失败导入只清候选；EPUB 覆盖原子候选不覆盖旧文件与 ENOSPC 映射；library service 覆盖资源错误不降级为书籍状态；`resource_budget` 冻结 512+128+256=896 MiB。变红自证分别通过缺失新 seam 的编译失败、保留旧封面/禁用 hard 判断、恢复旧错误映射和临时把封面 hard 上限改为 129 MiB 触发。恢复后完整套件 175/175。
- **已测/未测边界**：上述代码测试与静态制品检查仍按辅助逻辑口径记录。2026-08-23 使用校验过的本地 Maven 仓库补齐 AndroidX/JUnit/Hamcrest 依赖后，完整 `:app:lintUniversalRelease` / `:app:lintArmRelease` 已通过；此前跳过 lint model/vital 任务生成的 APK/AAB 仍不得称为完整 release 候选。受控 AVD 的运行态证据见 [ANDROID_STORAGE_ACCEPTANCE.md](ANDROID_STORAGE_ACCEPTANCE.md)：已覆盖 WebView、活动读者、复制中断/重试、ENOSPC、来源 hard-limit、SQLite 低余量、长期压力和 4 本书/2 个系列的综合恢复；封面 hard-limit 公共保护重叠仅观察到 admission 串行化/软淘汰，仍以辅助逻辑为准。真实黑鲨 Android 9 的取消/进程终止/重建记录直接接受；更广 OEM/真实设备矩阵移至 B3/F2。桌面端缓存算法由自动化覆盖，本次未做新的桌面 GUI 运行态，标记“待人工验证”。

- **B3 当前候选更新（2026-08-24）**：当前提交另完成 arm64 静态候选与 `:app:lintArm64Release`；APK/AAB 为 11,960,465/11,769,321 B，相对基线增长 3.49%/3.55%，ABI/ELF/禁止载荷门禁通过。Windows legacy shell 的实际运行态范围已关闭，系列/标签管理 UI 与更广 OEM/真实设备前端消费矩阵按 Backend First 边界归 F2/F3。黑鲨 SKW-A0 与荣耀 PPG-AN00 已补齐同一 release payload 的空白安装、ABI、首次启动、WebView 和主进程内存证据；固定样本运行时占用、release 私有 data 精确字节分项和正式 release 签名仍未验证，不能由受控 x86_64 AVD 或设备级 `df` 差值替代。详见 [B3_ANDROID_RELEASE_CANDIDATE.md](B3_ANDROID_RELEASE_CANDIDATE.md)。

### 0.2.14 B2 收口复核（2026-08-22）— 一致性缺口已修复，运行态边界不变

- **来源竞态与失败一致性**：Android `acquire` 在检查缓存前注册 `SourceLease` guard；淘汰持有同一活动 registry 锁直至元数据先删除、来源和指纹文件后删除，关闭“检查不活跃后、删文件前新租约进入”的窗口。原子复制和指纹写入失败会清理 `.tmp`；SQLite `SQLITE_FULL` 映射为稳定 `BOOK_RESOURCE_LIMIT_EXCEEDED:`。
- **封面并发与失败一致性**：`CoverMaintenance` 对尚未持久化的并发候选和旧封面做引用计数保护，所有重叠 admission 共用 128 MiB 硬预算；淘汰先清除数据库引用再删文件，数据库失败保留文件和引用，文件删除失败留下可由启动协调清理的孤儿，不产生悬空路径。
- **本轮红→绿清单**：`failed_source_metadata_eviction_keeps_cache_file_and_row` 在旧顺序下因文件已被删除而红；`sqlite_full_uses_stable_source_cache_resource_error` 在临时禁用 DiskFull 分支时得到 `INTERNAL_ERROR:` 而红；`failed_atomic_source_copy_removes_temporary_file` 在原子 helper 尚不存在时编译红。`overlapping_cover_admissions_share_one_hard_budget` 在第二候选错误返回 `Ok(())` 时红；`failed_cover_metadata_eviction_keeps_file_and_reference` 在文件先删时红；`sqlite_full_uses_stable_cover_cache_resource_error` 在 mapper 尚不存在时编译红。强化后的 `rebuildable_data_budgets_are_frozen_below_one_gibibyte` 在旧常量为 1 GiB、预期实际总和 896 MiB 时红。逐项恢复后定向测试、来源 18/18、封面 8/8 和完整 181/181 均绿。
- **release 门禁复核**：旧脚本会放过注入为 `0.0.0-injected` 的 Node 基线，补齐 Node/npm/rustc/cargo/JDK/Tauri CLI/Tauri crate 后同一注入按预期失败；AAB 的 ABI 集与打包 ELF 现独立于 APK 审计，临时把预期 ABI 改为 x86_64 后门禁按预期失败。最终静态基线收紧为 APK 11,557,632 B、AAB 11,365,807 B、Cargo release `.so` 13,040,288 B、打包 `.so` 8,951,720 B、`dist` 595,644 B，增强门禁通过。
- **环境边界**：官方 arm64 release 命令完成当前代码的 Rust release 编译；完整 Gradle lint 仍在相同四个 AndroidX 制品处失败，本次可联网错误为 Google Maven “Remote host terminated the handshake”，不再归因于用户禁止联网。显式跳过 lint 后 APK/AAB 打包成功，但不签发完整 release 候选。未连接或写入 Android 设备；无可运行 AVD，Android 低存储/中断/长期压力仍按延期验收包阻塞。验收包已改用仓库 Gradle Wrapper，要求每次 ENOSPC 尝试使用新 locator，并区分软上限运行态与仅有辅助逻辑覆盖的受保护 hard-limit 分支。

### 0.2.15 受控 AVD B2 收口补测（2026-08-22 后续）

- **已通过的 Android 运行态**：在 `EpubStart_B2_API35` / `emulator-5554` / `ro.kernel.qemu=1` 上，WebView 修复后的固定 EPUB 单书首屏读取保持通过；143 MB 有效 EPUB 在 `copy_source_atomically start` 后 force-stop，重启协调删除 `.source.tmp`，同一来源重试成功且数据库 `integrity_check=ok`；全新 profile 的受控 ENOSPC 在保留 4,088 KiB 时由 UI 返回 `BOOK_RESOURCE_LIMIT_EXCEEDED: source cache copy failed because device storage is full`，清理填充文件后无临时文件；删除 `source-cache/` 与 `covers/` 后单书来源/封面可从持久 SAF 来源重建。
- **后台索引补测**：为形成可观察的 Android 入口，临时 closeout debug APK 使用 `VITE_B2_CLOSEOUT=1` 显示诊断面板，调用既有 `list_series`、`set_book_series`、`ensure_series_search_index`、`get_search_index_status` 和 `cancel_search_index` Command；普通构建不包含该面板。`com.epubstart.reader` 在 `EpubStart_B2_API35` / `emulator-5554` 上导入固定 EPUB，建立 1 个测试系列并归属 1 本书，任务从 `pending` 到 `ready; 34/34`；拉回 SQLite 为 `integrity_check=ok`、`search_documents=34`、FTS=34。
- **覆盖清单**：已测目标复制步骤、重启临时文件清理、重试、来源复制满盘错误、单书可重建缓存、后台索引 WebView 触发/状态轮询/FTS 持久结果，以及数据库完整性/来源缓存大小核对。未测索引期间 Android 读者并发打开/翻页、索引取消/重建分支、六轮累计 2 GiB、完整系列/标签/设置/批注/索引数据综合重建、来源/封面 hard-limit 运行态、SQLite page/WAL 低存储峰值、OEM/真实设备矩阵。
- **证据**：`target/android-b2-closeout-20260822/interrupt-large-result.txt`、`interrupt-retry-verification.txt`、`enospc-runtime-after.png`、`enospc-runtime-result.txt`、`after-cache-rebuild-sqlite.txt`、`index-series-prepared.png`、`index-building.png`、`index-result.png`、`index-result-summary.txt`、`index-result.sqlite`。这些证据补充而不替换 46 本导入基线；B2 总门禁仍因长期压力、综合业务数据恢复和完整 Gradle lint 未签发。

### 0.2.16 受控 AVD B2 closeout 运行态（2026-08-23）

- **活动读者与来源 hard-limit**：在原始约 1536 MiB `EpubStart_B2_API35` AVD 上，索引任务处于 `building` 时读者完成 2 次翻页，最终 `10/10 ready`。补充 AVD 的实际 `/data` 为 `6,082,144 KiB`，使用 530 MiB 候选与 4,900 章节慢索引运行，候选返回 `BOOK_RESOURCE_LIMIT_EXCEEDED: source cache hard limit cannot be satisfied while active leases are protected` 且无残留，慢索引最终 `4,900/4,900 ready`。
- **长期压力**：`target/android-b2-pressure-20260823-direct` 完成 6 轮×46 份固定 EPUB fixture 的 direct IPC/SAF 导入，单份 8,521,993 字节，累计逻辑输入 `2,352,070,068` 字节（约 2.19 GiB）。每轮每 15 份导入重启 profile，并在轮末 force-stop/restart；第 6 轮保留 46 本图书 30 分钟后清理。六轮重启快照均为 `integrity=ok`、46 本书、31 条来源缓存/`264,181,783` 字节，清理快照均归零；日志以 `LONG_PRESSURE_DONE totalBytes=2352070068 expected=2352070068` 结束。
- **综合恢复**：`target/android-b2-runtime-closeout-20260823` 在补充 AVD 上建立 4 本书、2 个系列、4 条 `book_series` 关系、卷标排序、标签、全局/单书设置、进度和 3 条批注；删除 `source-cache/` 与 `covers/` 后重启，确认保存型业务数据保留且空目录不会冒充缓存重建；随后通过持久化 SAF locator 调用真实 `import_book`，来源/封面缓存与两个系列搜索索引恢复为 `7/7`、`3/3 ready`，最终检查全部通过，数据库 `integrity_check=ok`。
- **SQLite 低余量**：补充 AVD 写入 4,812,800,000 字节填充文件，将可用空间压到约 109,296 KiB；公开 `rebuild_search_index` 返回 `BOOK_RESOURCE_LIMIT_EXCEEDED: search index storage is full`。监测到主库峰值 111,452,160 字节、rollback journal 峰值 411,888 字节，WAL/SHM 均未观察到；清理填充后 `integrity_check=ok`、journal mode 为 `delete`，临时填充已移除。
- **边界**：长期压力使用同一固定 EPUB 的复制 fixture，证明逻辑累计输入、重启和清理行为，不证明唯一物理磁盘写入达到 2 GiB，也不计入多 URI 后台索引；公共封面导入路径只观察到 admission 串行化和软淘汰，未形成可控受保护三候选重叠，因此封面 hard-limit 仍只签发辅助逻辑证据。真实黑鲨 Android 9 的取消/进程终止/重建记录直接接受；更广 OEM/真实设备矩阵、正式签名发布候选和完整前端消费回归由 B3/F2 承接。

### 0.2.17 Gradle release lint 收口（2026-08-23）

- **依赖闭合**：阿里云 Maven 镜像可下载四个缺失 AndroidX 制品；二进制 SHA-256 与既有 Gradle module 元数据一致。随后补齐 `junit:junit:4.13.2`、`org.hamcrest:hamcrest-core:1.3` 与 `hamcrest-parent:1.3` POM，并使用 Maven Central 官方 SHA-1 逐项核对。依赖只写入 `D:\Android\offline-google-maven` 独立仓库，未手工改写 Gradle 缓存，也未把本机绝对路径写入项目配置。
- **红→绿反馈**：补齐依赖后，原 `:tauri-android:generateReleaseLintModel` TLS/缺失制品失败消失。完整 lint 首次到达项目检查并以 `MissingTvBanner` / `ImpliedTouchscreenHardware` 两条 error 变红；根因是初始 scaffold 宣告 `LEANBACK_LAUNCHER`，但项目从未承诺 Android TV。移除 Leanback feature/category 后，同一完整命令变绿。
- **结果与边界**：`:app:lintUniversalRelease` 和 `:app:lintArmRelease` 在 `--offline --no-daemon --continue` 下 `BUILD SUCCESSFUL`，92 个任务中 26 个执行、66 个 up-to-date；两份报告各为 0 error、31 warning、1 hint。非阻塞 warning 未在本任务扩张处理；lint 通过不替代正式签名、重新生成的完整 release APK/AAB 或 Android 运行态矩阵。

### 0.2.18 B3 Windows 桌面运行态回归（2026-08-23）

- 本轮同时运行 `npm.cmd run tauri dev` 和当前代码生成的 Windows x64 release。开发态和 release 均从真实应用数据加载 8 本书，打开首本书并通过 `epub.localhost` 读取 container、OPF、NAV、XHTML；release 重新启动后书架、封面引用和首本书仍可用。
- 已覆盖：翻页、目录跳转、正文搜索、批注创建/编辑/删除、单书阅读设置保存/恢复、进度保存调用、全屏进出和基础重启恢复。搜索回归发现 `section.load()` Promise 被误当回调导致结果为空；修复后开发态和 release 均以“终末”返回 19 条结果并可跳转。详细证据与步骤见 [B3_WINDOWS_RUNTIME.md](B3_WINDOWS_RUNTIME.md)。
- 未覆盖：本轮没有打开原生导入选择器，没有删除现有用户书籍；当前来源均有效所以重新定位入口未出现；legacy shell 没有系列/标签消费入口；Android/OEM/Linux 不由本轮桌面证据替代。B3 Windows 总门禁因此仍保持未签发。
- 本轮静态结果：`cargo fmt --check`、`cargo check`、完整 `cargo test`（181/181）、`npm.cmd run build`、`npm.cmd run audit:check` 和 `npm.cmd run audit:android-release` 通过；`npm.cmd run tauri build` 产出 Windows x64 exe/MSI/NSIS。Android 静态审计基线仍为 arm64-only、APK 11,557,632 B、AAB 11,365,807 B、原生库 13,040,288/8,951,720 B；本次前端修复后 `dist` 为 596,444 B，`audit:android-release` 增长 0.13%，仍在门禁内。

### 0.2.19 B3 契约冻结候选（2026-08-23）

- B3 候选时期的 Command 注册/TypeScript 封装为 44/44，Rust 与 TypeScript 模型按 snake_case 镜像；数据库迁移链冻结为不可回写的 V1→V4；书籍状态、搜索状态、错误前缀和 896 MiB 可重建数据预算均有实现与文档定位。B4 当前状态见 0.2.20。
- 详细冻结表、资源预算、来源状态和未签发条件见 [B3_CONTRACT_FREEZE.md](B3_CONTRACT_FREEZE.md)。由于 Windows UI 的导入/删除/失效来源重新定位、系列/标签消费和更广 Android/OEM 矩阵仍未覆盖，本候选不签发 B3 完成。

### 0.2.20 B4 阅读洞察后端（2026-08-28）

- **实现范围**：V5 追加 `book_reading_state`、`reading_activity_sessions`、`reading_presence_segments`；活动服务负责 `visible/paused/ended` 状态、严格序列幂等、90 秒确认上限、跨本地午夜拆分、偏移变化保守断开和启动恢复。历史只保存书名、作者、系列快照与可见区段，不保存来源路径、Android URI 或正文。
- **读侧能力**：`get_library_reading_overview` 返回日/周/月/季度中性时间桶、仍在书架中的最近继续阅读项及进度、最多三个结构化离线推荐理由；`get_reading_footprint` 返回年/总计的自然日单元、阅读毫秒、接触图书数和系列数；`delete_reading_history` 支持活动、日期、历史图书身份和全部删除。删历史不改图书/进度/`book_reading_state`，删书保留历史快照并断开实时 `book_id`。
- **推荐边界**：当前只读取书架元数据、系列关系、阅读进度和图书阅读状态，覆盖系列下一本、较久未读完、未开始三类理由；正文、精彩文段、`search_documents` 和搜索索引不参与推荐。正文推荐只登记为 Reader 完成后的单独评审项，未注册空 Command 或占位字段。
- **IPC 对齐**：Rust `lib.rs` 已注册 49 个真实 Command，`src/types/ipc.ts` 与 `src/lib/tauri.ts` 已同步 49 个 wrapper；B4 新增 `begin_reading_activity`、`observe_reading_activity`、`get_library_reading_overview`、`get_reading_footprint`、`delete_reading_history`。Command 仍只做薄适配，时间戳/UUID/状态机/聚合均在服务层。
- **已验证（辅助逻辑/单元）**：V5 空库创建、旧进度补种、幂等升级、后段失败回滚；活动快照、可见/暂停/结束计时、重复序列、跳号/终态冲突、长未知间隔、启动恢复、跨午夜；概览四类数据契约与三类推荐理由；年足迹零值日元数据、总计聚合；删书后快照/实时关联、按日期保留跨日活动、按活动/图书/全部删除，以及删历史后图书/进度/继续阅读状态保留。新增 B4 测试均完成目标步骤“故意注入缺陷→目标测试变红→恢复→变绿”。
- **交付验证**：`cargo fmt --check`、`cargo check`、完整 `cargo test`（195/195）、`npm.cmd run build`、`npm.cmd run audit:unwrap` 和 `npm.cmd run audit:check` 均通过；当前 unwrap 自动统计为 672 行/687 次，并与本文件及 `TODO.md` 一致。未运行 Android 构建或设备测试，因为 B4 没有生产 Reader/书架 UI 消费改动。
- **未测/边界**：桌面端和 Android 当前没有生产 Reader/书架消费，因此没有把前端心跳、锁屏/切后台、WebView 或 UI 排版写成运行态通过；这些属于 F2/F3 的人工运行态验证。未声明多进程/多连接数据库并发、真实断电/损坏数据库或真实物理写满；正文推荐的候选段落、语言组织、剧透规避、隐私和模型/本地算法仍待后续单独评审。
- **B3 样本集更新（2026-08-28）**：新增 [B3_ANDROID_SAMPLE_MANIFEST.md](B3_ANDROID_SAMPLE_MANIFEST.md)，将当前 arm64 真机固定样本从单个 `6.epub` 扩大为 37 个唯一 EPUB（215,965,079 字节）；根目录与附件重复副本按 SHA-256 排除。该清单只更新下一轮 B3 运行态占用/私有 data 复测的输入，不把结构检查或旧候选证据升级为完成证明；B2 的单固定 EPUB 长期压力口径保持不变。

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
| B3 | 授权撤销/来源失效 | 黑鲨 Android 9：一次性诊断探针释放持久 URI 授权后，重建索引得到 `BOOK_SOURCE_UNAVAILABLE: ... Persisted read permission is missing`；临时书籍与文件已清理。未覆盖自动化 Provider/Activity 流水线 |
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
| universal arm64 debug APK（当前官方构建，2026-08-15） | 310,548,144 字节（296.16 MiB） | 仅为 debug 产物，不代表 release；较早的 151.08 MiB 数字是旧/中间产物，不能作为最终 APK 基线 |
| `lib/arm64-v8a/libepub_start_lib.so` | 145.08 MiB，约占 APK 原生 payload | 主要由 Rust/NDK 调试段构成；此前副本仅移除调试信息后为 27.27 MiB |
| 前端 `dist` | 约 0.57 MiB | 不是本次膨胀主因 |
| DEX | 压缩后约 5.19 MiB | 次要占用 |
| 设备应用私有数据 | 约 31.45 MiB | 其中来源缓存约 26.82 MiB、封面约 3.99 MiB；会随使用增长 |

ELF 分段检查显示主要调试段包括 `.debug_info`、`.debug_str`、`.debug_line` 和 `.debug_ranges`。当前 APK 的 ZIP 还观察到 `classes7.dex` 与 `assets/tauri.conf.json` 之间约 144.20 MiB 的对齐/保留空洞，必须在 release 构建链审计中解释，不能把它误归因于业务资源。设备设置页观察到约 338 MB，可由当前 debug APK、系统解包/运行时优化和应用数据共同解释；不能据此声称 release 安装包为 338 MB，也不能据此声称 release 已达标。

2026-08-15 当时的 arm64 release 构建已经进入 Rust release 编译，但在 Tauri 插件生成缓存处失败：`tauri-plugin-fs/android/.tauri/tauri-api` 创建目录时报“文件已存在（os error 183）”。当时没有删除 Cargo 全局缓存、修改生成任务或手动复制 `.so`，所以该次没有可靠 release 基线；该历史阻塞已在 2026-08-18 的 0.2.13 收口中关闭。

2026-08-15 当时 `source/cache.rs` 仍使用 1 GiB 单一上限和文件 `modified` 排序，命中不更新 `source_cache_entries.last_accessed_at`，封面也无独立预算；这些规划输入已由 2026-08-18 的 0.2.13 实现与辅助逻辑验证取代。Android 运行态仍须使用延期验收包，历史探查不能升级为当前设备证明。

## 缺口清单

| # | 缺口 | 文件位置 | 风险 | 修复任务 | 验证命令 |
| --- | --- | --- | --- | --- | --- |
| 1 | 进度保存的业务校验/时间戳/回查在 Command 内 | `src-tauri/src/commands/save_reading_progress.rs` | 低 | **已修复**（2026-08-14）：下沉到 `services::save_reading_progress` | `cargo test` |
| 2 | 两个只读 Command 直连 repository，绕过 services 层 | `commands/get_reading_progress.rs`、`commands/list_books.rs` | 低 | **已修复**（2026-08-14）：经 `services::get_reading_progress` / `services::list_books` | `cargo test` |
| 3 | 51 处小写 `internal error:` 前缀 | 多个 services/commands 文件 | 低 | **已修复**（2026-08-14）：全部统一为 `INTERNAL_ERROR:`，grep 复核 0 处小写残留 | `cargo test` + grep 复核 |
| 4 | `epub://` 协议无 Range 支持 | `src-tauri/src/protocol/mod.rs` | 低 | **已实现**（2026-08-14）：`serve_range` 单段/开放结尾/suffix/416/回退 + `Accept-Ranges`；8 个单元测试 + 变红自证；并发 Reader 租约 5 个测试 + 变红自证 | `cargo test` |
| 5 | lib.rs 事件循环 `expect` | `src-tauri/src/lib.rs:103` | 低 | 可选：保持 Tauri 惯例 | `cargo check` |
| 6 | Android 官方构建不可从干净 scaffold 复现 | `src-tauri/gen/android`、Tauri Android 生成/构建链 | 高/阻塞 B0 完成证明 | **已关闭**（2026-08-14）：干净再生成 scaffold（保留 EpubSafPlugin.kt）、无本地绕过，官方命令 exit 0 产出 APK/AAB | `npm.cmd run tauri -- android build --debug --target aarch64` |
| 7 | Android 导入偶发卡住 | `platform/android.rs`、SAF 插件/来源缓存链 | 高/阻塞 B1 实机门禁 | **已关闭**（2026-08-14）：根因 tauri#14994 MainPipe 唤醒，`select_epub_sources` 返回前 200ms sleep workaround；黑鲨 30 轮循环导入无卡住 | 双机后端/平台验收 |
| 8 | V1/V3 回滚测试缺少变红自证 | `src-tauri/src/db/migrations.rs` | 中/阻塞 B0 完成证明 | **已补证**（2026-08-14）：V1/V3 分别在目标步骤注入 `COMMIT;` 破坏回滚并确认目标断言变红（V1: `books was not rolled back`@640；V3: `font_size_px` 列@682），恢复后 9/9 与完整套件通过 | `cargo test db::migrations` + `cargo test` |
| 9 | Android release 制品缺少可重复分项基线 | Gradle/Tauri release 构建链、体积报告脚本 | 中/阻塞 B3 冻结 | **代码/静态制品已关闭并于 2026-08-22 复核，完整 lint 于 2026-08-23 关闭**：目录冲突关闭，最终 arm64 APK/AAB/native/dist 基线与绝对/10%/完整工具链/APK+AAB ABI/ELF/payload 门禁已建立；两种 release lint 变体均为 0 error。正式签名和安装后 code/data 留待 B3/AVD | `npm run audit:android-release` + 完整 Gradle lint + AVD 分项 |
| 10 | 来源/封面缓存缺少真实 LRU 与完整软硬预算 | `source/cache.rs`、`source_cache_entries`、`CoverCache` | 中/长期膨胀风险 | **实现与辅助逻辑已关闭并于 2026-08-22 复核；Android 限定运行态于 2026-08-23 补齐**：来源 256/512 MiB、持久真实 LRU、无 TOCTOU 的活动租约保护、原子失败清理和重启协调；封面 64/128 MiB、并发候选总预算、元数据优先淘汰与孤儿清理；合计实际硬预算 896 MiB、总 ceiling 1 GiB。受控 AVD 已覆盖来源 hard-limit、ENOSPC、中断/重启、长期压力、SQLite 低余量和多记录缓存重建；公共封面保护重叠未形成可控运行态，仅保留辅助逻辑证据；更广 OEM/真实设备矩阵移至 B3/F2。 | 初始 17 个 + 复核新增 6 个/强化 1 个变红自证测试 + `ANDROID_STORAGE_ACCEPTANCE.md` |

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
- 2026-08-15：B2 搜索与索引真实实现落地并完成复核修复：新增 EPUB spine 有界纯文本提取、FTS5 trigram/短词字面 `LIKE`、来源指纹失效、部分结果、事务化 256 MiB 索引账面预算、UTF-8 按字节计数、单任务 2 GiB 累计预算检查、同系列任务去重、取消/重建/重启恢复、错误状态事务回滚、相对/百分号编码 href 和 5 个真实 Command；新增回归测试均完成变红自证，完整 `cargo test` 137/137、`audit:check` 348 行/355 次一致；受限 page_count 的真实写事务验证 SQLite `SQLITE_FULL` 映射到稳定 `BOOK_RESOURCE_LIMIT_EXCEEDED:` 并保留旧索引，缓存 OS 错误继续由内存错误对象覆盖，未触碰设备存储。当前 Android APK 已复测单卷 34/34 查询、七卷取消 101/135、force-stop 后 `pending`→135/135 `ready`；另以系统 picker 导入 13.20 MiB EPUB 完成章节超限拒绝，并用一次性 SAF 释放探针确认授权撤销后 `BOOK_SOURCE_UNAVAILABLE`。低存储、长期/2 GiB 导入压力和 SQLite page/WAL 实际占用延期至受控 Android 虚拟设备，不签发该门禁完成证明。
- 2026-08-17：B2 第五节首项完成。目录链冻结为 `epub_root_url -> ResourceProvider`，覆盖 `container.xml`、OPF、NAV/NCX、spine 与关联资源；搜索提取改经 `ActiveFormat -> SearchContentProvider`，移除未实现的目录/文本占位接口；协议错误状态和来源脱敏固定，提取及 LIKE/trigram 查询不再生成或返回伪 CFI。新增 2 个、强化 5 个测试均完成目标变红自证，完整 `cargo test` 139/139；`audit:unwrap` 自动统计 354 行/361 次。桌面 EPUB.js 与 Android WebView 的完整 NAV/NCX 运行态分别保持待人工验证/阻塞至 B3。
- 2026-08-17：B2 第五节第二项完成。系列模块新增 `list_series_books`，同步 Rust/IPC/TypeScript 并保持 Command 薄适配；修复重复系列名误报内部错误、卷标未修剪、`COMMIT` 失败后事务未释放三个缺口，补齐单系列归属、排序成员校验与后段失败回滚证据。新增 7 个测试和 1 个强化均完成目标变红自证；完整 `cargo test` 146/146，`audit:unwrap` 自动统计 388 行/395 次。桌面系列消费待 B3/F2 人工验证，Android 消费阻塞至 B3 设备回归。
- 2026-08-17：B2 第五节第三项完成。标签模块新增 `list_series_tags` 与 `filter_books_by_tags`，同步 Rust/IPC/TypeScript 并保持 Command 薄适配；补齐系列标签重启读取、直接/继承标签 AND 筛选、稳定排序与书架隐私返回，修复标签组/同组标签唯一冲突误报内部错误。新增 4 个测试均完成目标变红自证；完整 `cargo test` 150/150，`audit:unwrap` 自动统计 426 行/433 次。桌面标签消费待 B3/F2 人工验证，Android 消费阻塞至 B3 设备回归。
- 2026-08-18：B2 第五节第五项完成。`notes_service` 统一修剪创建/更新字段，拒绝空白起止 CFI、把空白 range 归一为 `NULL`，冻结 4,096/10,000/20,000 Unicode 字符边界、小写颜色和字面纯文本语义；新增真实文件数据库关闭重开后的全字段恢复测试，并把删书级联改为通过服务 seam 观察。新增 3 个、强化 2 个测试，5 组均完成目标变红自证；notes 专项 21/21、完整 `cargo test` 158/158，`audit:unwrap` 自动统计 455 行/462 次。桌面 EPUB.js 批注运行态待 B3/F2 人工验证，Android WebView/设备矩阵阻塞至 B3/F2。
- 2026-08-18：B2 Android 制品/缓存代码收口完成。修复 desktop dialog 与外部 Android 子项目 build 目录冲突，固定 NDK 并建立 profile、arm64 release 基线和静态体积/ABI/ELF/payload 门禁；来源缓存实施 256/512 MiB、持久真实 LRU、活动租约、启动协调，封面实施 64/128 MiB、原子候选、事务/孤儿清理，统一可重建数据硬上限 896 MiB。新增 17 个测试与 release/profile 静态门禁均完成目标变红自证；完整 `cargo test` 175/175，`audit:unwrap` 550 行/563 次。完整 Gradle lint 的四个 AndroidX runtime 制品受当前沙箱网络权限阻塞；Android 运行态等待固定 AVD，未签发 B2 总完成证明。
- 2026-08-22：B2 收口复核修复来源租约/淘汰 TOCTOU、来源临时文件残留、来源/封面 SQLite 满盘稳定映射、封面文件先删后改元数据和并发候选未共享硬预算；实际硬预算常量由误称 1 GiB 改为 896 MiB，并保留独立 1 GiB ceiling。新增 6 个测试、强化 1 个预算测试，逐项目标变红后恢复，完整 `cargo test` 181/181；`audit:unwrap` 自动统计 575 行/590 次。release 门禁补齐完整工具链和 AAB ABI/ELF，最终静态基线收紧；完整 Gradle lint 因 Google Maven TLS 握手中断仍阻塞，Android 运行态仍等待固定 AVD，B2 总完成标准保持未勾选。
- 2026-08-23：从阿里云镜像取得缺失 AndroidX/JUnit/Hamcrest 制品并以 Gradle module SHA-256/Maven Central SHA-1 校验，组装独立本地 Maven 仓库；完整 lint 首次到达项目检查后暴露 Android scaffold 的两条 Leanback TV error。项目没有 Android TV 目标，移除 Leanback feature/category 后，`:app:lintUniversalRelease` 与 `:app:lintArmRelease` 均 `BUILD SUCCESSFUL`，各为 0 error、31 warning、1 hint。未把此前跳过 lint 生成的 APK/AAB 追认为完整发布候选，B2 总门禁仍受其余 Android 运行态矩阵约束。
- 2026-08-23：B3 Windows 回归覆盖开发态与 x64 release 的打开、资源链、目录、搜索、批注、设置、进度、全屏和基础重启；修复 EPUB.js `section.load()` Promise 被误当回调造成的桌面搜索空结果。随后以隔离 fixture 在开发态补齐真实原生选择器导入、删除和来源失效后的重新定位，并清理测试书籍/文件；系列/标签消费及非 Windows 平台仍按覆盖清单保留未完成状态。
