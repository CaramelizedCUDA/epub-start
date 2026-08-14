use rusqlite::{Connection, Result as SqliteResult};

const V1_SCHEMA: &str = r#"
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
"#;

const V2_SCHEMA: &str = r#"
CREATE TABLE source_cache_entries (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  cache_path TEXT NOT NULL,
  source_locator TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes >= 0),
  last_modified_ts INTEGER NOT NULL,
  head_sample BLOB NOT NULL CHECK (length(head_sample) <= 4096),
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

INSERT INTO global_reading_settings (
  singleton_id, theme, font_family, font_size_percent, line_height_percent,
  margin_percent, flow, spread, updated_at
) VALUES (1, 'dark', 'publisher', 100, 150, 5, 'paginated', 'auto', 0);

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

CREATE INDEX idx_book_series_series_order ON book_series(series_id, sort_order);
CREATE INDEX idx_tags_group_name ON tags(group_id, name);
CREATE INDEX idx_book_tags_tag ON book_tags(tag_id, book_id);
CREATE INDEX idx_series_tags_tag ON series_tags(tag_id, series_id);
CREATE INDEX idx_search_documents_book_spine ON search_documents(book_id, spine_index);
"#;

const V3_SCHEMA: &str = r#"
ALTER TABLE global_reading_settings ADD COLUMN font_size_px INTEGER NOT NULL DEFAULT 16 CHECK (font_size_px BETWEEN 12 AND 32);
ALTER TABLE global_reading_settings ADD COLUMN line_height_multiplier REAL NOT NULL DEFAULT 1 CHECK (line_height_multiplier BETWEEN 1.0 AND 3.0);
ALTER TABLE global_reading_settings ADD COLUMN paragraph_spacing_multiplier REAL NOT NULL DEFAULT 0 CHECK (paragraph_spacing_multiplier BETWEEN 0 AND 2.0);
ALTER TABLE global_reading_settings ADD COLUMN text_indent_em REAL NOT NULL DEFAULT 2 CHECK (text_indent_em BETWEEN 0 AND 4.0);
ALTER TABLE global_reading_settings ADD COLUMN margin_top_px INTEGER NOT NULL DEFAULT 48 CHECK (margin_top_px BETWEEN 0 AND 100);
ALTER TABLE global_reading_settings ADD COLUMN margin_bottom_px INTEGER NOT NULL DEFAULT 48 CHECK (margin_bottom_px BETWEEN 0 AND 100);
ALTER TABLE global_reading_settings ADD COLUMN margin_left_percent INTEGER NOT NULL DEFAULT 3 CHECK (margin_left_percent BETWEEN 0 AND 20);
ALTER TABLE global_reading_settings ADD COLUMN margin_right_percent INTEGER NOT NULL DEFAULT 3 CHECK (margin_right_percent BETWEEN 0 AND 20);
ALTER TABLE global_reading_settings ADD COLUMN max_column_width_px INTEGER NOT NULL DEFAULT 720 CHECK (max_column_width_px BETWEEN 300 AND 1200);

ALTER TABLE book_reading_settings ADD COLUMN font_size_px INTEGER CHECK (font_size_px IS NULL OR (font_size_px BETWEEN 12 AND 32));
ALTER TABLE book_reading_settings ADD COLUMN line_height_multiplier REAL CHECK (line_height_multiplier IS NULL OR (line_height_multiplier BETWEEN 1.0 AND 3.0));
ALTER TABLE book_reading_settings ADD COLUMN paragraph_spacing_multiplier REAL CHECK (paragraph_spacing_multiplier IS NULL OR (paragraph_spacing_multiplier BETWEEN 0 AND 2.0));
ALTER TABLE book_reading_settings ADD COLUMN text_indent_em REAL CHECK (text_indent_em IS NULL OR (text_indent_em BETWEEN 0 AND 4.0));
ALTER TABLE book_reading_settings ADD COLUMN margin_top_px INTEGER CHECK (margin_top_px IS NULL OR (margin_top_px BETWEEN 0 AND 100));
ALTER TABLE book_reading_settings ADD COLUMN margin_bottom_px INTEGER CHECK (margin_bottom_px IS NULL OR (margin_bottom_px BETWEEN 0 AND 100));
ALTER TABLE book_reading_settings ADD COLUMN margin_left_percent INTEGER CHECK (margin_left_percent IS NULL OR (margin_left_percent BETWEEN 0 AND 20));
ALTER TABLE book_reading_settings ADD COLUMN margin_right_percent INTEGER CHECK (margin_right_percent IS NULL OR (margin_right_percent BETWEEN 0 AND 20));
ALTER TABLE book_reading_settings ADD COLUMN max_column_width_px INTEGER CHECK (max_column_width_px IS NULL OR (max_column_width_px BETWEEN 300 AND 1200));

UPDATE global_reading_settings SET
  font_size_px = CAST(MIN(MAX(ROUND(font_size_percent / 100.0 * 16), 12), 32) AS INTEGER),
  line_height_multiplier = MIN(MAX(line_height_percent / 100.0, 1.0), 3.0),
  paragraph_spacing_multiplier = 0.5,
  text_indent_em = 2.0,
  margin_left_percent = MIN(MAX(margin_percent, 0), 20),
  margin_right_percent = MIN(MAX(margin_percent, 0), 20)
WHERE singleton_id = 1;

UPDATE book_reading_settings SET
  font_size_px = CASE WHEN font_size_percent IS NULL THEN NULL ELSE CAST(MIN(MAX(ROUND(font_size_percent / 100.0 * 16), 12), 32) AS INTEGER) END,
  line_height_multiplier = CASE WHEN line_height_percent IS NULL THEN NULL ELSE MIN(MAX(line_height_percent / 100.0, 1.0), 3.0) END,
  margin_left_percent = CASE WHEN margin_percent IS NULL THEN NULL ELSE MIN(MAX(margin_percent, 0), 20) END,
  margin_right_percent = CASE WHEN margin_percent IS NULL THEN NULL ELSE MIN(MAX(margin_percent, 0), 20) END;

CREATE TABLE global_reading_settings_v3 (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
  theme TEXT NOT NULL CHECK (theme IN ('light', 'sepia', 'dark')),
  font_family TEXT NOT NULL CHECK (font_family IN ('publisher', 'serif', 'sans', 'system')),
  font_size_percent INTEGER NOT NULL CHECK (font_size_percent BETWEEN 75 AND 200),
  line_height_percent INTEGER NOT NULL CHECK (line_height_percent BETWEEN 100 AND 250),
  margin_percent INTEGER NOT NULL CHECK (margin_percent BETWEEN 0 AND 20),
  flow TEXT NOT NULL CHECK (flow IN ('paginated', 'scrolled')),
  spread TEXT NOT NULL CHECK (spread IN ('auto', 'none', 'always')),
  updated_at INTEGER NOT NULL,
  font_size_px INTEGER NOT NULL DEFAULT 16 CHECK (font_size_px BETWEEN 12 AND 32),
  line_height_multiplier REAL NOT NULL DEFAULT 1.5 CHECK (line_height_multiplier BETWEEN 1.0 AND 3.0),
  paragraph_spacing_multiplier REAL NOT NULL DEFAULT 0.5 CHECK (paragraph_spacing_multiplier BETWEEN 0 AND 2.0),
  text_indent_em REAL NOT NULL DEFAULT 2.0 CHECK (text_indent_em BETWEEN 0 AND 4.0),
  margin_top_px INTEGER NOT NULL DEFAULT 48 CHECK (margin_top_px BETWEEN 0 AND 100),
  margin_bottom_px INTEGER NOT NULL DEFAULT 48 CHECK (margin_bottom_px BETWEEN 0 AND 100),
  margin_left_percent INTEGER NOT NULL DEFAULT 3 CHECK (margin_left_percent BETWEEN 0 AND 20),
  margin_right_percent INTEGER NOT NULL DEFAULT 3 CHECK (margin_right_percent BETWEEN 0 AND 20),
  max_column_width_px INTEGER NOT NULL DEFAULT 720 CHECK (max_column_width_px BETWEEN 300 AND 1200)
);

INSERT INTO global_reading_settings_v3 SELECT * FROM global_reading_settings;
DROP TABLE global_reading_settings;
ALTER TABLE global_reading_settings_v3 RENAME TO global_reading_settings;
"#;

pub fn run_migrations(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    let version: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_migrations'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if version == 0 {
        conn.execute_batch(
            "CREATE TABLE _migrations (
                version INTEGER PRIMARY KEY NOT NULL,
                applied_at INTEGER NOT NULL
            );",
        )?;
    }

    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if current < 1 {
        // Wrap the full V1 migration in a transaction so a partial failure
        // leaves the database unchanged rather than producing a half-migrated
        // state that causes permanent startup failures.
        conn.execute_batch("BEGIN IMMEDIATE;")?;
        let result = (|| -> SqliteResult<()> {
            conn.execute_batch(V1_SCHEMA)?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO _migrations (version, applied_at) VALUES (1, ?1)",
                [now],
            )?;
            Ok(())
        })();
        match result {
            Ok(()) => conn.execute_batch("COMMIT;")?,
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(e);
            }
        }
    }

    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM _migrations",
        [],
        |row| row.get(0),
    )?;
    if current < 2 {
        conn.execute_batch("BEGIN IMMEDIATE;")?;
        let result = (|| -> SqliteResult<()> {
            conn.execute_batch(V2_SCHEMA)?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_millis() as i64)
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO _migrations (version, applied_at) VALUES (2, ?1)",
                [now],
            )?;
            Ok(())
        })();
        match result {
            Ok(()) => conn.execute_batch("COMMIT;")?,
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(error);
            }
        }
    }

    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM _migrations",
        [],
        |row| row.get(0),
    )?;
    if current < 3 {
        conn.execute_batch("BEGIN IMMEDIATE;")?;
        let result = (|| -> SqliteResult<()> {
            conn.execute_batch(V3_SCHEMA)?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_millis() as i64)
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO _migrations (version, applied_at) VALUES (3, ?1)",
                [now],
            )?;
            Ok(())
        })();
        match result {
            Ok(()) => conn.execute_batch("COMMIT;")?,
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(error);
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn test_v1_migration_creates_all_tables() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"_migrations".to_string()));
        assert!(tables.contains(&"books".to_string()));
        assert!(tables.contains(&"reading_progress".to_string()));
        assert!(tables.contains(&"notes".to_string()));
        assert!(tables.contains(&"series".to_string()));
        assert!(tables.contains(&"tags".to_string()));
        assert!(tables.contains(&"global_reading_settings".to_string()));
        assert!(tables.contains(&"search_documents_fts".to_string()));
    }

    #[test]
    fn test_v1_upgrade_preserves_phase_one_data() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);",
        )
        .unwrap();
        conn.execute_batch(V1_SCHEMA).unwrap();
        conn.execute("INSERT INTO _migrations VALUES (1, 0)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO books VALUES ('b','Title','[]','epub',NULL,'/book.epub','desktop_path',1,2,NULL,'available',NULL,3,4)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO reading_progress VALUES ('b','epubcfi(/6/2)',0.5,5)",
            [],
        )
        .unwrap();

        run_migrations(&conn).unwrap();

        assert_eq!(
            conn.query_row("SELECT title FROM books WHERE id='b'", [], |row| row
                .get::<_, String>(0))
                .unwrap(),
            "Title"
        );
        assert_eq!(
            conn.query_row(
                "SELECT location_cfi FROM reading_progress WHERE book_id='b'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "epubcfi(/6/2)"
        );
        assert_eq!(
            conn.query_row("SELECT MAX(version) FROM _migrations", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            3
        );
    }

    #[test]
    fn test_v3_converts_legacy_reading_settings() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);",
        )
        .unwrap();
        conn.execute_batch(V1_SCHEMA).unwrap();
        conn.execute_batch(V2_SCHEMA).unwrap();
        conn.execute("INSERT INTO _migrations VALUES (1, 0)", [])
            .unwrap();
        conn.execute("INSERT INTO _migrations VALUES (2, 0)", [])
            .unwrap();
        conn.execute(
            "UPDATE global_reading_settings SET font_size_percent=175, line_height_percent=250, margin_percent=20",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO books VALUES ('b','Title','[]','epub',NULL,'/book.epub','desktop_path',1,2,NULL,'available',NULL,3,4)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO book_reading_settings (book_id,font_size_percent,line_height_percent,margin_percent,updated_at) VALUES ('b',125,NULL,7,1)",
            [],
        )
        .unwrap();

        run_migrations(&conn).unwrap();

        let global: (i64, f64, i64, i64) = conn
            .query_row(
                "SELECT font_size_px,line_height_multiplier,margin_left_percent,margin_right_percent FROM global_reading_settings",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(global, (28, 2.5, 20, 20));
        let book: (Option<i64>, Option<f64>, Option<i64>, Option<i64>) = conn
            .query_row(
                "SELECT font_size_px,line_height_multiplier,margin_left_percent,margin_right_percent FROM book_reading_settings WHERE book_id='b'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(book, (Some(20), None, Some(7), Some(7)));
        let line_height_default: String = conn
            .query_row(
                "SELECT dflt_value FROM pragma_table_info('global_reading_settings') WHERE name='line_height_multiplier'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(line_height_default, "1.5");
    }

    #[test]
    fn test_v1_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        // second run should not fail
        run_migrations(&conn).unwrap();
    }

    #[test]
    fn test_v1_indexes_exist() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let indexes: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(indexes
            .iter()
            .any(|i| i.contains("idx_books_status_updated_at")));
        assert!(indexes.iter().any(|i| i.contains("idx_books_title")));
        assert!(indexes
            .iter()
            .any(|i| i.contains("idx_books_source_locator")));
        assert!(indexes.iter().any(|i| i.contains("idx_notes_book_id")));
    }

    #[test]
    fn test_v2_failure_rolls_back_every_v2_object() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);",
        )
        .unwrap();
        conn.execute_batch(V1_SCHEMA).unwrap();
        conn.execute("INSERT INTO _migrations VALUES (1, 0)", [])
            .unwrap();
        conn.execute_batch("CREATE TABLE series (conflict INTEGER);")
            .unwrap();

        assert!(run_migrations(&conn).is_err());
        assert_eq!(
            conn.query_row("SELECT MAX(version) FROM _migrations", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        let source_cache_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='source_cache_entries'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(source_cache_exists, 0);
    }

    #[test]
    fn test_v2_cascade_removes_all_book_owned_rows() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO books VALUES ('b','Title','[]','epub',NULL,'/book.epub','desktop_path',1,2,NULL,'available',NULL,3,4)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO reading_progress VALUES ('b',NULL,NULL,1)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO notes (id,book_id,cfi_start,cfi_end,selected_text,content,color,created_at,updated_at,cfi_range) VALUES ('n','b','a','b','','','#112233',1,1,NULL)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO series VALUES ('s','Series',1,1)", [])
            .unwrap();
        conn.execute("INSERT INTO book_series VALUES ('b','s','',0)", [])
            .unwrap();
        conn.execute("INSERT INTO tags VALUES ('t',NULL,'Tag','#112233',1,1)", [])
            .unwrap();
        conn.execute("INSERT INTO book_tags VALUES ('b','t')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO book_reading_settings (book_id,updated_at) VALUES ('b',1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO source_cache_entries VALUES ('b','cache','/book.epub',1,2,X'',1,1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO search_documents (book_id,spine_index,href,title,body,cfi) VALUES ('b',0,'a','','text',NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO search_index_state VALUES ('b','{}','ready',1,1,NULL,1)",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM books WHERE id='b'", []).unwrap();
        for table in [
            "reading_progress",
            "notes",
            "book_series",
            "book_tags",
            "book_reading_settings",
            "source_cache_entries",
            "search_documents",
            "search_index_state",
        ] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} was not cascade deleted");
        }
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM series", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM tags", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn test_v1_failure_rolls_back_every_v1_object() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);",
        )
        .unwrap();
        // Force V1 to fail only after `books` and `reading_progress` have been
        // created. This makes the assertions below prove transactional rollback
        // instead of merely observing an early failure before any V1 DDL ran.
        conn.execute_batch("CREATE TABLE notes (conflict INTEGER);")
            .unwrap();

        assert!(run_migrations(&conn).is_err());
        assert_eq!(
            conn.query_row(
                "SELECT COALESCE(MAX(version), 0) FROM _migrations",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        for rolled_back_table in ["books", "reading_progress"] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [rolled_back_table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(exists, 0, "{rolled_back_table} was not rolled back");
        }
        let preexisting_conflict_table_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='notes'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(preexisting_conflict_table_exists, 1);
    }

    #[test]
    fn test_v3_failure_rolls_back_every_v3_object() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);",
        )
        .unwrap();
        conn.execute_batch(V1_SCHEMA).unwrap();
        conn.execute_batch(V2_SCHEMA).unwrap();
        conn.execute("INSERT INTO _migrations VALUES (1, 0)", [])
            .unwrap();
        conn.execute("INSERT INTO _migrations VALUES (2, 0)", [])
            .unwrap();
        conn.execute_batch("CREATE TABLE global_reading_settings_v3 (conflict INTEGER NOT NULL);")
            .unwrap();

        assert!(run_migrations(&conn).is_err());
        assert_eq!(
            conn.query_row("SELECT MAX(version) FROM _migrations", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        let v3_column_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('global_reading_settings') WHERE name='font_size_px'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(v3_column_count, 0);
    }
}
