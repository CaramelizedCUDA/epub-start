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

`reading_progress.location_cfi` 仅承载 EPUB CFI；对未来格式保持 `NULL`。`progression` 是可选的 0 到 1 数值，可供所有格式采用，但不得用它伪造精确位置。`notes` 的 CFI 字段为 EPUB 专用，Phase 1 只创建表，不提供 UI 或 IPC 写入。

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

## 来源失效与重新定位

打开前，Rust 比对当前来源的可读性及可获取的大小、修改时间。来源失效或 Android 持久授权缺失时，在事务中把 `books.status` 设为 `missing`、更新 `status_detail` 和 `updated_at`，随后返回 IPC 定义的不可用错误。

`relocate_book` 只接受经平台权限校验的候选来源。只有旧值和候选值都大于 `0` 时，大小或修改时间才可参与比较；完整的桌面指纹要求大小与修改时间同时匹配。任一辅助字段未知时，EPUB 候选必须解析出与旧记录相同的非空 `package_identifier`。辅助字段不完整且标识符也不可用时必须安全拒绝，不能仅凭 URI、文件名或单个大小值关联。校验通过后更新来源、辅助字段、状态为 `available` 并清空 `status_detail`；Android 候选的持久权限必须已在选择阶段取得。不通过时保留原记录与 `missing` 状态，并尽力释放本次候选新取得的持久权限。
