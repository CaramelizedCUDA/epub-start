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

- [x] 审计 `src-tauri/src` 生产代码：`panic!`/`todo!`/`unimplemented!`/`unreachable!` 0 处；由 `npm run audit:unwrap` 自动统计为 575 行（共 590 次调用），当前 B2 Android 存储收口最终复核，全部在 `#[cfg(test)]` 测试模块；生产 `.expect()` 仅 `lib.rs` 事件循环收口；锁 poisoning 均映射为错误。未统计 `src-tauri/target` 生成代码。
- [x] 审计 44 个 `#[tauri::command]`：全部为薄适配；3 个历史缺口已关闭，B2 搜索 5 个 Command、系列关系读取和标签读取/筛选 Command 已接入真实服务，见 [BACKEND_AUDIT.md](BACKEND_AUDIT.md) 注册清单。
- [x] 审计 `lib.rs` 启动错误语义：setup 内目录/数据库/迁移失败均映射为带上下文错误传播，无启动期 panic 掩盖；唯一 `expect` 为 Tauri 事件循环收口（低风险，可选修复）。
- [x] 生成 Command 注册清单并三方比对：Rust 44 == IPC.md 44 == `tauri.ts` 44，命名一致；B2 搜索 5 个 Command 已接入真实服务；21 个系列/标签 wrapper 前端未调用（legacy shell 冻结，F2 接入）；发现并修复 IPC.md 缺少 `BOOK_RESOURCE_NOT_FOUND:` 行、系列关系读取以及标签读取/筛选契约的文档缺口。
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

- [x] Rust 核心模块完成自动化测试：正常路径、错误路径、恶意输入、来源失效、权限失败和资源耗尽均有覆盖（当前 175/175；搜索专项覆盖清单见 BACKEND_AUDIT.md 0.2.5，目录/搜索契约见 0.2.6，系列关系见 0.2.7，标签关系/筛选见 0.2.8，阅读设置见 0.2.9，批注数据契约见 0.2.10，Android 制品/缓存见 0.2.13；桌面对话框类运行态与 Android Kotlin/WebView/低存储行为按三类口径标注，不计入自动覆盖）。
- [x] `cargo fmt --check`、`cargo check`、完整 `cargo test` 通过（当前 181/181；测试数 85→181，B2 搜索、目录/搜索、系列、标签、阅读设置、批注及缓存收口/复核测试均完成变红自证）。
- [x] IPC、模型、数据库和安全文档已同步（B2 新增 5 个真实搜索 Command、`list_series_books`、`list_series_tags` 与 `filter_books_by_tags`，目录/搜索资源接口、系列/标签关系读取、筛选、阅读设置 V4 默认归一、批注纯文本/CFI/长度/颜色/重启恢复契约，以及 Android 制品/缓存预算与延期验收边界已登记；BACKEND_AUDIT.md 已同步 audit:unwrap 自动统计 575 行/590 次）。

## B2 后端业务能力（当前阶段）

### 4. 搜索与索引（真实后台实现）

- [x] 设计并实现同系列/多卷搜索需要的后端任务模型：任务 ID、状态、进度、取消、错误、结果上限、同系列任务原子去重和来源失效（桌面自动验证；真实黑鲨 Android 9 已有取消、进程终止与重建记录并直接作为当前证据；受控 AVD closeout 另验证活动读者在索引 `building` 时完成 2 次翻页，最终 `10/10 ready`，以及来源 hard-limit 场景 `4,900/4,900 ready`）。当前书章节内查找按 IPC 留给 F2 EPUB.js，不冒充后端索引能力。
- [x] 使用 bundled SQLite FTS5 trigram 建立惰性增量索引；查询短于 3 个字符时使用参数化 `LIKE`。
- [x] 索引按来源指纹失效，支持部分结果、手动重建和过期重建；实现未把整本 EPUB 一次性读入 `Vec<u8>`。
- [x] 执行预算：单章节 8 MiB、单书 64 MiB；提取计数使用溢出检查。一次索引任务累计提取量 2 GiB 已由辅助逻辑与受控 AVD 补充压力共同验证：6×46 固定 fixture 的逻辑累计输入为 `2,352,070,068` 字节；不外推唯一物理 2 GiB 或多样内容。
- [x] 搜索索引持久化文本账面硬上限 256 MiB；超限保持事务一致性并返回 `BOOK_RESOURCE_LIMIT_EXCEEDED:`。黑鲨 Android 9 七卷 135/135 重建期间实测 `epubstart.db` 11,640,832 B、峰值 rollback journal 8,309,808 B，未出现 `-wal`；补充 6 GiB AVD 低余量索引运行态返回 `BOOK_RESOURCE_LIMIT_EXCEEDED: search index storage is full`，峰值主库 111,452,160 B、rollback journal 411,888 B，清理后 `integrity_check=ok`。WAL/SHM 未观察到，不把它们写成已使用或已通过。
- [x] 覆盖 spine 顺序、中日韩文本、OPF 相对/百分号编码 href、短词 LIKE 字面 `%`/`_`/反斜杠、三字以上 trigram、跨章节结果、取消、同系列任务原子去重、结果上限、未就绪错误、损坏章节、章节资源超限、提取计数溢出、索引预算超限、单任务 2 GiB 累计预算、错误状态事务回滚，以及真实 SQLite `SQLITE_FULL` 到 `BOOK_RESOURCE_LIMIT_EXCEEDED:` 的映射与旧索引保留；新增测试均完成“注入错误→目标测试变红→恢复变绿”。Android 缓存常见存储耗尽 OS 错误的稳定前缀映射仍由内存错误对象覆盖；未替代 Android 低存储运行态。
- [x] 注册并记录真实搜索 Command：`ensure_series_search_index`、`get_search_index_status`、`cancel_search_index`、`search_series`、`rebuild_search_index`。
- [x] 在 Android 真实设备验证索引取消与应用进程被系统终止后的恢复：当前 APK 在黑鲨 Android 9 上七卷系列取消后保留 101/135 章节部分结果；force-stop 后重启状态恢复为 `pending`（101/135），重新执行后恢复到 135/135 `ready`。
- [x] 在 Android 真实设备以系统 picker 导入 13.20 MiB EPUB，并验证大章节索引限制：章节超过 8 MiB 得到 `ready`、0/1 且保留超限明细；此前已持久 URI 重拷贝并恢复原 EPUB 到 34/34。该证据覆盖单次大文件导入，不等于长期/2 GiB 压力。
- [x] **受控 Android 虚拟设备收口（限定范围，2026-08-23）：** 按 [ANDROID_STORAGE_ACCEPTANCE.md](ANDROID_STORAGE_ACCEPTANCE.md) 已完成活动读者与后台索引并发（`building` 中 2 次翻页，最终 `10/10 ready`）、来源 hard-limit 拒绝（补充 6 GiB AVD，保护租约时返回稳定资源错误，慢索引 `4,900/4,900 ready`）、ENOSPC/SQLite 低余量峰值、复制中断/重试、6 轮×46 固定 fixture 的 `2,352,070,068` 字节逻辑累计压力，以及 4 本书/2 个系列/4 条关系/标签/设置/进度/批注和来源/封面/两个索引的综合恢复；完整 Gradle release lint 也已通过。封面 hard-limit 的公共 Android 路径只观察到 admission 串行化和软淘汰，保留辅助逻辑证据，不伪造受保护三候选重叠拒绝。真实黑鲨 Android 9 的取消、进程终止与重建记录直接接受，不在 AVD 重复；更广 OEM/真实设备矩阵移至 B3/F2。长期压力使用同一固定 EPUB，不外推唯一物理 2 GiB 或内容多样性；受控 AVD 例外仍不替代 SAF Provider、OEM 进程管理、性能或手势实机证据。

### 5. 目录、系列、标签、设置和批注后端收口

- [x] 固定目录/搜索所需的后端资源与错误契约（2026-08-17）：目录链统一使用 `open_book.epub_root_url -> ResourceProvider` 提供 `container.xml`、OPF、NAV/NCX、spine 与关联资源，不新增目录 Command；搜索提取改经 `ActiveFormat -> SearchContentProvider`，删除未实现的 `TocProvider`/`TextContentProvider` 占位接口；后端返回 `book_id + spine_index + OPF href`，提取及 LIKE/trigram 查询的 `cfi` 固定为 `null`，精确 CFI 留给 EPUB.js；资源协议补齐脱敏与 400/404/413/422/500/501 稳定映射。已测（辅助逻辑/自动化）：四类控制/导航资源正文与 MIME、格式分派与解析错误、来源前缀脱敏、协议状态、旧伪 CFI 不再返回，新增 2 个及强化 5 个测试均完成目标变红→恢复变绿，完整 `cargo test` 139/139、`cargo fmt --check`、`cargo check`、`npm.cmd run build` 通过。未测：桌面 EPUB.js 的完整 NCX/NAV 运行态链（待人工验证）；Android WebView 同链路与版本矩阵（阻塞至 B3 设备回归）。
- [x] 完成系列 CRUD、单系列归属、卷标、排序和关系事务（2026-08-17）：新增 `list_series_books` 只读 Command/服务 seam，按 `sort_order, book_id` 返回完整关系；系列名称冲突稳定映射为 `VALIDATION_ERROR:`，卷标修剪后限制 200 字符；单书归属由 `book_series.book_id` 主键与 UPSERT 保证，重排语句失败或 `COMMIT` 失败均回滚并释放事务。已测（辅助逻辑/自动化）：CRUD/名称修剪/审计字段保留、大小写不敏感重复名、缺失实体、并发创建、单系列替换、关系读取与排序、卷标 200/201 边界、重复/越界重排拒绝、成功重排、后段更新失败回滚、提交失败回滚释放、删系列仅级联关系不删书；新增 7 个测试及卷标强化均完成目标变红自证，完整 `cargo test` 146/146、`cargo fmt --check`、`cargo check`、`npm.cmd run build` 通过。未测：桌面 legacy shell 对系列 Command 的实际运行态消费（待 B3/F2 人工验证）；Android 同链路与 OEM/进程恢复矩阵（阻塞至 B3 设备回归）；当前应用只有单进程 `Mutex<Connection>`，未声称多进程/多连接并发语义。
- [x] 完成标签组/标签 CRUD、书籍直接标签、系列继承标签、筛选查询和删除关系语义（2026-08-17）：新增 `list_series_tags` 与 `filter_books_by_tags`，筛选按全部所选有效标签（直接或系列继承）匹配并以 `COUNT(DISTINCT tag_id)` 去重，返回无来源字段的 `BookSummary[]`，按 `updated_at DESC, title NOCASE, id` 稳定排序；标签组/同组标签 NOCASE 冲突映射为 `VALIDATION_ERROR:`，关系替换保持单事务，删除标签组只取消分组，删除标签只级联关系。已测（辅助逻辑/自动化）：CRUD、名称/颜色规范化、审计字段保留、同组冲突/跨组同名、缺失实体、系列标签读取排序、直接/继承标记与去重、AND 筛选、空/重复/缺失筛选 ID、书籍/系列关系失败保留、标签组/标签删除后的定义/关系/所有者语义；新增 4 个测试均完成目标变红自证，catalog 专项 24/24、完整 `cargo test` 150/150、`cargo fmt --check`、`cargo check`、`npm.cmd run build` 通过。未测：桌面 legacy shell 对标签 Command 的实际运行态消费（待 B3/F2 人工验证）；Android 同链路与 OEM/进程恢复矩阵（阻塞至 B3 设备回归）；当前应用只有单进程 `Mutex<Connection>`，未声称多进程/多连接并发语义。
- [x] 完成全局/单书阅读设置的持久化、逐字段覆盖、默认值和迁移回归（2026-08-17）：`settings_service` 负责全局整行保存、单书可空字段覆盖、有效值合并和清除恢复；补充 V4 只归一未修改 V2 默认行，保留已保存旧值。已测（辅助逻辑/自动化）：全字段默认值、全局/单书保存与写入后重新读取、逐字段继承、全局变更后的继承更新、清除覆盖、空覆盖清空字段、未知图书错误、全局验证失败保留旧值、V3 旧字段全量转换、单书 NULL 保持继承、V4 默认值修正及提交步骤失败回滚；新增 4 个设置测试与 1 个迁移回滚测试均完成目标变红→恢复变绿，完整 `cargo test`、`cargo fmt --check`、`cargo check`、`npm.cmd run build` 通过。未测：桌面 legacy shell 的设置运行态与 EPUB.js 重排消费（待 B3/F2 人工验证）；Android WebView/设备矩阵与进程恢复运行态（阻塞至 B3）；真实损坏数据库、断电/满盘恢复；当前应用只有单进程 `Mutex<Connection>`，不声明多进程/多连接并发语义。
- [x] 完成批注数据契约的最终审计（2026-08-18）：`notes_service` 对创建/更新字段先修剪外层空白，`cfi_start`/`cfi_end` 必须非空，空白 `cfi_range` 归一为 `NULL`；单个 CFI、选中文本与正文分别限制为 4,096/10,000/20,000 个 Unicode 字符，类似 HTML 的内容只按字面纯文本往返，颜色统一为小写 `#RRGGBB`，更新保留 `book_id/created_at`。已测（辅助逻辑/自动化）：创建/更新/读取/删除、纯文本字面值、空白规范化、Unicode 精确边界与越界、CFI 完整往返、颜色合法性、缺失图书/批注错误、失败更新保留、并发创建、真实文件数据库关闭重开后的全部恢复字段、删书后通过服务 seam 观察到 `NOTE_NOT_FOUND:`；新增 3 个测试并强化 2 个测试，均完成目标变红→恢复变绿，notes 专项 21/21、完整 `cargo test` 158/158、`cargo fmt --check`、`cargo check`、`npm.cmd run build` 通过。未测：桌面 legacy shell/EPUB.js 的真实选区、高亮、跳转与应用重启恢复（待 B3/F2 人工验证）；Android WebView、OEM 进程恢复和设备矩阵（阻塞至 B3/F2）；真实损坏数据库、断电/满盘恢复及多进程/多连接并发语义。

### 6. Android 制品与运行时存储预算

- [x] 建立并收紧 arm64 release 体积报告与 B2 最终静态基线：外部 Android 子项目 build 目录改到工程内，desktop dialog 依赖/Capability 从 Android 构建隔离，原 `tauri-plugin-fs/android/.tauri/tauri-api` 冲突关闭；2026-08-22 最终记录 APK 11,557,632 B、AAB 11,365,807 B、Cargo `.so` 13,040,288 B、打包 `.so` 8,951,720 B、`dist` 595,644 B 与工具链。未删除 Cargo 全局缓存、未提交 `.so`/build 产物。
- [x] 实施静态发布门禁：`npm run audit:android-release` 检查 arm64 release APK ≤ 40 MiB、Rust 原生库 ≤ 30 MiB、前端 `dist` ≤ 2 MiB、相对基线增长 ≤10%、Node/npm/rustc/cargo/JDK/Gradle/AGP/NDK/Tauri CLI/Tauri crate，以及 APK 与 AAB 各自的 ABI、ELF 调试段和禁止 payload；APK 1 B 基线、Node 漂移和 AAB 错误 ABI 三类注入均按预期失败，恢复后通过。放宽预算需人工批准并同步路线图和安全文档。
- [x] 明确并实现 debug/profile/release 用途：debug 用于 native/JNI 诊断；profile 使用 release Rust、独立包名、可调试应用、关闭 JNI debug/R8 和 debug 签名；release 使用 release Rust/R8。arm64 与 x86_64 profile APK/AAB 已作制品级检查，未发现打包 ELF 调试/符号表或测试 EPUB；空白安装 code/data 不在本条声称范围。
- [x] 将 Android 来源缓存实施为软上限 256 MiB、硬上限 512 MiB；命中以单调值更新 `source_cache_entries.last_accessed_at`，按持久化真实 LRU 淘汰；`SourceLease` 在缓存检查前注册，淘汰持有同一 registry 锁至元数据和文件清理完成，关闭 TOCTOU；原子复制/指纹失败清理临时文件，启动协调孤儿/缺失/大小不符状态并重新执行预算，无法安全淘汰或 SQLite 满盘时返回稳定资源错误。
- [x] 为封面缓存实施软上限 64 MiB、硬上限 128 MiB：原子候选、并发候选共享同一硬预算、导入失败/替换/删书清理、启动时事务清除缺失/越界路径与孤儿；淘汰先更新数据库再删文件并按 `books.updated_at, id` 排序，不把不可观测 asset 命中冒充 LRU。来源 512 + 封面 128 + 搜索 256 = 896 MiB 实际硬预算，另以 1 GiB ceiling 约束总和。
- [x] 自动化覆盖缓存命中时间、真实文件大小、持久 LRU、活动租约、硬上限、重启预算、孤儿/缺失协调、原子候选、失败清理、并发候选与 ENOSPC/SQLite full 稳定映射；初始新增 17 个测试，复核新增 6 个并强化 1 个，均完成目标步骤变红→恢复变绿，完整套件 181/181。未覆盖 Android 真实磁盘、进程和文件系统行为。
- [x] 保持缓存统计/清理为后端内部维护，不新增公开 Command 或 stub；V2 字段足够，本次无迁移。
- [x] **完整 Gradle release lint（2026-08-23）：** 从阿里云 Maven 镜像取得四个缺失 AndroidX 制品及 JUnit/Hamcrest 元数据，使用既有 Gradle module SHA-256 与 Maven Central SHA-1 校验后组装独立本地 Maven 仓库；未手工改写 Gradle 缓存。补齐依赖后首次真实 lint 以 scaffold 遗留的 `MissingTvBanner` / `ImpliedTouchscreenHardware` 两条 error 变红；项目不支持 Android TV，移除 Leanback feature/category 后，`:app:lintUniversalRelease` 与 `:app:lintArmRelease` 均 `BUILD SUCCESSFUL`，各为 0 error、31 warning、1 hint。未处理非阻塞 warning，也未把此前跳过 lint 生成的 APK/AAB 追认为完整发布候选。
- [x] **Android B2 受控环境收口（限定范围，2026-08-23）：** 受控 AVD 已完成活动读者与后台索引并发（索引 `building` 中完成 2 次翻页，最终 `10/10 ready`）、来源 hard-limit 拒绝（补充 6 GiB AVD，保护租约时返回稳定资源错误，慢索引 `4,900/4,900 ready`）、复制中断/重试、来源复制 ENOSPC、SQLite 低余量峰值、6 轮×46 固定 fixture 的 `2,352,070,068` 字节逻辑压力，以及 4 本书/2 个系列/4 条关系/标签/设置/进度/批注和来源/封面/两个索引的综合恢复。完整 Gradle release lint 也已通过。封面 hard-limit 的公共 Android 路径只观察到 admission 串行化和软淘汰，保留辅助逻辑证据，不伪造受保护三候选重叠拒绝；真实黑鲨 Android 9 的取消、进程终止与重建记录直接接受，不在 AVD 重复；更广 OEM/真实设备矩阵移至 B3/F2。证据见 `target/android-b2-runtime-closeout-20260823`、`target/android-b2-acceptance-20260822-184117`、`target/android-b2-closeout-20260822`、`target/android-b2-pressure-20260823-direct` 与 `target/android-b2-recovery-20260823`。长期压力使用同一固定 EPUB，不外推唯一物理 2 GiB 或内容多样性；受控 AVD 例外仍不替代 SAF Provider、OEM 进程管理、性能或手势实机证据。

### 7. B2 完成标准

- [ ] 所有后端业务能力都有真实服务实现、IPC 契约、数据库迁移（如需要）、错误语义和自动化测试。
- [ ] 搜索任务可取消、可查询、可重建，资源预算和来源失效行为可验证。
- [ ] Android 发布制品存在可重复分项基线并通过绝对上限与 10% 回归门禁；运行时可重建数据具备软/硬上限、真实 LRU、活动租约保护、低存储错误和可验证清理语义。
- [ ] 不存在“前端已接入但后端未实现”的 Command、假数据或临时本地状态替代品。

## B3 后端验证与契约冻结

- [ ] Windows 运行态回归：导入、封面、打开、资源链、删除、重新定位、进度、批注、设置、搜索、系列、标签和重启恢复。本轮已覆盖开发态/release 的打开、封面、资源链、目录、搜索、批注、设置、进度、全屏和基础重启；另以隔离 fixture 在开发态补齐导入、删除和失效来源重新定位。系列/标签消费仍未覆盖，详见 [B3_WINDOWS_RUNTIME.md](B3_WINDOWS_RUNTIME.md)。
- [ ] Android 静态链审计和 B1 首次实机来源链门禁已完成；补做 B2 搜索任务与缓存淘汰回归，低存储/长期压力按批准的受控 Android 虚拟设备例外执行；未通过时不得完成全平台 B3 冻结或开始 Android 前端功能接入。
- [ ] 以干净 arm64 release 候选复测 APK/AAB、原生库、前端 `dist`、空白安装和固定样本运行时占用；确认无调试段、测试 EPUB、预置缓存，且绝对上限、10% 回归门禁及缓存总预算均通过。
- [ ] 运行 `cargo fmt --check`、`cargo check`、完整 `cargo test`、`npm.cmd run build` 和 `npm.cmd run tauri build`，记录版本、测试数量和已知警告。
- [ ] 完成文档审计：README、ARCHITECTURE、DATABASE、IPC、CONVENTIONS、ROADMAP、TODO、SECURITY 与实现一致。
- [ ] 建立后端契约冻结点：冻结 Command、模型、错误前缀、数据库字段、资源预算和来源状态语义。
- 当前已形成候选冻结清单 [B3_CONTRACT_FREEZE.md](B3_CONTRACT_FREEZE.md)，但因 Windows/Android 运行态缺口仍未签发。

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
- 2026-08-17：B2 第五节首项完成。目录链冻结为 `epub_root_url + ResourceProvider`，搜索文本冻结为 `ActiveFormat + SearchContentProvider`；移除未实现能力占位，修复资源协议错误映射/来源脱敏，并停止生成或返回伪 CFI。新增 2 个、强化 5 个测试均完成变红自证；完整 `cargo test` 139/139，`audit:unwrap` 354 行/361 次。桌面 EPUB.js 与 Android WebView 的 NAV/NCX 运行态仍分别标记待人工验证/阻塞至 B3。
- 2026-08-17：B2 第五节第二项完成。新增 `list_series_books` 并同步 Rust/IPC/TypeScript，补齐重启后可恢复的系列关系读取；重复系列名改为稳定校验错误，卷标修剪后限制 200 字符，关系事务在语句失败和 `COMMIT` 失败时都回滚释放。新增 7 个测试及 1 个卷标强化均完成目标变红自证；完整 `cargo test` 146/146，`audit:unwrap` 388 行/395 次。桌面消费待 B3/F2 人工验证，Android 消费阻塞至 B3 设备回归。
- 2026-08-17：B2 第五节第三项完成。新增 `list_series_tags` 与 `filter_books_by_tags` 并同步 Rust/IPC/TypeScript；筛选按直接/继承有效标签的 AND 语义匹配、去重并返回稳定排序的 `BookSummary[]`，标签组/同组标签名称冲突改为稳定校验错误，删除与关系事务语义完成收口。新增 4 个测试均完成目标变红自证；完整 `cargo test` 150/150，`audit:unwrap` 426 行/433 次。桌面消费待 B3/F2 人工验证，Android 消费阻塞至 B3 设备回归。
- 2026-08-18：B2 第五节第五项完成。批注创建/更新统一修剪文本字段，空白 CFI 拒绝、空白 range 归一为 `NULL`，冻结 4,096/10,000/20,000 字符上限、小写颜色与字面纯文本语义；新增真实 SQLite 文件关闭重开恢复测试，并把删书级联改为通过服务 seam 观察。新增 3 个测试、强化 2 个测试，5 组均完成目标变红自证；notes 专项 21/21、完整 `cargo test` 158/158，`audit:unwrap` 455 行/462 次。桌面 EPUB.js 批注运行态待 B3/F2 人工验证，Android WebView/设备矩阵阻塞至 B3/F2。
- 2026-08-18：B2 Android 制品/存储代码收口完成。修复 desktop dialog/外部 Android 子项目 build 目录冲突，加入 profile 与 arm64 release 基线/审计门禁；来源缓存完成 256/512 MiB、持久 LRU、活动租约和重启协调，封面完成 64/128 MiB、原子候选、事务化元数据/孤儿清理，统一可重建数据硬上限 896 MiB。新增 17 个测试均完成目标变红自证，完整 `cargo test` 175/175，`audit:unwrap` 550 行/563 次。完整 Gradle lint 的四个 AndroidX 制品受当前沙箱网络权限阻塞；Android 低存储/中断/长期压力等待固定 AVD，故 B2 总完成标准保持未勾选。
- 2026-08-22：B2 收口复核关闭来源租约/淘汰竞态、原子写失败残留、来源/封面元数据失败一致性、封面并发候选预算和 SQLite full 稳定错误缺口；实际 896 MiB 硬预算与 1 GiB ceiling 分离。新增 6 个测试、强化 1 个测试均逐项变红→变绿，完整 `cargo test` 181/181，`audit:unwrap` 575 行/590 次。release 门禁补齐全部基线工具链与 AAB ABI/ELF，最终静态基线收紧；完整 Gradle lint 仍因 Google Maven TLS 握手中断阻塞，无可运行 AVD，故 B2 总完成标准继续未勾选。
- 2026-08-22：补齐 `custom-protocol` Cargo feature 别名并修正 Android 验收文档的真实 `app_data_dir` 路径和 profile 资源打包步骤；正式 x86_64 profile APK 构建成功。受控 AVD 完成新包空白安装、46 份逐份导入、来源缓存 31 条/约 256 MiB、封面 46 个/约 54.1 MB、缺失缓存元数据协调和孤儿清理；SQLite 完整性保持 `ok`。重新定位后的阅读请求暴露 Android WebView 不支持当前 `epub:///localhost/...` URL，活动读取/后台索引未通过；ENOSPC、复制中断、清理重建和六轮 2 GiB 压力仍阻塞。
- 2026-08-22：WebView 修复复测将 Android 根地址切换为 `http://epub.localhost/...`，并在 EPUB.js 请求边界归一化 `null/...`、`epub://localhost/...` 和 `epub:///localhost/...`。使用重新编译的 x86_64 profile APK 在同一 AVD 完成重新定位后的固定 EPUB 单书首屏读取，回归输出 `WEBVIEW_REGRESSION=GREEN`，未出现不支持 scheme、`Failed to fetch`、`epub:///` 或 `localhost:1420`；证据为 `target/android-b2-acceptance-20260822-184117/reader-after-final-fix.png`。后台索引、ENOSPC、复制中断、清理重建和六轮 2 GiB 压力仍未执行。
- 2026-08-22：同一受控 AVD 完成 B2 收口补测：143 MB 有效 EPUB 在 `copy_source_atomically start` 后 force-stop，重启清理临时来源文件且重试成功；全新 profile 在保留约 4 MiB 空间时导入新 locator，UI 返回 `BOOK_RESOURCE_LIMIT_EXCEEDED: source cache copy failed because device storage is full`，清理填充文件后无 `.tmp`；删除 `source-cache/` 与 `covers/` 后单书来源/封面从持久 SAF 来源重建，数据库完整性为 `ok`。证据为 `target/android-b2-closeout-20260822`；后台索引无可观察触发入口，六轮累计 2 GiB、完整业务数据重建和来源/封面 hard-limit 运行态仍未执行，B2 总门禁保持未勾选。
- 2026-08-22：同一受控 AVD 完成 B2 收口补测：143 MB 有效 EPUB 在 `copy_source_atomically start` 后 force-stop，重启清理临时来源文件且重试成功；全新 profile 在保留约 4 MiB 空间时导入新 locator，UI 返回 `BOOK_RESOURCE_LIMIT_EXCEEDED: source cache copy failed because device storage is full`，清理填充文件后无 `.tmp`；删除 `source-cache/` 与 `covers/` 后单书来源/封面从持久 SAF 来源重建，数据库完整性为 `ok`。证据为 `target/android-b2-closeout-20260822`；后台索引无可观察触发入口，六轮累计 2 GiB、完整业务数据重建和来源/封面 hard-limit 运行态当时尚未执行，B2 总门禁保持未勾选。
- 2026-08-23：受控 AVD 完成 B2 长期压力与限定范围综合恢复补测。`target/android-b2-pressure-20260823-direct` 以固定 8,521,993 字节 EPUB fixture 完成 6 轮×46 次 direct IPC/SAF 导入，累计逻辑输入 `2,352,070,068` 字节；每轮分段重启、轮末 force-stop/restart，第 6 轮保留 30 分钟后清理，日志以 `LONG_PRESSURE_DONE` 正常结束。`target/android-b2-recovery-20260823` 先验证启动协调不会凭空重建缓存，再通过持久化 SAF locator 的真实重新导入恢复来源、封面和 `34/34 ready` 索引，同时保留 1 本书、1 个系列、1 条关系。未覆盖来源/封面 hard-limit、索引期间并发活动读取、完整多记录业务、唯一物理 2 GiB 和多样内容；完整 Gradle lint 已在后续同日收口，B2 总门禁仍因其余 Android 运行态矩阵保持未勾选。
- 2026-08-23：完整 Gradle release lint 收口。阿里云镜像下载与独立哈希校验关闭 AndroidX/JUnit/Hamcrest 依赖缺口；`generateReleaseLintModel` 先变绿，完整 lint 随后以 scaffold Leanback TV 声明的两条 error 变红。移除未承诺的 TV 声明后，Universal/Arm release lint 均为 0 error、31 warning、1 hint，且全程未使用 lint baseline、禁用检查或跳过 lint 任务。
- 2026-08-23：启动 B3 Windows 桌面回归；开发态与 x64 release 的打开、资源链、目录、搜索、批注、设置、进度、全屏和基础重启已记录。修复 `section.load()` Promise 被误当回调导致的桌面搜索空结果；导入、删除、失效来源重新定位、系列/标签消费仍待后续覆盖。
