# B3 后端契约冻结候选

日期：2026-08-23  
分支：`codex/b3-contract-freeze`  
状态：**候选冻结，未签发**。Windows 导入/删除/失效来源重新定位/系列标签消费和更广 Android/OEM 矩阵仍未完成，因此本文件记录当前实现边界，不授权前端或平台继续扩展契约。

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

已取得的静态证据：`cargo fmt --check`、`cargo check`、完整 `cargo test` 181/181、`npm.cmd run build`、`npm.cmd run audit:check`、`npm.cmd run audit:android-release` 和 Windows x64 `npm.cmd run tauri build` 均通过；命令与模型对照来自当前工作树。

仍未满足冻结签发条件：

- Windows UI 已在不改变既有用户数据的前提下，以隔离 fixture 完成开发态导入、删除和失效来源重新定位；当前 legacy shell 仍没有系列/标签消费入口。
- Android 更广 OEM/真实设备矩阵与完整前端消费回归仍属于 B3/F2 边界；受控 AVD 证据不能替代它们。
- 因此本文件是审计快照，不表示 B3 已完成，也不解锁 F1/F2 的新功能开发。
