# B3 后端契约冻结候选

日期：2026-08-24
分支：`codex/b3-contract-freeze`
状态：**候选冻结，未签发**。Windows legacy shell 实际具备的运行态链、系列/标签后端契约、B1/B2 Android 后端范围、当前 arm64 静态候选以及两台真实 arm64 设备的空白安装/首次启动均已关闭；当前仍缺固定样本运行时占用、release 私有 data 精确分项和正式 release 签名。因此本文件记录当前实现边界，但尚不正式解锁 F1/F2。

## Command 契约

- `src-tauri/src/lib.rs` 的 `invoke_handler` 注册 44 个 Command。
- `src/lib/tauri.ts` 的 `invoke<T>` 封装为 44 个；本次脚本比对结果为注册项与封装项双向无缺口。
- 44 个注册项都能在 `IPC.md` 的 Phase 1/B2 Command 定义中定位；未实现能力没有注册 stub。
- 本轮没有增删 Command，也没有改变参数、返回模型或错误前缀。

## 模型契约

Rust `src-tauri/src/db/models.rs` 与 TypeScript `src/types/models.ts` 保持 snake_case 字段镜像，当前冻结对象包括：

- 来源与书籍：`BookFormat`、`SourceKind`、`BookStatus`、`Book`、`BookSummary`、`SelectedSource`、`OpenBookResult`；`BookSummary` 不携带 `source_locator`/`source_kind`。
- 阅读状态：`ReadingProgress`、`ReadingSettings`、`BookReadingSettings`、`ReadingSettingsResult` 及对应输入模型。
- 业务数据：`Note`、系列/卷标/排序模型、标签组/标签/直接与继承标签模型。
- 搜索：`SearchTaskStatus`、`SearchIndexStatus`、`SearchResult`；`SearchResult.cfi` 在 B2 保持 `null`，由 EPUB.js 打开目标 href 后解析精确 CFI。

重要枚举值：

- `BookStatus`：`available`、`missing`、`error`。
- `SourceKind`：`desktop_path`、`android_content_uri`。
- 阅读主题/字体/流式/跨页：分别遵守 `IPC.md` 与 TypeScript 联合类型中的固定集合。
- 搜索索引持久状态：`pending`、`building`、`ready`、`error`；取消、重建、进程中断通过既定错误/恢复语义处理，不新增第五种数据库状态。

## 数据库契约

迁移只追加、不改写历史迁移：

| 版本 | 冻结内容 |
| --- | --- |
| V1 | `books`、`reading_progress`、`notes` 及书籍状态、来源指纹和级联约束 |
| V2 | 来源缓存元数据、系列与 `book_series`、标签组/标签/关系、阅读设置旧字段、搜索文档/FTS/索引状态 |
| V3 | 阅读设置的字号、行距、段落距、首行缩进、边距和最大列宽字段扩展与旧值转换 |
| V4 | 只规范未被用户修改的初始全局设置边距；不重写用户已有设置 |

关系与恢复语义：`book_series.book_id` 主键保证单书单系列归属；书籍删除级联进度、批注、缓存元数据和关系；来源缓存、封面和搜索索引是可重建数据，保存型业务数据仍由 SQLite 保留。

## 错误契约

公共错误保持稳定前缀并由 `src/lib/tauri.ts` 统一映射：

- 来源/资源：`BOOK_SOURCE_UNAVAILABLE:`、`BOOK_RESOURCE_NOT_FOUND:`、`BOOK_RESOURCE_LIMIT_EXCEEDED:`、`BOOK_RELOCATION_MISMATCH:`、`SAF_PERMISSION_DENIED:`。
- 业务对象：`BOOK_NOT_FOUND:`、`NOTE_NOT_FOUND:`、`SERIES_NOT_FOUND:`、`TAG_NOT_FOUND:`、`TAG_GROUP_NOT_FOUND:`。
- 解析与能力：`BOOK_PARSE_FAILED:`、`FORMAT_NOT_SUPPORTED:`、`VALIDATION_ERROR:`、`INTERNAL_ERROR:`。
- 搜索：`SEARCH_INDEX_UNAVAILABLE:`、`SEARCH_INDEX_CANCELLED:`、`SEARCH_INDEX_INTERRUPTED:`。

错误详情不透传原始 SQL、堆栈或完整敏感 locator；`BookSummary` 和列表 Command 继续遵守来源路径/URI 隔离边界。

## 资源预算与来源状态

- 来源缓存：软上限 256 MiB，硬上限 512 MiB；活动 `SourceLease` 保护当前读者，持久化 `last_accessed_at` 决定真实 LRU。
- 封面缓存：软上限 64 MiB，硬上限 128 MiB；候选写入原子化，数据库引用和文件清理按失败可恢复顺序执行。
- 搜索索引：持久文本账面硬上限 256 MiB。
- 可重建数据实际硬预算：`512 + 128 + 256 = 896 MiB`；另有 1 GiB 总 ceiling。预算常量由 `resource_budget.rs` 与自动化测试冻结。
- 真实来源状态使用 `available/missing/error`；来源失效不泄露 locator，重新定位必须经平台来源选择与指纹/元数据校验。启动时协调孤儿、缺失和大小不符的可重建缓存。

## 证据与未签发条件

2026-08-24 当前提交已取得的证据：`cargo fmt --check`、`cargo check`、完整 `cargo test` 181/181、`npm.cmd run build`、`npm.cmd run audit:check`、`npm.cmd run audit:android-release` 和 Windows x64 `npm.cmd run tauri build` 均通过。当前 arm64 APK/AAB 重新生成，完整 `:app:lintArm64Release` 为 0 error、31 warning、1 hint；静态分项、哈希、ABI/ELF 与未测范围见 [B3_ANDROID_RELEASE_CANDIDATE.md](B3_ANDROID_RELEASE_CANDIDATE.md)。Command 与模型对照来自当前工作树。

边界裁决与已关闭条件：

- Windows UI 已在不改变既有用户数据的前提下，以隔离 fixture 完成开发态导入、删除和失效来源重新定位；其余 legacy shell 运行态见 [B3_WINDOWS_RUNTIME.md](B3_WINDOWS_RUNTIME.md)。系列/标签管理 UI 按 ROADMAP 属于 F2，B3 只要求其真实 Rust/IPC/事务契约与自动化覆盖，避免形成先做 F2 才能通过 B3 的循环门禁。
- B1 真实设备来源链与 B2 受控 AVD/黑鲨证据按各自覆盖范围直接接受；更广 OEM、WebView、性能、手势和完整前端消费矩阵归 F2/F3，不重复作为后端冻结前置。封面公共保护重叠 hard-limit 仍诚实保留辅助逻辑边界。

仍未满足冻结签发条件：

- 两台真实 arm64 设备已取得空白安装、首次启动、ABI、WebView 和主进程内存证据；但固定 EPUB 导入后的运行时占用仍未执行，release 私有 data 精确字节分项因 release 不可 `run-as` 未取得。
- 当前设备复测使用同一 unsigned release payload 的本地 debug-keystore 签名副本；正式 release 签名仍未完成，不能把该副本当作发布签名证明。
- 正式签发前须补齐上述剩余证据并复核 [B3_ANDROID_RELEASE_CANDIDATE.md](B3_ANDROID_RELEASE_CANDIDATE.md) 中的当前 APK/AAB 哈希。
- 因此本文件仍是候选冻结快照，不表示 B3 已完成，也不解锁 F1/F2 的生产开发。
