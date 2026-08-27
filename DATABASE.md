# SQLite 数据库规范

本文件是数据库表、字段、索引和迁移顺序的唯一真相来源。Rust 模型与 TypeScript 镜像见 [IPC.md](IPC.md)。数据库文件位于 Tauri `app_data_dir`；启动时启用 `PRAGMA foreign_keys = ON`。

项目当前采用 Backend First。B0–B3 阶段的业务能力必须先以不可修改的迁移、仓储/服务实现和自动化测试落地；前端不得用本地状态、临时 JSON 或假数据替代尚未完成的持久化契约。B3 契约冻结后，如前端重建发现字段缺陷，仍须追加迁移并同步 IPC，禁止直接改写已发布 Schema。

## 迁移规则

- 使用有序、不可修改的 Rust 迁移，例如 `v1_initial_library`；已发布迁移只可追加，不能改写。
- 所有时间戳均为 UTC Unix epoch 毫秒。UUID 以 RFC 4122 字符串存储。
- SQLite 不提供原生 enum：枚举值由 `CHECK` 约束并由 Rust/TypeScript 的联合类型镜像。
- 删除图书时数据库级联删除进度与笔记；Rust 在删除事务成功后清理 `cover_cache_path` 指向的缓存文件。

## V1 Schema

```sql
CREATE TABLE books (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL DEFAULT '[]',
  format TEXT NOT NULL CHECK (format IN ('epub', 'txt', 'pdf', 'cbz', 'cbr')),
  cover_cache_path TEXT,
  source_locator TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('desktop_path', 'android_content_uri')),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes >= 0),
  last_modified_ts INTEGER NOT NULL,
  package_identifier TEXT,
  status TEXT NOT NULL CHECK (status IN ('available', 'missing', 'error')),
  status_detail TEXT,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE reading_progress (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  location_cfi TEXT,
  progression REAL,
  updated_at INTEGER NOT NULL,
  CHECK (progression IS NULL OR (progression >= 0.0 AND progression <= 1.0))
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  cfi_start TEXT NOT NULL,
  cfi_end TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_books_status_updated_at ON books(status, updated_at DESC);
CREATE INDEX idx_books_title ON books(title COLLATE NOCASE);
CREATE INDEX idx_books_source_locator ON books(source_locator);
CREATE INDEX idx_notes_book_id ON notes(book_id);
```

## 字段与生命周期

`authors_json` 是字符串数组 JSON，避免为当前 MVP 引入作者关系表。`source_locator` 统一存放绝对路径或 `content://` URI，`source_kind` 决定校验方式。禁止将访问令牌、临时 URI 权限或 ZIP 内容写入此表。

P4 外部网盘解锁前，`source_kind` 不追加远程枚举，Schema 不新增网盘账号、OAuth 令牌、刷新令牌或通用凭据 JSON 字段。未来远程来源必须通过追加迁移设计 Provider、远程对象稳定 ID、版本/ETag、缓存状态与账号引用；敏感凭据不得直接存入 `books` 或明文 SQLite。远程文件来源也不得与阅读进度、批注的跨设备同步共用未经设计的表。

`file_size_bytes` 与 `last_modified_ts` 是重新定位的辅助指纹，不是安全哈希。桌面来源应保存实际值；Android SAF Provider 无法提供某项元数据时，该字段保存 `0` 表示“未知”，严禁以导入时间或当前时间伪造修改时间。对 EPUB，`package_identifier` 由 OPF 解析；它可为空，但在 SAF 辅助元数据不完整时是重新定位所需的稳定回退标识。`status_detail` 存放面向诊断的简短错误描述，不存放敏感来源内容。

`reading_progress.location_cfi` 仅承载 EPUB CFI；对未来格式保持 `NULL`。`progression` 是可选的 0 到 1 数值，可供所有格式采用，但不得用它伪造精确位置。`notes.cfi_start`/`cfi_end` 为 EPUB 必填定位字段，V2 追加的 `cfi_range` 可空以兼容升级前批注；新写入的空白 range 归一为 `NULL`。服务层先修剪外层空白，再按字符限制单个 CFI 4,096、`selected_text` 10,000、`content` 20,000；选中文本和正文按字面纯文本保存，不解释 HTML，颜色统一为小写 `#RRGGBB`。批注更新保留原始 `book_id`/`created_at`，重启依靠 `id/book_id/CFI/selected_text/content/color/created_at/updated_at` 完整恢复；删除图书由外键级联删除批注。

P3.0 必须通过追加迁移设计多格式位置模型，不能复用 `location_cfi` 存放 TXT 偏移、PDF 页码或漫画页码。规划方向为显式 `location_kind` 与受校验 payload：EPUB CFI、TXT 文本锚点、固定页面页码及必要页内坐标；最终字段和约束须在实现前重新评审。文本排版设置与固定页面设置也必须分表或分类型约束，避免漫画继承字体/行距或 EPUB 继承页面缩放。

`.zip` 不加入 `books.format`。纯图片 ZIP 经 P3.2 检查后以 `cbz` 语义入库；只包装一本 EPUB/TXT/PDF 的 ZIP 经 P3.5 安全解包后，按内部图书的真实格式入库；多书分发包为多个独立图书记录。解包暂存路径和导入任务状态如需持久化，必须使用追加迁移，禁止把临时解包路径写成永久 `source_locator`。

## V2 Schema（Phase 2）

V2 必须通过新的不可修改迁移追加，禁止改写 V1。它新增来源缓存、系列、标签、阅读设置和搜索索引；Phase 1 的 `books`、`reading_progress`、来源字段和重新定位语义保持不变。

```sql
CREATE TABLE source_cache_entries (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  cache_path TEXT NOT NULL,
  source_locator TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes >= 0),
  last_modified_ts INTEGER NOT NULL,
  head_sample BLOB NOT NULL,
  cache_size_bytes INTEGER NOT NULL CHECK (cache_size_bytes >= 0),
  last_accessed_at INTEGER NOT NULL
);

CREATE TABLE series (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE book_series (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  volume_label TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tag_groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT REFERENCES tag_groups(id) ON DELETE SET NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  color TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(group_id, name)
);

CREATE TABLE book_tags (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(book_id, tag_id)
);

CREATE TABLE series_tags (
  series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(series_id, tag_id)
);

CREATE TABLE global_reading_settings (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
  theme TEXT NOT NULL CHECK (theme IN ('light', 'sepia', 'dark')),
  font_family TEXT NOT NULL CHECK (font_family IN ('publisher', 'serif', 'sans', 'system')),
  font_size_percent INTEGER NOT NULL CHECK (font_size_percent BETWEEN 75 AND 200),
  line_height_percent INTEGER NOT NULL CHECK (line_height_percent BETWEEN 100 AND 250),
  margin_percent INTEGER NOT NULL CHECK (margin_percent BETWEEN 0 AND 20),
  flow TEXT NOT NULL CHECK (flow IN ('paginated', 'scrolled')),
  spread TEXT NOT NULL CHECK (spread IN ('auto', 'none', 'always')),
  updated_at INTEGER NOT NULL
);

CREATE TABLE book_reading_settings (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  theme TEXT CHECK (theme IS NULL OR theme IN ('light', 'sepia', 'dark')),
  font_family TEXT CHECK (font_family IS NULL OR font_family IN ('publisher', 'serif', 'sans', 'system')),
  font_size_percent INTEGER CHECK (font_size_percent IS NULL OR font_size_percent BETWEEN 75 AND 200),
  line_height_percent INTEGER CHECK (line_height_percent IS NULL OR line_height_percent BETWEEN 100 AND 250),
  margin_percent INTEGER CHECK (margin_percent IS NULL OR margin_percent BETWEEN 0 AND 20),
  flow TEXT CHECK (flow IS NULL OR flow IN ('paginated', 'scrolled')),
  spread TEXT CHECK (spread IS NULL OR spread IN ('auto', 'none', 'always')),
  updated_at INTEGER NOT NULL
);

ALTER TABLE notes ADD COLUMN cfi_range TEXT;

CREATE TABLE search_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  spine_index INTEGER NOT NULL,
  href TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  cfi TEXT,
  UNIQUE(book_id, spine_index)
);

CREATE VIRTUAL TABLE search_documents_fts USING fts5(
  title, body, content='search_documents', content_rowid='id', tokenize='trigram'
);

CREATE TABLE search_index_state (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  fingerprint_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'building', 'ready', 'error')),
  indexed_documents INTEGER NOT NULL DEFAULT 0,
  total_documents INTEGER NOT NULL DEFAULT 0,
  error_detail TEXT,
  updated_at INTEGER NOT NULL
);
```

系列标签通过 `series_tags JOIN book_series` 动态继承，不复制到 `book_tags`。删除标签组时标签通过 `ON DELETE SET NULL` 变为未分组；删除系列、标签或标签组不得删除图书。来源头部样本最多 4096 字节，只用于缓存和搜索索引失效，不作为图书身份或重新定位依据。

V2 CRUD 中的 UUID、`created_at` 与 `updated_at` 由 Rust 服务层生成，渲染层不得提供或覆盖这些审计字段。系列、标签组与标签更新必须保留原始 `created_at`；批注更新必须保留原始 `book_id` 与 `created_at`。删除图书时，`source_cache_entries`、`book_series`、`book_tags`、`book_reading_settings`、`search_documents` 与 `search_index_state` 和 V1 的进度/笔记一起级联删除；系列与标签定义保留。

`book_series.book_id` 主键是单系列归属的数据库保证。设置归属使用单条 UPSERT；`list_series_books` 按 `sort_order, book_id` 返回卷标与排序；重排输入由服务层校验 ID 非空、唯一且属于目标系列，仓储在单个 `BEGIN IMMEDIATE` 事务内更新，任一语句或 `COMMIT` 失败都回滚。删除系列依靠外键级联删除 `book_series`/`series_tags` 关系，但不删除 `books`。该收口复用 V2 Schema，不新增或改写迁移。

标签组名称由 `tag_groups.name COLLATE NOCASE UNIQUE` 保证唯一；同一非空标签组内的标签名称由 `UNIQUE(group_id, name)` 保证 NOCASE 唯一。SQLite 的 `NULL` 唯一语义允许多个未分组标签同名，标签定义始终以 `tag_id` 为稳定身份；不同标签组也允许同名。服务层把受约束的名称冲突映射为 `VALIDATION_ERROR:`，更新保留原始 `created_at`。删除标签组通过 `ON DELETE SET NULL` 取消分组，标签定义以及既有书籍/系列关系保留；删除标签通过外键级联清理 `book_tags`/`series_tags`，不删除图书或系列。

书籍有效标签由 `book_tags` 直接关系与 `book_series JOIN series_tags` 继承关系动态合并，不复制继承记录；同一 `tag_id` 同时直接和继承时，关系读取以直接标签为准。`set_book_tags`/`set_series_tags` 先校验非空且唯一的关系 ID 与实体存在性，再在单个 `BEGIN IMMEDIATE` 事务内原子替换；失败保留旧关系。`filter_books_by_tags` 对所选有效标签使用 AND 语义，并以 `COUNT(DISTINCT tag_id)` 防止直接/继承重复影响匹配；返回顺序固定为 `books.updated_at DESC, title COLLATE NOCASE, id`。该收口复用 V2 表与 `idx_book_tags_tag`/`idx_series_tags_tag`，不新增迁移。

`search_documents.href` 保存 OPF manifest 中的章节 href，供打开图书后的 EPUB.js 导航；它不是 `epub_root_url` 下已经规范化的协议条目路径。B2 EPUB 索引不得根据 spine 序号合成 CFI，写入与查询返回的 `cfi` 均为 `NULL`；该可空列保留为未来经可靠格式/DOM 适配生成精确位置时的追加能力，不得把非空值当作当前完成条件。

### B2 存储预算实现（复用 V2，无新增迁移）

`source_cache_entries.cache_size_bytes` 和 `last_accessed_at` 是来源缓存预算与真实 LRU 的持久化基础。成功取得 Android 缓存租约时，服务以单调递增值更新 `last_accessed_at`；新文件经临时写入、flush、原子 rename 后才写入元数据，`cache_size_bytes` 取最终文件的真实 metadata。启动协调会删除数据库无对应记录的 `.source`/指纹孤儿，清除文件缺失或大小不符的行，并重新应用预算。删除图书仍由外键级联删除元数据，服务负责文件清理；活动 `SourceLease` 对应行在淘汰时受保护。

封面继续复用 `books.cover_cache_path`，不增加缓存表。`CoverCache` 只接受缓存目录的直接子文件；启动时在事务内把缺失或越界路径置为 `NULL`，随后删除无任何 `books` 行引用的孤儿。导入时先保护新候选与旧封面执行预算，数据库写入失败只清理候选，成功后才删除旧封面；删除图书后也经同一安全 seam 清理。淘汰顺序为 `books.updated_at, books.id`，被淘汰行的 `cover_cache_path` 置空。前端 asset 读取不经过 Rust，因此此字段不能表达封面命中时间，也不宣称封面是真实访问 LRU。

来源缓存软/硬上限为 256/512 MiB，封面缓存软/硬上限为 64/128 MiB，搜索索引文本账面硬上限为 256 MiB；统一常量把全部可重建数据合计硬上限冻结为 896 MiB，不超过 1 GiB。索引预算只统计持久化 `title/body` 的 UTF-8 字节数；搜索错误状态的文档清理、FTS 重建和 `search_index_state` 更新在同一个 `BEGIN IMMEDIATE` 事务中完成，任一步失败回滚并保留旧索引，`SQLITE_FULL` 映射为 `BOOK_RESOURCE_LIMIT_EXCEEDED:`。黑鲨 Android 9 七卷重建已记录主库 11,640,832 B、峰值 rollback journal 8,309,808 B，未出现 `-wal`，但该样本不等于低存储/长期压力门禁。达到上限必须保持数据库一致性；`books`、阅读进度、批注、设置等持久业务数据不属于缓存预算，禁止为满足预算而删除。

上述来源/封面事务、重启协调、软硬淘汰和错误语义已有辅助逻辑自动化与变红自证。Android ENOSPC、进程中断、长期/2 GiB 逻辑压力以及真实 page/rollback journal 低余量峰值已按 [ANDROID_STORAGE_ACCEPTANCE.md](ANDROID_STORAGE_ACCEPTANCE.md) 形成限定范围证据；没有观察到 WAL/SHM，且结果不得外推为唯一物理 2 GiB、封面公共保护重叠或更广 OEM 行为。V2 字段足以表达当前实现；未来确有 Schema 缺口时只能追加 V5 或更高迁移，禁止回写 V2。

## V3 Schema（阅读设置扩展）

V3 是追加迁移，禁止改写 V1/V2。V2 的 `font_size_percent`、`line_height_percent`、`margin_percent` 只保留为升级来源；V3 之后公开模型、保存逻辑和渲染均以新字段为准。

```sql
ALTER TABLE global_reading_settings ADD COLUMN font_size_px INTEGER NOT NULL DEFAULT 16 CHECK (font_size_px BETWEEN 12 AND 32);
ALTER TABLE global_reading_settings ADD COLUMN line_height_multiplier REAL NOT NULL DEFAULT 1.5 CHECK (line_height_multiplier BETWEEN 1.0 AND 3.0);
ALTER TABLE global_reading_settings ADD COLUMN paragraph_spacing_multiplier REAL NOT NULL DEFAULT 0.5 CHECK (paragraph_spacing_multiplier BETWEEN 0 AND 2.0);
ALTER TABLE global_reading_settings ADD COLUMN text_indent_em REAL NOT NULL DEFAULT 2.0 CHECK (text_indent_em BETWEEN 0 AND 4.0);
ALTER TABLE global_reading_settings ADD COLUMN margin_top_px INTEGER NOT NULL DEFAULT 48 CHECK (margin_top_px BETWEEN 0 AND 100);
ALTER TABLE global_reading_settings ADD COLUMN margin_bottom_px INTEGER NOT NULL DEFAULT 48 CHECK (margin_bottom_px BETWEEN 0 AND 100);
ALTER TABLE global_reading_settings ADD COLUMN margin_left_percent INTEGER NOT NULL DEFAULT 3 CHECK (margin_left_percent BETWEEN 0 AND 20);
ALTER TABLE global_reading_settings ADD COLUMN margin_right_percent INTEGER NOT NULL DEFAULT 3 CHECK (margin_right_percent BETWEEN 0 AND 20);
ALTER TABLE global_reading_settings ADD COLUMN max_column_width_px INTEGER NOT NULL DEFAULT 720 CHECK (max_column_width_px BETWEEN 300 AND 1200);
```

`book_reading_settings` 追加同名可空字段及相同范围约束；`NULL` 继续表示继承全局值。升级时全局值按 `round(font_size_percent / 100 * 16)`、`line_height_percent / 100.0` 和旧 `margin_percent` 转换并 clamp；单书字段仅在旧覆盖非空时转换，其余新字段使用全局默认或保持单书 `NULL`。

## V4 Schema（阅读设置默认值修正）

V4 仍是追加迁移，不能改写 V3。V2 的全局种子行会在 V3 转换后暂时保留旧的 5% 左右边距；V4 只把“仍为 V2 原始默认值且 `updated_at = 0`”的未修改种子行归一为 V3 文档默认的 3%，已保存过的旧用户值继续按 V3 转换结果保留。

```sql
UPDATE global_reading_settings SET
  margin_left_percent = 3,
  margin_right_percent = 3
WHERE singleton_id = 1
  AND theme = 'dark'
  AND font_family = 'publisher'
  AND font_size_percent = 100
  AND line_height_percent = 150
  AND margin_percent = 5
  AND flow = 'paginated'
  AND spread = 'auto'
  AND updated_at = 0
  AND margin_left_percent = 5
  AND margin_right_percent = 5;
```

全局保存由 `settings_service` 一次性更新整行；单书设置以可空字段保存，`NULL` 表示该字段继承全局值。清除单书设置删除覆盖行并恢复全局有效值。所有设置写入和读取均通过服务/仓储的参数化 SQL 完成。

## V5 Schema（阅读时长、历史与继续阅读状态）

V5 是 B4 的追加迁移，禁止改写 V1–V4。它把“仍在书架中的最近阅读状态”与“用户可独立删除的阅读历史”分开：删除历史不得删除图书、`reading_progress` 或 `book_reading_state`；删除图书级联删除 `book_reading_state`，但只把历史活动的实时 `book_id` 设为 `NULL`，历史快照继续保留。

```sql
CREATE TABLE book_reading_state (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  last_read_at INTEGER NOT NULL CHECK (last_read_at >= started_at)
);

INSERT INTO book_reading_state (book_id, started_at, last_read_at)
SELECT book_id, updated_at, updated_at
FROM reading_progress;

CREATE TABLE reading_activity_sessions (
  id TEXT PRIMARY KEY,
  recorded_book_id TEXT NOT NULL,
  book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
  book_title TEXT NOT NULL,
  book_authors_json TEXT NOT NULL,
  series_id_snapshot TEXT,
  series_name_snapshot TEXT,
  series_volume_label_snapshot TEXT,
  state TEXT NOT NULL CHECK (state IN ('visible', 'paused', 'ended')),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  last_observed_at INTEGER NOT NULL CHECK (last_observed_at >= started_at),
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
  ended_at INTEGER,
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (
    (state = 'ended' AND ended_at IS NOT NULL)
    OR (state IN ('visible', 'paused') AND ended_at IS NULL)
  )
);

CREATE TABLE reading_presence_segments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES reading_activity_sessions(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL CHECK (length(local_date) = 10),
  utc_offset_minutes INTEGER NOT NULL CHECK (utc_offset_minutes BETWEEN -840 AND 840),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  confirmed_until_at INTEGER NOT NULL CHECK (confirmed_until_at >= started_at),
  closed_at INTEGER,
  CHECK (closed_at IS NULL OR closed_at = confirmed_until_at)
);

CREATE INDEX idx_book_reading_state_last_read
  ON book_reading_state(last_read_at DESC, book_id);
CREATE INDEX idx_reading_activity_recorded_book
  ON reading_activity_sessions(recorded_book_id, started_at DESC);
CREATE INDEX idx_reading_activity_live_book
  ON reading_activity_sessions(book_id, started_at DESC);
CREATE INDEX idx_reading_presence_local_date
  ON reading_presence_segments(local_date, started_at);
CREATE INDEX idx_reading_presence_session
  ON reading_presence_segments(session_id, started_at);
CREATE UNIQUE INDEX idx_reading_presence_one_open
  ON reading_presence_segments(session_id) WHERE closed_at IS NULL;
```

`book_reading_state` 的行存在即表示该书曾开始阅读。迁移会用现有 `reading_progress.updated_at` 为旧进度补种首次/最近阅读时间；之后保存进度和开始阅读活动都会推进 `last_read_at`，以兼容尚未接入 B4 活动观察的 legacy shell。

每个活动只保存书名、作者、系列 ID/名称/卷标快照，不保存 `source_locator`、Android URI 或正文。可见区段以 UTC epoch 毫秒保存确认区间，并记录该区间归属的本地日期与 UTC 偏移；`confirmed_until_at - started_at` 是可累计阅读时长。自然跨本地午夜时拆分区段；偏移变化或超过 90 秒的未知间隔不补算。启动恢复把未结束活动停在最后确认点，不向进程退出后外推。

按活动、日期、历史图书身份或全部删除历史时，活动删除级联区段；按日期删除只移除匹配日期的区段，再清理没有区段的空活动。上述删除均不得修改 `books`、`reading_progress` 或 `book_reading_state`。删书只将历史活动 `book_id` 置空，`recorded_book_id` 与展示快照保留。

## 来源失效与重新定位

打开前，Rust 比对当前来源的可读性及可获取的大小、修改时间。来源失效或 Android 持久授权缺失时，在事务中把 `books.status` 设为 `missing`、更新 `status_detail` 和 `updated_at`，随后返回 IPC 定义的不可用错误。

`relocate_book` 只接受经平台权限校验的候选来源。只有旧值和候选值都大于 `0` 时，大小或修改时间才可参与比较；完整的桌面指纹要求大小与修改时间同时匹配。任一辅助字段未知时，EPUB 候选必须解析出与旧记录相同的非空 `package_identifier`。辅助字段不完整且标识符也不可用时必须安全拒绝，不能仅凭 URI、文件名或单个大小值关联。校验通过后更新来源、辅助字段、状态为 `available` 并清空 `status_detail`；Android 候选的持久权限必须已在选择阶段取得。不通过时保留原记录与 `missing` 状态，并尽力释放本次候选新取得的持久权限。
