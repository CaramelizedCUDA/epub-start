# 当前执行看板（Backend First）

本文件是唯一执行顺序。开始工作前必须阅读 [README.md](README.md)、[ARCHITECTURE.md](ARCHITECTURE.md)、[DATABASE.md](DATABASE.md)、[IPC.md](IPC.md)、[CONVENTIONS.md](CONVENTIONS.md)、[ROADMAP.md](ROADMAP.md) 和 [SECURITY.md](SECURITY.md)。

执行规则：

- 只处理本文件中第一个未完成且无外部阻塞的任务；满足完成标准并完成验证后才能勾选。
- B0–B3 期间禁止新增前端功能、视觉优化或交互重构。`src/` 只允许为 IPC 镜像、类型检查、安全修复和构建阻塞做最小改动。
- 前端现有实现是 legacy shell，不把旧的 `[x]` 前端条目继承为新前端验收结果。
- 未实现能力不得注册 stub、空返回、`todo!`、`unimplemented!` 或假进度；不支持能力必须返回稳定错误。
- 发现数据库、IPC、架构或安全文档冲突时，先停在文档/契约层解决，不用代码绕过规范。

## B0 后端审计与健康基线（已完成，完成证明 2026-08-14 重新签发）

### 0.1 初次审计基线（历史执行事实，不代表当前最终状态）

- [x] `cargo fmt --check` 通过（2026-08-14）。
- [x] `cargo check` 通过（2026-08-14）。
- [x] 初次审计时 `cargo test` 为绿色：67/67（2026-08-14）。当时未覆盖事实：新增 V1/V3 迁移失败回滚测试尚未留存“故意注入缺陷→测试变红→恢复→测试变绿”证据；该缺口随后已在 0.2 与 B0 完成标准中补齐。B1 收尾最终执行为 108/108，见 3 节。
- [x] `npm.cmd run build` 通过（2026-08-14）；仅证明 TypeScript/Vite 可构建，不证明前端体验或后端完成。
- [x] `npm.cmd run tauri build` 通过两次、第二次 exit 0（2026-08-14 11:48/11:53），产出 MSI（5.20 MB）与 NSIS（3.01 MB）安装包；`Cargo.lock`/`package-lock.json` 均在位，构建可重复。
- [x] Android 环境准备已完成（2026-08-14）：工具链装于 `D:\Android\Sdk`（JDK17/cmdline-tools/platform-tools/android-35/build-tools/NDK27），Rust Android targets 已装，荣耀 PPG-AN00（Android 15）与黑鲨 SKW-A0（Android 9）可用于探查，固定 EPUB 样本已就绪（8 本）。该条只记录环境就绪；B1 门禁的后续通过证据见 1.52。

### 0.2 生产代码健康审计

- [x] 审计 `src-tauri/src` 生产代码：`panic!`/`todo!`/`unimplemented!`/`unreachable!` 0 处；由 `npm run audit:unwrap` 自动统计为 348 行（共 355 次调用，当前 B2 搜索修复测试后复核），全部在 `#[cfg(test)]` 测试模块；生产 `.expect()` 仅 `lib.rs:103` 事件循环收口；锁 poisoning 均映射为错误。未统计 `src-tauri/target` 生成代码。
- [x] 审计 41 个 `#[tauri::command]`：绝大部分为薄适配；3 个历史缺口已关闭，B2 搜索 5 个 Command 已接入真实服务，见 [BACKEND_AUDIT.md](BACKEND_AUDIT.md) 注册清单。
- [x] 审计 `lib.rs` 启动错误语义：setup 内目录/数据库/迁移失败均映射为带上下文错误传播，无启动期 panic 掩盖；唯一 `expect` 为 Tauri 事件循环收口（低风险，可选修复）。
- [x] 生成 Command 注册清单并三方比对：Rust 41 == IPC.md 41 == `tauri.ts` 41，命名一致；B2 搜索 5 个 Command 已接入真实服务；18 个系列/标签 wrapper 前端未调用（legacy shell 冻结，F2 接入）；发现并修复 IPC.md 缺少 `BOOK_RESOURCE_NOT_FOUND:` 行的文档缺口。
- [x] 迁移实现清单已生成，且 V1/V3 回滚测试已完成变红自证（2026-08-14）：V1/V2/V3 均使用 `BEGIN IMMEDIATE`+`COMMIT/ROLLBACK` 和版本门控。变红证据：在 V1/V3 目标失败分支注入 `COMMIT;` 破坏回滚后，`test_v1_failure_rolls_back_every_v1_object` 失败于 `books was not rolled back`（migrations.rs:640）、`test_v3_failure_rolls_back_every_v3_object` 失败于 `font_size_px` 列存在断言（migrations.rs:682）；恢复后 `cargo test db::migrations` 9/9、完整 `cargo test` 67/67 通过。
- [x] 初次审计生成安全边界清单。辅助逻辑当时已测：ZIP 预算、路径规范化、MIME、CORS、错误脱敏以及桌面来源/租约相关单元测试；当时未测：Android 稳定导入、干净 Android 构建和自动化设备流水线，`Range` 仍是 B1 缺口。前两项与 Range 随后已关闭；自动化设备流水线及低存储/长期压力仍未覆盖。桌面保存对话框与实际写入只有历史人工运行态记录；legacy 前端/WebView 的资源请求方式不属于 B0 后端审计。

### 0.3 B0 完成标准

- [x] 形成 [BACKEND_AUDIT.md](BACKEND_AUDIT.md)，缺口清单含文件位置、风险等级、修复任务和验证命令。
- [x] 明确区分辅助逻辑（静态/单元自动验证）、桌面端人工运行态和 Android 设备探查；不再把环境就绪或等价调试路由当作 Android 门禁。
- [x] 已同步 README、ROADMAP、TODO、SECURITY 与 BACKEND_AUDIT 的当前结论，并保留 IPC.md 已修复的 `BOOK_RESOURCE_NOT_FOUND:` 文档记录。
- [x] Android 平台工程可从干净、已审查的 scaffold 通过官方 `npm.cmd run tauri -- android build --debug --target aarch64` 构建（2026-08-14：`gen/android` 删除后重新 `tauri android init --ci` 生成、仅放回 `EpubSafPlugin.kt`、无本地绕过，exit 0 产出 APK 与 AAB）。
- [x] 重新签发 B0 完成证明（2026-08-14）：V1/V3 回滚测试变红/变绿证据已补齐（注入 COMMIT 破坏回滚 → 目标断言变红 → 恢复 → 绿），Android 官方干净构建已通过，审计覆盖清单与文档结论已复核。

## B1 后端核心能力（已完成，完成证明 2026-08-14 签发）

### 1. 来源、格式和协议

- [x] 来源指纹、`SourceLease`、独立 `Read + Seek` Reader 和 Android 私有缓存已落地。
- [x] 整本 EPUB 缓存已移除；ZIP 条目数、控制文件、单条目、总解压量和压缩比预算已统一。
- [x] `formats/capabilities.rs`、`registry.rs`、`active.rs` 和 EPUB 实现已建立；未支持格式返回 `FORMAT_NOT_SUPPORTED:`。
- [x] `services/` 已承载导入、打开、删除、重新定位、图片和格式用例；Command 保持薄适配。
- [x] 对每条 `epub://` 资源请求补齐测试（2026-08-14）：成功路径与 MIME（format_service 3 个）、来源失效脱敏与状态码映射（协议层 2 个）、路径穿越（format_service/protocol 各有）、Range（8 个 + 变红自证）、CORS（既有白名单测试）、超预算（formats/epub 压缩比/条目超限既有测试）、并发 Reader 租约（cache 5 个 + 变红自证）；`epub://` 已支持 Range。
- [x] 审计 `save_book_image` 的桌面保存、用户取消、非图片 MIME、来源失效和敏感信息不出前端；Android 明确返回稳定未支持错误（2026-08-14）。覆盖清单（已测）：入口规范化、BOOK_NOT_FOUND、非图片 MIME 拒绝、文件名消毒、来源失效脱敏（修复 `sanitize_source_error`：旧 `split_once(':')` 会把 Windows 盘符 "C" 当错误前缀返回，改为前缀白名单 + 3 个新测试，变红自证）、Android `FORMAT_NOT_SUPPORTED:` 稳定错误；未测（待人工验证）：桌面保存对话框与用户取消路径（`None → Ok(false)` 语义经代码审查确认，需 AppHandle 无法自动测）。
- [x] 补齐 Android SAF 选择、持久授权、重启校验、撤销授权和失效来源的静态测试（2026-08-14）。做法：picker 响应转换（取消→空 / 无 URI→SAF_PERMISSION_DENIED / 非法 URI→VALIDATION_ERROR / 成功→AndroidContentUri）与 `content://` 前缀校验（含非空 authority）抽为 `platform/mod.rs` 平台无关纯函数，Android 实现复用；桌面构建新增 9 个 SAF 测试 + 桌面 `validate_selected_source` 3 个测试，全部变红自证。未测（真机行为，标注）：Kotlin 侧 takePersistableUriPermission、重启复核与撤销授权仍以双机探查为准，Rust 侧无法自动覆盖。
- [x] **B1 Android 后端/平台首次实机门禁（通过，2026-08-14）：** 官方干净构建已关闭；SAF 选择、持久权限、重启、授权撤销、重新定位、私有缓存、FD 计数、协议状态码/MIME/CORS/Range/路径防护均已在双机验证；导入卡住已定位（tauri#14994 wry MainPipe 唤醒）并以 200ms 唤醒窗口 workaround 修复，黑鲨 30 轮循环导入/删除无卡住（详见 [BACKEND_AUDIT.md](BACKEND_AUDIT.md) 0.4 与缺口 #7）。legacy 前端/WebView 的 `fetch` 行为不作为本门禁或 B0 的否决条件。

### 2. 数据库、服务和错误契约

- [x] V1/V2/V3 迁移、来源缓存、设置、批注、系列、标签和关系基础已存在。
- [x] 批注服务已覆盖 CFI、长度、颜色、审计字段保留、缺失错误和删除级联。
- [x] 审计全部仓储函数的参数化 SQL、事务边界、空结果语义和错误脱敏（2026-08-14）。结论：SQL 全部参数化（`params!`，`entity_exists` 表名白名单）；修复 `delete_book` SELECT+DELETE 两步竞态窗口（BEGIN IMMEDIATE 单事务原子化）；`reorder_series_books`/`replace_tags` 事务边界正确（IMMEDIATE + COMMIT/ROLLBACK）；空结果语义 find→Option、`delete_note`→usize 由服务层映射稳定错误；services 层 41 处 `: {error}` rusqlite 原始错误透传全部移除，`INTERNAL_ERROR:` 后仅稳定消息。
- [x] 为系列、标签、设置和批注补齐并发更新、重复关系、删除级联、继承去重和失败回滚测试（2026-08-14）。新增：系列并发创建（8 线程×25=200 行不丢失）、更新失败保留原名、删除缺失 SERIES_NOT_FOUND；`finish_transaction` 失败回滚并释放事务自证；批注并发创建（8×20=160 条）、失败更新保留原内容、删书级联清空 notes；设置全局保存失败保留原值、9 线程并发保存不损坏、未知书稳定拒绝；notes/progress 级联删除测试。全部变红自证；并发测试验证无死锁与行数守恒，不做强线性一致声明。重复关系/继承去重既有测试（catalog_repository 7 个）继续覆盖。
- [x] 为所有公开 Command 固定稳定错误前缀（2026-08-14）：51 处小写 `internal error:` 已全部统一为 `INTERNAL_ERROR:`，grep 复核 0 处残留；禁止返回原始 SQL、堆栈、完整路径或完整 Android URI（脱敏测试在协议层/image_service）。

### 3. B1 完成标准

- [x] Rust 核心模块完成自动化测试：正常路径、错误路径、恶意输入、来源失效、权限失败和资源耗尽均有覆盖（当前 137/137；搜索专项覆盖清单见 BACKEND_AUDIT.md 0.2.5；桌面对话框类运行态与 Android Kotlin 真机行为按三类口径标注，不计入自动覆盖）。
- [x] `cargo fmt --check`、`cargo check`、完整 `cargo test` 通过（当前 137/137；测试数 85→137，B2 搜索专项已完成变红自证）。
- [x] IPC、模型、数据库和安全文档已同步（B2 新增 5 个真实搜索 Command、模型镜像和预算/未验证边界已登记；BACKEND_AUDIT.md 已同步 audit:unwrap 自动统计 348 行/355 次）。

## B2 后端业务能力（当前阶段）

### 4. 搜索与索引（真实后台实现）

- [x] 设计并实现同系列/多卷搜索需要的后端任务模型：任务 ID、状态、进度、取消、错误、结果上限、同系列任务原子去重和来源失效（桌面自动验证；Android 已复测取消与进程终止恢复，低存储/长期压力门禁仍延期）。当前书章节内查找按 IPC 留给 F2 EPUB.js，不冒充后端索引能力。
- [x] 使用 bundled SQLite FTS5 trigram 建立惰性增量索引；查询短于 3 个字符时使用参数化 `LIKE`。
- [x] 索引按来源指纹失效，支持部分结果、手动重建和过期重建；实现未把整本 EPUB 一次性读入 `Vec<u8>`。
- [x] 执行预算：单章节 8 MiB、单书 64 MiB；提取计数使用溢出检查。一次索引任务累计提取量 2 GiB 的总任务门禁仍需 Android/大文件运行态验证。
- [x] 搜索索引持久化文本账面硬上限 256 MiB；超限保持事务一致性并返回 `BOOK_RESOURCE_LIMIT_EXCEEDED:`。黑鲨 Android 9 七卷 135/135 重建期间实测 `epubstart.db` 11,640,832 B、峰值 rollback journal 8,309,808 B，未出现 `-wal`；这是当前样本的运行态记录，不替代低存储/长期压力验证。
- [x] 覆盖 spine 顺序、中日韩文本、OPF 相对/百分号编码 href、短词 LIKE 字面 `%`/`_`/反斜杠、三字以上 trigram、跨章节结果、取消、同系列任务原子去重、结果上限、未就绪错误、损坏章节、章节资源超限、提取计数溢出、索引预算超限、单任务 2 GiB 累计预算、错误状态事务回滚，以及真实 SQLite `SQLITE_FULL` 到 `BOOK_RESOURCE_LIMIT_EXCEEDED:` 的映射与旧索引保留；新增测试均完成“注入错误→目标测试变红→恢复变绿”。Android 缓存常见存储耗尽 OS 错误的稳定前缀映射仍由内存错误对象覆盖；未替代 Android 低存储运行态。
- [x] 注册并记录真实搜索 Command：`ensure_series_search_index`、`get_search_index_status`、`cancel_search_index`、`search_series`、`rebuild_search_index`。
- [x] 在 Android 真实设备验证索引取消与应用进程被系统终止后的恢复：当前 APK 在黑鲨 Android 9 上七卷系列取消后保留 101/135 章节部分结果；force-stop 后重启状态恢复为 `pending`（101/135），重新执行后恢复到 135/135 `ready`。
- [x] 在 Android 真实设备以系统 picker 导入 13.20 MiB EPUB，并验证大章节索引限制：章节超过 8 MiB 得到 `ready`、0/1 且保留超限明细；此前已持久 URI 重拷贝并恢复原 EPUB 到 34/34。该证据覆盖单次大文件导入，不等于长期/2 GiB 压力。
- [ ] **硬件阻塞，延期至受控 Android 虚拟设备：** 验证 ENOSPC/SQLite 满盘、长期/2 GiB 导入压力、进程重启与清理恢复；固定 API/镜像和 `/data` 容量，记录初始/峰值/清理后占用与可复现命令。来源授权撤销已用黑鲨 Android 9 的一次性诊断探针验证，同一设备已记录一次 135/135 重建的 SQLite 主库/rollback journal 占用。虚拟设备例外只覆盖破坏性存储压力，不替代 SAF Provider、OEM 进程管理、性能或手势实机证据，也不能用桌面纯辅助逻辑替代。

### 5. 目录、系列、标签、设置和批注后端收口

- [ ] 固定目录/搜索所需的后端资源与错误契约；DOM/CFI 解析仍留给后端冻结后的 EPUB.js 前端阶段。
- [ ] 完成系列 CRUD、单系列归属、卷标、排序和关系事务。
- [ ] 完成标签组/标签 CRUD、书籍直接标签、系列继承标签、筛选查询和删除关系语义。
- [ ] 完成全局/单书阅读设置的持久化、逐字段覆盖、默认值和迁移回归。
- [ ] 完成批注数据契约的最终审计：纯文本、CFI、长度、颜色、重启恢复所需字段和删除级联。

### 6. Android 制品与运行时存储预算

- [ ] 建立可重复的 arm64 release 体积报告，分别记录 APK/AAB、Rust 原生库和前端 `dist`；先关闭本机 release 测量遇到的 `tauri-plugin-fs/android/.tauri/tauri-api` 目录冲突，再记录干净构建命令、工具链版本与基线。不得删除 Cargo 全局缓存或提交本地构建绕过来制造通过。
- [ ] 实施初始发布门禁：arm64 release APK ≤ 40 MiB、Rust 原生库 ≤ 30 MiB、前端 `dist` ≤ 2 MiB；相对已提交基线增长 >10% 必须解释。首次可靠 release 基线建立后只允许收紧；放宽预算需人工批准并同步路线图和安全文档。
- [ ] 明确 debug/profile/release 用途：保留完整符号的 debug 包只用于 native 诊断；日常真机回归使用移除原生调试段的 profile；release 不得携带调试段、测试 EPUB、预置来源缓存或本机产物。记录空白安装后的 code 与 data/cache 分项，不用 Android 设置页单一数字代替制品测量。
- [ ] 将 Android 来源缓存从当前 1 GiB 单一上限改为软上限 256 MiB、硬上限 512 MiB；缓存命中更新 `source_cache_entries.last_accessed_at`，按真实 LRU 淘汰，活动 `SourceLease` 受保护。若安全淘汰后仍无法满足硬上限，返回稳定资源限制错误，不静默超限。
- [ ] 为封面缓存实施软上限 64 MiB、硬上限 128 MiB，并清理删书、导入失败、数据库不存在记录对应的孤儿文件；搜索索引在写入前确定独立预算，来源缓存、封面和索引等全部可重建数据的合计硬上限 ≤ 1 GiB。
- [ ] 覆盖磁盘不足、中断写入、缓存命中更新时间、LRU 顺序、活动租约、进程重启、孤儿清理和重建测试；新增测试必须完成变红自证。Android 运行态按“空白安装→固定样本导入→触发淘汰→重启→清理”记录分项占用与未覆盖项。
- [ ] 如需向前端暴露缓存统计/清理，先在 IPC.md 定义 Command、返回模型和错误语义，再实现并注册；本阶段不得预注册 stub。数据库优先复用 V2 的 `cache_size_bytes`/`last_accessed_at`，字段不足时只追加迁移。

### 7. B2 完成标准

- [ ] 所有后端业务能力都有真实服务实现、IPC 契约、数据库迁移（如需要）、错误语义和自动化测试。
- [ ] 搜索任务可取消、可查询、可重建，资源预算和来源失效行为可验证。
- [ ] Android 发布制品存在可重复分项基线并通过绝对上限与 10% 回归门禁；运行时可重建数据具备软/硬上限、真实 LRU、活动租约保护、低存储错误和可验证清理语义。
- [ ] 不存在“前端已接入但后端未实现”的 Command、假数据或临时本地状态替代品。

## B3 后端验证与契约冻结

- [ ] Windows 运行态回归：导入、封面、打开、资源链、删除、重新定位、进度、批注、设置、搜索、系列、标签和重启恢复。
- [ ] Android 静态链审计和 B1 首次实机来源链门禁已完成；补做 B2 搜索任务与缓存淘汰回归，低存储/长期压力按批准的受控 Android 虚拟设备例外执行；未通过时不得完成全平台 B3 冻结或开始 Android 前端功能接入。
- [ ] 以干净 arm64 release 候选复测 APK/AAB、原生库、前端 `dist`、空白安装和固定样本运行时占用；确认无调试段、测试 EPUB、预置缓存，且绝对上限、10% 回归门禁及缓存总预算均通过。
- [ ] 运行 `cargo fmt --check`、`cargo check`、完整 `cargo test`、`npm.cmd run build` 和 `npm.cmd run tauri build`，记录版本、测试数量和已知警告。
- [ ] 完成文档审计：README、ARCHITECTURE、DATABASE、IPC、CONVENTIONS、ROADMAP、TODO、SECURITY 与实现一致。
- [ ] 建立后端契约冻结点：冻结 Command、模型、错误前缀、数据库字段、资源预算和来源状态语义。

## F1–F3 前端（B3 通过后才解锁）

以下任务在后端冻结前全部保持未开始：

- [ ] F1 重建应用壳层、导航、书架信息架构、加载/空/错状态；替换 legacy shell。
- [ ] F1 只消费冻结 IPC；不得在 React 解析 ZIP/XML/SQLite 或自行判断来源有效性。
- [ ] F2 接入阅读器、目录、搜索、批注、系列、标签、设置、来源重新定位和全屏等功能。
- [ ] F2 将 EPUB.js 生命周期、CFI 视口锚定、iframe 事件和交互状态集中在 `src/features/reader/engine/`。
- [ ] F2 在真实 Android 设备验证书架、阅读器、目录、搜索、批注、设置、图片查看和来源重新定位。
- [ ] F3 建立 Tailwind 视觉系统、响应式布局、可发现控件、键盘/触摸补充交互、深色模式和跨端细节。
- [ ] F3 完成 Windows/Linux/Android 运行态人工验收；Android 必须覆盖手势、窄屏、软键盘、性能、内存、耗电、系统/WebView 版本和发布候选回归；构建通过不等于体验完成。

## 后续扩展冻结说明

- P3 多格式和 P4 外部网盘均不属于当前执行看板；阅读器本体的 B0–B3、F1–F3 完成前不得启动。
- P3 固定顺序为：P3.0 多格式架构与 `ImportInspector` → P3.1 TXT → P3.2 CBZ/纯图片 ZIP → P3.3 PDF → P3.4 CBR → P3.5 通用 ZIP 分发包。
- ZIP 只作为分发容器或 CBZ 兼容图片归档，不增加 `BookFormat::Zip`；现有 `zip` crate 不代表通用 ZIP/漫画能力已经获批。
- P4 排在 P3.5 之后，只在路线图中保留方向；当前不新增远程 `source_kind`、账号/令牌 Schema、Provider Command、网络依赖或前端入口。
- 远程书籍来源与阅读进度/批注的跨设备同步是两项不同能力；后者未进入当前路线图实施范围。

## 历史记录

- 2026-08-14：撤回 B0 完成证明。保留桌面构建与 67/67 绿色执行事实，但 V1/V3 新增迁移回滚测试缺少变红自证，Android 官方构建也不能从干净 scaffold 稳定复现；两项均是 B0 缺口。Android 导入偶发卡住属于 B1 运行态缺口。前端 `fetch(epub://...)` 不属于 B0 后端判定。后续修改方向见 [BACKEND_AUDIT.md](BACKEND_AUDIT.md) 0.2.5、0.4 与缺口清单。
- 2026-08-14：B0 完成证明重新签发——V1/V3 回滚测试完成变红自证、Android 官方干净构建通过；B1 缺口 #1/#2/#3/#4 关闭（services 下沉、错误前缀统一、Range + 并发 Reader + 资源读取测试）；`cargo test` 85/85、`cargo fmt --check` 与 `audit:check` 通过。剩余：Android 导入偶发卡住（B1 门禁，缺口 #7）。
- 2026-08-14：B1 缺口 #7 关闭——导入卡住根因 tauri#14994（wry MainPipe 唤醒）以 200ms 唤醒窗口 workaround 修复并黑鲨 30 轮验证；B1 Android 后端/平台首次实机门禁通过。Codex 提出的 8 项修改方向全部完成。
- 2026-08-14：Phase 1 Windows 桌面 EPUB 基线、来源重新定位和 CFI 恢复保留历史验收记录；Android 工具链、官方 debug 构建和 B1 首次实机门禁均已完成，仍无自动化设备验收流水线。
- 2026-08-15：B2 新增 Android 制品与运行时存储预算规划。旧/中间产物曾显示 151.08 MiB；当前官方 arm64 debug APK 实测 310,548,144 字节（296.16 MiB），Rust 原生库 145.08 MiB，另有约 144.20 MiB ZIP 对齐/保留空洞。两者都不得外推 release 体积；当前应用私有数据约 31.45 MiB，其中来源缓存约 26.82 MiB、封面约 3.99 MiB。release 基线尚未建立，预算任务保持未完成。
- 2026-08-15：B2 搜索与索引服务完成真实实现并完成 132/132 桌面测试、变红自证和当前 APK 的取消/进程恢复复测；修复索引预算对 UTF-8 中日韩文本按字符而非字节计数的缺陷，新增单任务 2 GiB 累计预算溢出/超限测试、SQLite 非满盘 I/O 不误报资源耗尽的回归测试，以及内存错误对象覆盖 Android 缓存存储错误，不填充设备存储；黑鲨 Android 9 通过系统 picker 导入 13.20 MiB EPUB，验证超限章节明细，并以一次性诊断探针释放 SAF 授权后确认索引进入 `BOOK_SOURCE_UNAVAILABLE`；另记录七卷 135/135 重建期间主库 11,640,832 B、峰值 rollback journal 8,309,808 B；来源恢复/临时数据已清理。低存储、长期/2 GiB 压力仍未完成。
- 2026-08-15：B2 搜索复核修复同系列并发任务竞争、错误状态非事务写入/全系列错误扩散、合法 OPF 相对及百分号编码 href、短词 LIKE 通配符误匹配；新增 5 个测试均以恢复旧缺陷确认目标变红后再恢复变绿。SQLite 满盘测试使用受限 `max_page_count` 的真实写事务，确认稳定资源错误并保留旧索引；完整 `cargo test` 137/137，`audit:unwrap` 348 行/355 次。IPC 专门边界确定当前书章节内查找留给 F2 EPUB.js，同系列/多卷全文搜索由 B2 后端负责。低存储/长期压力经批准延期至受控 Android 虚拟设备，尚未勾选。
