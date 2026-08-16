# IPC 通信契约

本文件是 Tauri Command 的唯一公开接口定义。数据库字段定义以 [DATABASE.md](DATABASE.md) 为准，前端调用位置以 [ARCHITECTURE.md](ARCHITECTURE.md) 为准。serde 结构体字段与 TypeScript 镜像字段使用 `snake_case`；Tauri 扁平 Command 参数键遵循 Tauri v2 调用约定，在 TypeScript 中使用 `camelCase`（例如 Rust `book_id` 对应 `bookId`）。禁止对嵌套 serde 对象做隐式重命名。

项目当前处于后端 B0–B3。此阶段新增能力必须先交付真实 Rust 实现、测试和本文件契约，再允许最小 TypeScript 镜像同步；不得为了展示页面注册 stub Command。通过 B3 后，本文件、serde 模型、TypeScript 镜像、稳定错误前缀和资源预算共同形成前端重建所依赖的契约冻结点。

## 共享模型

Rust 端放在 `src-tauri/src/db/models.rs`（或紧邻其职责的模块），并使用 `serde`：

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BookFormat { Epub, Txt, Pdf, Cbz, Cbr }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind { DesktopPath, AndroidContentUri }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BookStatus { Available, Missing, Error }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub format: BookFormat,
    pub cover_cache_path: Option<String>,
    pub source_locator: String,
    pub source_kind: SourceKind,
    pub file_size_bytes: i64,
    pub last_modified_ts: i64,
    pub package_identifier: Option<String>,
    pub status: BookStatus,
    pub status_detail: Option<String>,
    pub added_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingProgress {
    pub book_id: String,
    pub location_cfi: Option<String>,
    pub progression: Option<f64>,
    pub updated_at: i64,
}
```

TypeScript 镜像放在 `src/types/models.ts`：

```ts
export type BookFormat = 'epub' | 'txt' | 'pdf' | 'cbz' | 'cbr';
export type SourceKind = 'desktop_path' | 'android_content_uri';
export type BookStatus = 'available' | 'missing' | 'error';

export interface Book {
  id: string;
  title: string;
  authors: string[];
  format: BookFormat;
  cover_cache_path: string | null;
  source_locator: string;
  source_kind: SourceKind;
  file_size_bytes: number;
  last_modified_ts: number;
  package_identifier: string | null;
  status: BookStatus;
  status_detail: string | null;
  added_at: number;
  updated_at: number;
}

/** Shelf-safe view — identical to Book except source_locator / source_kind are omitted. */
export interface BookSummary {
  id: string;
  title: string;
  authors: string[];
  format: BookFormat;
  cover_cache_path: string | null;
  file_size_bytes: number;
  last_modified_ts: number;
  package_identifier: string | null;
  status: BookStatus;
  status_detail: string | null;
  added_at: number;
  updated_at: number;
}

export interface ReadingProgress {
  book_id: string;
  location_cfi: string | null;
  progression: number | null;
  updated_at: number;
}
```

实现时 Rust enum 必须使用 serde 的 `snake_case` 重命名策略，以与 TypeScript 字符串联合类型一致；不得改变结构体字段名。

## Phase 1 Commands

前端所有调用经 `src/lib/tauri.ts` 使用 `invoke<T>(command, args)` 封装。下表中的 args 和成功返回值均须在 `src/types/ipc.ts` 声明镜像。

| Command | Args | 成功返回 | Rust 状态变更与前端责任 |
| --- | --- | --- | --- |
| `select_epub_sources` | 无 | `SelectedSource[]` | Windows/Linux 调起官方 Dialog 并返回绝对路径；Android 调起项目自有 SAF 插件，只有 `takePersistableUriPermission` 成功才返回 `content://` URI。用户取消统一返回空数组。前端传给导入。 |
| `import_book` | `{ source: SelectedSource }` | `Book` | 校验并解析 EPUB；优先更新同来源图书，否则仅在 `missing/error` 记录中按重新定位指纹规则恢复唯一匹配的原 `book_id`，零匹配时创建新书，多匹配时返回 `VALIDATION_ERROR:` 且不猜测。解析失败将记录为 `error`。前端刷新书架并显示失败原因。 |
| `list_books` | 无 | `BookSummary[]` | 不隐式验证所有来源；不含 `source_locator`/`source_kind` 敏感字段。前端按 `status` 显示状态。 |
| `open_book` | Rust：`book_id`; TS：`{ bookId: string }` | `OpenBookResult` | 校验来源；Android 必须在应用重启后重新确认持久读取权限和 Provider 可访问性。失效时更新 `missing` 并返回不可用错误。成功返回 `epub_root_url` 与图书。 |
| `relocate_book` | Rust：`book_id`, `source`; TS：`{ bookId: string, source: SelectedSource }` | `Book` | 候选必须已通过平台权限校验。完整大小/mtime 指纹匹配，或在元数据不完整时匹配非空 OPF 标识符，才更新原记录。Android 失败候选应尽力释放新授权；前端仅在成功后重试打开。 |
| `get_reading_progress` | Rust：`book_id`; TS：`{ bookId: string }` | `ReadingProgress \| null` | 只读；前端将 EPUB CFI 交给 EPUB.js。 |
| `save_reading_progress` | Rust：`book_id`, `location_cfi`, `progression`; TS：`{ bookId: string, locationCfi: string, progression: number }` | `ReadingProgress` | 校验 EPUB 和 progression 范围，upsert 进度。前端在定位变化后节流调用。 |
| `delete_book` | Rust：`book_id`; TS：`{ bookId: string }` | `String`（已删除 book_id） | 删除图书及级联的进度和笔记；清理内存 EPUB、封面缓存文件，并在 Android 尽力释放持久 SAF 授权。前端从本地状态移除对应卡片，无需重新加载列表。 |
| `save_book_image` | Rust：`book_id`, `entry_path`; TS：`{ bookId: string, entryPath: string }` | `boolean` | 校验图书可用状态和 EPUB 内部规范化路径，经来源租约与格式资源能力读取单个 `image/*` 条目并应用既有 50 MiB 单条目/ZIP 总预算；桌面调用系统保存对话框，保存成功返回 `true`，用户取消返回 `false`。Android 在 SAF `ACTION_CREATE_DOCUMENT` 能力完成前返回 `FORMAT_NOT_SUPPORTED:`。不得返回来源定位符、目标路径或图片字节给前端。 |

```ts
export interface SelectedSource {
  source_locator: string;
  source_kind: SourceKind;
}

export interface OpenBookResult {
  book: Book;
  epub_root_url: string; // Windows: http://epub.localhost/book/{id}/; Linux/Android: epub://localhost/book/{id}/
}

export type DeleteBookArgs = {
  bookId: string;
};

export type SaveBookImageArgs = {
  bookId: string;
  entryPath: string;
};
```

`select_epub_sources` 在 Phase 1 只选择 EPUB；未来格式不可借用该 Command。批注、设置、系列与标签基础 Command 可以保留并继续审计；系列全文搜索 Command 必须由 TODO 的 B2 搜索任务连同真实后台任务、取消和预算一起交付，不得添加空实现。

P3 解锁后，通用来源选择、导入检查与导入提交必须使用新的契约，不能偷偷扩展 `select_epub_sources`/`import_book` 改变 Phase 1 EPUB 语义。规划模型至少应区分 `ImportCandidate`、候选真实格式、是否为漫画图片归档、单书/多书和需要用户选择的歧义；具体 Command 在 P3.0 评审后确定。ZIP 不得加入 `BookFormat`，图片 ZIP 成功导入后返回 `cbz`，单书 ZIP 返回内部真实格式。

P4 外部网盘解锁前，不增加登录、列目录、下载、刷新令牌、远程打开或同步相关 Command，也不扩展 `SelectedSource`/`SourceKind` 伪装远程能力。未来 Provider 契约必须区分账号授权、远程对象选择、下载/缓存任务和本地受控来源转换；阅读进度与批注跨设备同步不属于远程文件来源 Command。

## 后端业务 Commands（B2，前端冻结后消费）

所有后端业务模型同时定义于 Rust serde 模型、`src/types/models.ts` 与 `src/types/ipc.ts`。字符串输入必须修剪、限制长度并使用 SQLite 参数绑定；批注、标签和搜索摘要只按纯文本渲染。

数据库/服务层生成所有后端业务记录的 UUID 与时间戳；前端创建/更新时只提交可编辑字段。具体契约如下：

| Command | Args | 成功返回 | 关键语义 |
| --- | --- | --- | --- |
| `list_notes` | `{ bookId }` | `Note[]` | 目标图书不存在时返回 `BOOK_NOT_FOUND:`。 |
| `create_note` | `{ note: CreateNoteInput }` | `Note` | Rust 生成 `id/created_at/updated_at`；高亮是 `content` 为空的 Note。 |
| `update_note` | `{ note: UpdateNoteInput }` | `Note` | 不允许改变 `book_id/created_at`；缺失笔记返回 `NOTE_NOT_FOUND:`。 |
| `delete_note` | `{ noteId }` | `void` | 缺失笔记返回 `NOTE_NOT_FOUND:`。 |
| `get_reading_settings` | `{ bookId }` | `ReadingSettingsResult` | 返回 `effective/global/book_override`；不改变阅读进度契约。 |
| `get_global_reading_settings` | 无 | `ReadingSettings` | 供书架设置入口读取全局默认值；不要求当前打开图书，不读取或修改单书覆盖。 |
| `save_global_reading_settings` | `{ settings: ReadingSettingsInput }` | `ReadingSettings` | Rust 写入 `updated_at`。 |
| `save_book_reading_settings` | `{ settings: BookReadingSettingsInput }` | `BookReadingSettings` | 保存可空的逐字段覆盖；Rust 写入 `updated_at`。 |
| `clear_book_reading_settings` | `{ bookId }` | `void` | 删除单书覆盖，恢复全局设置。 |
| `list_series` | 无 | `Series[]` | 按名称排序。 |
| `create_series` / `update_series` | `{ series: CreateSeriesInput }` / `{ series: UpdateSeriesInput }` | `Series` | 名称修剪后 1–200 字符；Rust 管理 UUID/时间戳。 |
| `delete_series` | `{ seriesId }` | `void` | 删除归属和系列标签关系，不删除图书。 |
| `set_book_series` / `clear_book_series` | `{ assignment: BookSeries }` / `{ bookId }` | `BookSeries` / `void` | `book_id` 主键保证每本书最多一个系列；卷标最多 200 字符。 |
| `reorder_series_books` | `{ seriesId, positions }` | `BookSeries[]` | ID 必须唯一且全部属于目标系列；事务更新后返回完整有序列表。 |
| `list_tag_groups` | 无 | `TagGroup[]` | 按 `sort_order` 和名称排序。 |
| `create_tag_group` / `update_tag_group` | `{ group: CreateTagGroupInput }` / `{ group: UpdateTagGroupInput }` | `TagGroup` | Rust 管理 UUID/时间戳。 |
| `delete_tag_group` | `{ groupId }` | `void` | 标签通过 `ON DELETE SET NULL` 变为未分组。 |
| `list_tags` | 无 | `Tag[]` | 返回直接可管理的标签定义。 |
| `create_tag` / `update_tag` | `{ tag: CreateTagInput }` / `{ tag: UpdateTagInput }` | `Tag` | 名称修剪，颜色规范为小写 `#RRGGBB`；Rust 管理 UUID/时间戳。 |
| `delete_tag` | `{ tagId }` | `void` | 删除书籍/系列关系，不删除图书。 |
| `set_book_tags` / `set_series_tags` | `{ bookId, tagIds }` / `{ seriesId, tagIds }` | `BookTag[]` / `void` | 原子替换，ID 非空、唯一且必须存在。 |
| `list_book_tags` | `{ bookId }` | `BookTag[]` | 直接标签优先；与系列重复的继承标签去重。 |

`CreateNoteInput` 不含 `id/created_at/updated_at`；`UpdateNoteInput` 不含 `book_id/created_at/updated_at`。`ReadingSettingsInput` 不含 `updated_at`，`BookReadingSettingsInput` 不含 `updated_at`。系列、标签组与标签的 Create 输入不含 ID/时间戳，Update 输入仅包含 ID 和可编辑字段。

`ReadingSettings` / `ReadingSettingsInput` 的阅读排版字段为：`font_size_px`（12–32）、`line_height_multiplier`（1.0–3.0）、`paragraph_spacing_multiplier`（0–2.0）、`text_indent_em`（0–4.0）、`margin_top_px` / `margin_bottom_px`（0–100）、`margin_left_percent` / `margin_right_percent`（0–20）、`max_column_width_px`（300–1200）。`BookReadingSettings` / `BookReadingSettingsInput` 使用同名可空字段逐项覆盖；主题、字体、flow、spread 契约保持不变。前端保存异步执行，失败重试一次；第二次失败显示错误但不得回滚已应用的阅读预览。

| `ensure_series_search_index` / `rebuild_search_index` | `{ seriesId }` | `SearchTaskStatus` | 启动惰性增量索引或强制重建；返回任务 ID、状态和进度。来源指纹变化时自动重建；同一系列已有活动任务时返回 `SEARCH_INDEX_UNAVAILABLE:`，不启动竞争任务。 |
| `get_search_index_status` | `{ seriesId }` | `SearchIndexStatus` | 返回系列聚合状态、已索引/总章节、部分结果错误和更新时间；即使状态为 `ready`，也保留章节超限等部分结果明细。 |
| `cancel_search_index` | `{ taskId }` | `void` | 设置取消标记；任务在章节边界安全停止并保留已提交的部分结果。 |
| `search_series` | `{ seriesId, query, limit? }` | `SearchResult[]` | 查询最大 200 字符，默认最多 100 条；少于 3 个字符使用参数化 `LIKE` 并将 `%`、`_`、反斜杠按字面匹配，否则使用 FTS5 trigram。 |

以上 Command 已有真实 Rust 后台实现；当前 APK 已在黑鲨 Android 9 验证取消、进程终止恢复、系统 picker 的 13.20 MiB 单次导入、超大章节拒绝和来源授权撤销后的 `BOOK_SOURCE_UNAVAILABLE`，并记录过一次 135/135 重建的主库与 rollback journal 占用。低存储、长期/2 GiB 导入压力仍属于 B2 未完成门禁。

目录树的 DOM 渲染与当前书的章节内查找由后端冻结后的 EPUB.js 适配层完成；同系列/多卷搜索由 B2 后端索引 Command 提供。查询词最大 200 字符，默认最多返回 100 条；批注正文最大 20,000 字符，选中文本最大 10,000 字符，单个 CFI 最大 4,096 字符。

## 错误契约

每个 Command 统一返回 `Result<T, String>`。错误字符串必须含稳定前缀和人类可读的简短详情：

| 前缀 | 含义 | React 行为 |
| --- | --- | --- |
| `BOOK_SOURCE_UNAVAILABLE:` | 文件不存在、不可读或 Android URI 持久权限无效 | 显示“文件已移动，请重新选择”，进入重新定位流程。 |
| `SAF_PERMISSION_DENIED:` | Android 文件选择已返回 URI，但无法取得持久读取权限，或插件无法确认授权 | 保持当前页面并提示重新选择；不得调用 `import_book`，不得持久化 URI。 |
| `BOOK_RELOCATION_MISMATCH:` | 新来源未通过大小、修改时间和 OPF 标识符验证 | 保留旧记录为 missing，提示选择正确文件。 |
| `BOOK_PARSE_FAILED:` | EPUB ZIP、container 或 OPF 无法解析 | 显示导入/打开失败，展示 `status_detail`。 |
| `BOOK_NOT_FOUND:` | `book_id` 无对应记录 | 回到书架并刷新列表。 |
| `NOTE_NOT_FOUND:` | `note_id` 无对应记录 | 刷新批注列表并保留阅读位置。 |
| `SERIES_NOT_FOUND:` | `series_id` 无对应记录 | 刷新系列列表。 |
| `TAG_NOT_FOUND:` | `tag_id` 无对应记录 | 刷新标签列表。 |
| `TAG_GROUP_NOT_FOUND:` | `group_id` 无对应记录 | 刷新标签组与标签列表。 |
| `VALIDATION_ERROR:` | 参数格式或值不合法 | 保留当前 UI，显示可操作错误。 |
| `BOOK_RESOURCE_NOT_FOUND:` | 请求的 EPUB 内部条目不存在或路径无效 | 资源加载失败或图片导出提示条目缺失；不暴露宿主路径。 |
| `BOOK_RESOURCE_LIMIT_EXCEEDED:` | EPUB 或搜索索引超过安全预算 | 停止读取或索引，提示文件过大或压缩异常。 |
| `FORMAT_NOT_SUPPORTED:` | 当前 Phase 未实现该格式 | 返回书架并保留图书记录。 |
| `SEARCH_INDEX_UNAVAILABLE:` | FTS5、来源或索引任务不可用 | 显示状态并允许稍后重试或重建。 |
| `INTERNAL_ERROR:` | 已脱敏的内部错误 | 显示通用重试提示，不展示内部详情。 |

错误发生时不得把 Rust 堆栈、原始 SQL 或完整敏感 URI 传给前端。任何 Command 签名、模型字段或错误前缀变更必须同步修改本文件及前端镜像。
