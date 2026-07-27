use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};

use super::models::{
    Book, BookFormat, BookReadingSettings, BookStatus, Note, ReadingProgress, ReadingSettings,
    SourceKind,
};

// ── Row mapping helpers ──────────────────────────────────────────

fn row_to_book(row: &rusqlite::Row) -> SqliteResult<Book> {
    let authors_json: String = row.get("authors_json")?;
    let authors: Vec<String> = serde_json::from_str(&authors_json).unwrap_or_default();

    let format_str: String = row.get("format")?;
    let format = match format_str.as_str() {
        "epub" => BookFormat::Epub,
        "txt" => BookFormat::Txt,
        "pdf" => BookFormat::Pdf,
        "cbz" => BookFormat::Cbz,
        "cbr" => BookFormat::Cbr,
        _ => BookFormat::Epub, // safe default, should not happen with CHECK constraint
    };

    let source_kind_str: String = row.get("source_kind")?;
    let source_kind = match source_kind_str.as_str() {
        "desktop_path" => SourceKind::DesktopPath,
        "android_content_uri" => SourceKind::AndroidContentUri,
        _ => SourceKind::DesktopPath,
    };

    let status_str: String = row.get("status")?;
    let status = match status_str.as_str() {
        "available" => BookStatus::Available,
        "missing" => BookStatus::Missing,
        "error" => BookStatus::Error,
        _ => BookStatus::Error,
    };

    Ok(Book {
        id: row.get("id")?,
        title: row.get("title")?,
        authors,
        format,
        cover_cache_path: row.get("cover_cache_path")?,
        source_locator: row.get("source_locator")?,
        source_kind,
        file_size_bytes: row.get("file_size_bytes")?,
        last_modified_ts: row.get("last_modified_ts")?,
        package_identifier: row.get("package_identifier")?,
        status,
        status_detail: row.get("status_detail")?,
        added_at: row.get("added_at")?,
        updated_at: row.get("updated_at")?,
    })
}

// ── Public CRUD ────────────────────────────────────────────────────

pub fn insert_book(conn: &Connection, book: &Book) -> SqliteResult<()> {
    let authors_json = serde_json::to_string(&book.authors).unwrap_or_else(|_| "[]".into());

    conn.execute(
        "INSERT INTO books (
            id, title, authors_json, format, cover_cache_path,
            source_locator, source_kind, file_size_bytes, last_modified_ts,
            package_identifier, status, status_detail, added_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        params![
            book.id,
            book.title,
            authors_json,
            serde_rename(&book.format),
            book.cover_cache_path,
            book.source_locator,
            serde_rename(&book.source_kind),
            book.file_size_bytes,
            book.last_modified_ts,
            book.package_identifier,
            serde_rename(&book.status),
            book.status_detail,
            book.added_at,
            book.updated_at,
        ],
    )?;
    Ok(())
}

pub fn update_book_by_source(conn: &Connection, book: &Book) -> SqliteResult<()> {
    let authors_json = serde_json::to_string(&book.authors).unwrap_or_else(|_| "[]".into());

    conn.execute(
        "UPDATE books SET
            title = ?1,
            authors_json = ?2,
            format = ?3,
            cover_cache_path = ?4,
            file_size_bytes = ?5,
            last_modified_ts = ?6,
            package_identifier = ?7,
            status = ?8,
            status_detail = ?9,
            updated_at = ?10
         WHERE source_locator = ?11",
        params![
            book.title,
            authors_json,
            serde_rename(&book.format),
            book.cover_cache_path,
            book.file_size_bytes,
            book.last_modified_ts,
            book.package_identifier,
            serde_rename(&book.status),
            book.status_detail,
            book.updated_at,
            book.source_locator,
        ],
    )?;
    Ok(())
}

pub fn find_book_by_source_locator(conn: &Connection, locator: &str) -> SqliteResult<Option<Book>> {
    let mut stmt = conn.prepare("SELECT * FROM books WHERE source_locator = ?1")?;
    let mut rows = stmt.query_map(params![locator], row_to_book)?;
    match rows.next() {
        Some(Ok(book)) => Ok(Some(book)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

pub fn find_book_by_id(conn: &Connection, id: &str) -> SqliteResult<Option<Book>> {
    let mut stmt = conn.prepare("SELECT * FROM books WHERE id = ?1")?;
    let mut rows = stmt.query_map(params![id], row_to_book)?;
    match rows.next() {
        Some(Ok(book)) => Ok(Some(book)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

pub fn update_book_by_id(conn: &Connection, book: &Book) -> SqliteResult<()> {
    let authors_json = serde_json::to_string(&book.authors).unwrap_or_else(|_| "[]".into());

    conn.execute(
        "UPDATE books SET
            title = ?1,
            authors_json = ?2,
            format = ?3,
            cover_cache_path = ?4,
            source_locator = ?5,
            source_kind = ?6,
            file_size_bytes = ?7,
            last_modified_ts = ?8,
            package_identifier = ?9,
            status = ?10,
            status_detail = ?11,
            updated_at = ?12
         WHERE id = ?13",
        params![
            book.title,
            authors_json,
            serde_rename(&book.format),
            book.cover_cache_path,
            book.source_locator,
            serde_rename(&book.source_kind),
            book.file_size_bytes,
            book.last_modified_ts,
            book.package_identifier,
            serde_rename(&book.status),
            book.status_detail,
            book.updated_at,
            book.id,
        ],
    )?;
    Ok(())
}

pub fn list_all_books(conn: &Connection) -> SqliteResult<Vec<Book>> {
    let mut stmt = conn.prepare("SELECT * FROM books ORDER BY updated_at DESC")?;
    let rows = stmt.query_map([], row_to_book)?;
    rows.collect()
}

pub fn list_recoverable_books(conn: &Connection) -> SqliteResult<Vec<Book>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM books WHERE status IN ('missing', 'error') ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_book)?;
    rows.collect()
}

/// Deletes a book by id. Returns its source locator and cached cover path
/// so the caller can clean up the in-memory EPUB and cover file.
/// Reading progress and notes are removed via `ON DELETE CASCADE`.
/// Returns a `rusqlite` error (typically `QueryReturnedNoRows`) when
/// the `id` does not match any row.
pub fn delete_book(conn: &Connection, id: &str) -> SqliteResult<(String, Option<String>)> {
    let artifacts = conn.query_row(
        "SELECT source_locator, cover_cache_path FROM books WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    conn.execute("DELETE FROM books WHERE id = ?1", params![id])?;
    Ok(artifacts)
}

// ── Reading progress ─────────────────────────────────────────────

fn row_to_reading_progress(row: &rusqlite::Row) -> SqliteResult<ReadingProgress> {
    Ok(ReadingProgress {
        book_id: row.get("book_id")?,
        location_cfi: row.get("location_cfi")?,
        progression: row.get("progression")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn get_reading_progress(
    conn: &Connection,
    book_id: &str,
) -> SqliteResult<Option<ReadingProgress>> {
    let mut stmt = conn.prepare("SELECT * FROM reading_progress WHERE book_id = ?1")?;
    let mut rows = stmt.query_map(params![book_id], row_to_reading_progress)?;
    match rows.next() {
        Some(Ok(p)) => Ok(Some(p)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

pub fn upsert_reading_progress(conn: &Connection, progress: &ReadingProgress) -> SqliteResult<()> {
    conn.execute(
        "INSERT INTO reading_progress (book_id, location_cfi, progression, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(book_id) DO UPDATE SET
           location_cfi = excluded.location_cfi,
           progression = excluded.progression,
           updated_at = excluded.updated_at",
        params![
            progress.book_id,
            progress.location_cfi,
            progress.progression,
            progress.updated_at,
        ],
    )?;
    Ok(())
}

pub fn list_notes(conn: &Connection, book_id: &str) -> SqliteResult<Vec<Note>> {
    let mut stmt = conn.prepare("SELECT id, book_id, cfi_start, cfi_end, cfi_range, selected_text, content, color, created_at, updated_at FROM notes WHERE book_id = ?1 ORDER BY created_at")?;
    let rows = stmt.query_map(params![book_id], |row| {
        Ok(Note {
            id: row.get(0)?,
            book_id: row.get(1)?,
            cfi_start: row.get(2)?,
            cfi_end: row.get(3)?,
            cfi_range: row.get(4)?,
            selected_text: row.get(5)?,
            content: row.get(6)?,
            color: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn find_note_by_id(conn: &Connection, note_id: &str) -> SqliteResult<Option<Note>> {
    conn.query_row(
        "SELECT id, book_id, cfi_start, cfi_end, cfi_range, selected_text, content, color, created_at, updated_at FROM notes WHERE id = ?1",
        params![note_id],
        |row| {
            Ok(Note {
                id: row.get(0)?,
                book_id: row.get(1)?,
                cfi_start: row.get(2)?,
                cfi_end: row.get(3)?,
                cfi_range: row.get(4)?,
                selected_text: row.get(5)?,
                content: row.get(6)?,
                color: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        },
    )
    .optional()
}

pub fn insert_note(conn: &Connection, note: &Note) -> SqliteResult<()> {
    conn.execute("INSERT INTO notes (id, book_id, cfi_start, cfi_end, cfi_range, selected_text, content, color, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)", params![note.id, note.book_id, note.cfi_start, note.cfi_end, note.cfi_range, note.selected_text, note.content, note.color, note.created_at, note.updated_at])?;
    Ok(())
}

pub fn update_note(conn: &Connection, note: &Note) -> SqliteResult<()> {
    conn.execute("UPDATE notes SET cfi_start=?1,cfi_end=?2,cfi_range=?3,selected_text=?4,content=?5,color=?6,updated_at=?7 WHERE id=?8", params![note.cfi_start, note.cfi_end, note.cfi_range, note.selected_text, note.content, note.color, note.updated_at, note.id])?;
    Ok(())
}

pub fn delete_note(conn: &Connection, note_id: &str) -> SqliteResult<usize> {
    conn.execute("DELETE FROM notes WHERE id = ?1", params![note_id])
}

pub fn get_global_reading_settings(conn: &Connection) -> SqliteResult<ReadingSettings> {
    conn.query_row(
        "SELECT theme,font_family,font_size_px,line_height_multiplier,paragraph_spacing_multiplier,text_indent_em,margin_top_px,margin_bottom_px,margin_left_percent,margin_right_percent,max_column_width_px,flow,spread,updated_at FROM global_reading_settings WHERE singleton_id = 1",
        [],
        row_to_reading_settings,
    )
}

pub fn get_book_reading_settings(
    conn: &Connection,
    book_id: &str,
) -> SqliteResult<Option<BookReadingSettings>> {
    conn.query_row(
        "SELECT book_id,theme,font_family,font_size_px,line_height_multiplier,paragraph_spacing_multiplier,text_indent_em,margin_top_px,margin_bottom_px,margin_left_percent,margin_right_percent,max_column_width_px,flow,spread,updated_at FROM book_reading_settings WHERE book_id = ?1",
        params![book_id],
        row_to_book_reading_settings,
    )
    .optional()
}

pub fn save_global_reading_settings(
    conn: &Connection,
    settings: &ReadingSettings,
) -> SqliteResult<()> {
    conn.execute(
        "UPDATE global_reading_settings SET theme=?1,font_family=?2,font_size_px=?3,line_height_multiplier=?4,paragraph_spacing_multiplier=?5,text_indent_em=?6,margin_top_px=?7,margin_bottom_px=?8,margin_left_percent=?9,margin_right_percent=?10,max_column_width_px=?11,flow=?12,spread=?13,updated_at=?14 WHERE singleton_id=1",
        params![settings.theme,settings.font_family,settings.font_size_px,settings.line_height_multiplier,settings.paragraph_spacing_multiplier,settings.text_indent_em,settings.margin_top_px,settings.margin_bottom_px,settings.margin_left_percent,settings.margin_right_percent,settings.max_column_width_px,settings.flow,settings.spread,settings.updated_at],
    )?;
    Ok(())
}

pub fn save_book_reading_settings(
    conn: &Connection,
    settings: &BookReadingSettings,
) -> SqliteResult<()> {
    conn.execute(
        "INSERT INTO book_reading_settings (book_id,theme,font_family,font_size_px,line_height_multiplier,paragraph_spacing_multiplier,text_indent_em,margin_top_px,margin_bottom_px,margin_left_percent,margin_right_percent,max_column_width_px,flow,spread,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15) ON CONFLICT(book_id) DO UPDATE SET theme=excluded.theme,font_family=excluded.font_family,font_size_px=excluded.font_size_px,line_height_multiplier=excluded.line_height_multiplier,paragraph_spacing_multiplier=excluded.paragraph_spacing_multiplier,text_indent_em=excluded.text_indent_em,margin_top_px=excluded.margin_top_px,margin_bottom_px=excluded.margin_bottom_px,margin_left_percent=excluded.margin_left_percent,margin_right_percent=excluded.margin_right_percent,max_column_width_px=excluded.max_column_width_px,flow=excluded.flow,spread=excluded.spread,updated_at=excluded.updated_at",
        params![settings.book_id,settings.theme,settings.font_family,settings.font_size_px,settings.line_height_multiplier,settings.paragraph_spacing_multiplier,settings.text_indent_em,settings.margin_top_px,settings.margin_bottom_px,settings.margin_left_percent,settings.margin_right_percent,settings.max_column_width_px,settings.flow,settings.spread,settings.updated_at],
    )?;
    Ok(())
}

pub fn clear_book_reading_settings(conn: &Connection, book_id: &str) -> SqliteResult<()> {
    conn.execute(
        "DELETE FROM book_reading_settings WHERE book_id = ?1",
        params![book_id],
    )?;
    Ok(())
}

fn row_to_reading_settings(row: &rusqlite::Row) -> SqliteResult<ReadingSettings> {
    Ok(ReadingSettings {
        theme: row.get(0)?,
        font_family: row.get(1)?,
        font_size_px: row.get(2)?,
        line_height_multiplier: row.get(3)?,
        paragraph_spacing_multiplier: row.get(4)?,
        text_indent_em: row.get(5)?,
        margin_top_px: row.get(6)?,
        margin_bottom_px: row.get(7)?,
        margin_left_percent: row.get(8)?,
        margin_right_percent: row.get(9)?,
        max_column_width_px: row.get(10)?,
        flow: row.get(11)?,
        spread: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn row_to_book_reading_settings(row: &rusqlite::Row) -> SqliteResult<BookReadingSettings> {
    Ok(BookReadingSettings {
        book_id: row.get(0)?,
        theme: row.get(1)?,
        font_family: row.get(2)?,
        font_size_px: row.get(3)?,
        line_height_multiplier: row.get(4)?,
        paragraph_spacing_multiplier: row.get(5)?,
        text_indent_em: row.get(6)?,
        margin_top_px: row.get(7)?,
        margin_bottom_px: row.get(8)?,
        margin_left_percent: row.get(9)?,
        margin_right_percent: row.get(10)?,
        max_column_width_px: row.get(11)?,
        flow: row.get(12)?,
        spread: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

// ── Serde rename util ──────────────────────────────────────────────

fn serde_rename<T: serde::Serialize>(val: &T) -> String {
    serde_json::to_value(val)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use rusqlite::Connection;

    fn seeded_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run_migrations(&conn).unwrap();
        conn
    }

    fn sample_book(id: &str, title: &str, locator: &str) -> Book {
        let now = 1_700_000_000_000i64;
        Book {
            id: id.to_string(),
            title: title.to_string(),
            authors: vec!["Test Author".to_string()],
            format: BookFormat::Epub,
            cover_cache_path: None,
            source_locator: locator.to_string(),
            source_kind: SourceKind::DesktopPath,
            file_size_bytes: 4096,
            last_modified_ts: now,
            package_identifier: Some(format!("uuid-{}", id)),
            status: BookStatus::Available,
            status_detail: None,
            added_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn test_insert_and_find_by_id() {
        let conn = seeded_db();
        let book = sample_book("b1", "Test Book", "/tmp/test.epub");
        insert_book(&conn, &book).unwrap();

        let found = find_book_by_id(&conn, "b1").unwrap().unwrap();
        assert_eq!(found.title, "Test Book");
        assert_eq!(found.source_locator, "/tmp/test.epub");
        assert_eq!(found.authors, vec!["Test Author"]);
    }

    #[test]
    fn test_find_by_source_locator() {
        let conn = seeded_db();
        let book = sample_book("b2", "Locator Book", "/tmp/locator.epub");
        insert_book(&conn, &book).unwrap();

        let found = find_book_by_source_locator(&conn, "/tmp/locator.epub")
            .unwrap()
            .unwrap();
        assert_eq!(found.id, "b2");
    }

    #[test]
    fn test_update_book_by_source() {
        let conn = seeded_db();
        let mut book = sample_book("b3", "Original", "/tmp/update.epub");
        insert_book(&conn, &book).unwrap();

        book.title = "Updated".to_string();
        book.status = BookStatus::Missing;
        book.status_detail = Some("file moved".to_string());
        update_book_by_source(&conn, &book).unwrap();

        let found = find_book_by_id(&conn, "b3").unwrap().unwrap();
        assert_eq!(found.title, "Updated");
        assert!(matches!(found.status, BookStatus::Missing));
        assert_eq!(found.status_detail.as_deref(), Some("file moved"));
    }

    #[test]
    fn test_update_book_by_source_preserves_reading_progress() {
        let conn = seeded_db();
        let mut book = sample_book("same-source", "Original", "/tmp/same-source.epub");
        insert_book(&conn, &book).unwrap();
        upsert_reading_progress(
            &conn,
            &ReadingProgress {
                book_id: book.id.clone(),
                location_cfi: Some("epubcfi(/6/4)".into()),
                progression: Some(0.4),
                updated_at: 1,
            },
        )
        .unwrap();

        book.title = "Reimported".into();
        book.status = BookStatus::Available;
        update_book_by_source(&conn, &book).unwrap();

        let progress = get_reading_progress(&conn, &book.id).unwrap().unwrap();
        assert_eq!(progress.location_cfi.as_deref(), Some("epubcfi(/6/4)"));
        assert_eq!(progress.progression, Some(0.4));
    }

    #[test]
    fn test_update_book_by_id_can_relocate_and_preserve_reading_progress() {
        let conn = seeded_db();
        let mut book = sample_book("relocated", "Original", "/tmp/old.epub");
        book.status = BookStatus::Missing;
        insert_book(&conn, &book).unwrap();
        upsert_reading_progress(
            &conn,
            &ReadingProgress {
                book_id: book.id.clone(),
                location_cfi: Some("epubcfi(/6/8)".into()),
                progression: Some(0.6),
                updated_at: 1,
            },
        )
        .unwrap();

        book.source_locator = "/tmp/new.epub".into();
        book.status = BookStatus::Available;
        update_book_by_id(&conn, &book).unwrap();

        let restored = find_book_by_id(&conn, &book.id).unwrap().unwrap();
        assert_eq!(restored.source_locator, "/tmp/new.epub");
        assert!(matches!(restored.status, BookStatus::Available));
        let progress = get_reading_progress(&conn, &book.id).unwrap().unwrap();
        assert_eq!(progress.location_cfi.as_deref(), Some("epubcfi(/6/8)"));
        assert_eq!(progress.progression, Some(0.6));
    }

    #[test]
    fn test_list_all_books_order() {
        let conn = seeded_db();
        let mut b1 = sample_book("b4", "Alpha", "/tmp/a.epub");
        b1.updated_at = 1000;
        let mut b2 = sample_book("b5", "Beta", "/tmp/b.epub");
        b2.updated_at = 2000;
        insert_book(&conn, &b1).unwrap();
        insert_book(&conn, &b2).unwrap();

        let books = list_all_books(&conn).unwrap();
        assert_eq!(books.len(), 2);
        // Most recent first
        assert_eq!(books[0].title, "Beta");
        assert_eq!(books[1].title, "Alpha");
    }

    #[test]
    fn test_list_recoverable_books_excludes_available_rows() {
        let conn = seeded_db();
        let available = sample_book("available", "Available", "/tmp/available.epub");
        let mut missing = sample_book("missing", "Missing", "/tmp/missing.epub");
        missing.status = BookStatus::Missing;
        let mut error = sample_book("error", "Error", "/tmp/error.epub");
        error.status = BookStatus::Error;
        insert_book(&conn, &available).unwrap();
        insert_book(&conn, &missing).unwrap();
        insert_book(&conn, &error).unwrap();

        let recoverable = list_recoverable_books(&conn).unwrap();
        assert_eq!(recoverable.len(), 2);
        assert!(recoverable
            .iter()
            .all(|book| matches!(book.status, BookStatus::Missing | BookStatus::Error)));
    }

    #[test]
    fn test_upsert_and_get_reading_progress() {
        let conn = seeded_db();
        let book = sample_book("b6", "Progress Book", "/tmp/progress.epub");
        insert_book(&conn, &book).unwrap();

        // No progress yet
        assert!(get_reading_progress(&conn, "b6").unwrap().is_none());

        let rp = ReadingProgress {
            book_id: "b6".to_string(),
            location_cfi: Some("/6/4[chap01]!/4/2".to_string()),
            progression: Some(0.5),
            updated_at: 1_700_000_000_000,
        };
        upsert_reading_progress(&conn, &rp).unwrap();

        let saved = get_reading_progress(&conn, "b6").unwrap().unwrap();
        assert_eq!(saved.location_cfi, rp.location_cfi);
        assert!((saved.progression.unwrap() - 0.5).abs() < f64::EPSILON);

        // Upsert again — should update, not duplicate
        let rp2 = ReadingProgress {
            book_id: "b6".to_string(),
            location_cfi: Some("/6/4[chap02]!/4/2".to_string()),
            progression: Some(0.75),
            updated_at: 1_700_000_001_000,
        };
        upsert_reading_progress(&conn, &rp2).unwrap();
        let saved2 = get_reading_progress(&conn, "b6").unwrap().unwrap();
        assert_eq!(saved2.location_cfi, rp2.location_cfi);
    }

    #[test]
    fn test_cascade_delete_removes_progress() {
        let conn = seeded_db();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

        let mut book = sample_book("b7", "Cascade Book", "/tmp/cascade.epub");
        book.cover_cache_path = Some("/tmp/covers/b7.jpg".to_string());
        insert_book(&conn, &book).unwrap();

        let rp = ReadingProgress {
            book_id: "b7".to_string(),
            location_cfi: Some("/6/4".to_string()),
            progression: Some(0.3),
            updated_at: 1_700_000_000_000,
        };
        upsert_reading_progress(&conn, &rp).unwrap();
        assert!(get_reading_progress(&conn, "b7").unwrap().is_some());

        // Use the real delete_book — should cascade-delete progress
        let (source_locator, cover) = delete_book(&conn, "b7").unwrap();
        assert_eq!(source_locator, "/tmp/cascade.epub");
        assert_eq!(cover.as_deref(), Some("/tmp/covers/b7.jpg"));
        assert!(get_reading_progress(&conn, "b7").unwrap().is_none());
    }

    #[test]
    fn test_delete_book_removes_row() {
        let conn = seeded_db();
        let book = sample_book("b8", "Delete Me", "/tmp/delete.epub");
        insert_book(&conn, &book).unwrap();
        assert!(find_book_by_id(&conn, "b8").unwrap().is_some());

        delete_book(&conn, "b8").unwrap();
        assert!(find_book_by_id(&conn, "b8").unwrap().is_none());
    }

    #[test]
    fn test_delete_book_nonexistent() {
        let conn = seeded_db();
        let result = delete_book(&conn, "no-such-id");
        assert!(result.is_err());
    }

    #[test]
    fn test_find_nonexistent_book() {
        let conn = seeded_db();
        assert!(find_book_by_id(&conn, "nonexistent").unwrap().is_none());
    }

    #[test]
    fn test_book_reading_settings_roundtrip_and_clear() {
        let conn = seeded_db();
        insert_book(
            &conn,
            &sample_book("settings", "Settings", "/tmp/settings.epub"),
        )
        .unwrap();
        let settings = BookReadingSettings {
            book_id: "settings".into(),
            theme: Some("sepia".into()),
            font_family: None,
            font_size_px: Some(20),
            line_height_multiplier: None,
            paragraph_spacing_multiplier: Some(0.8),
            text_indent_em: None,
            margin_top_px: None,
            margin_bottom_px: None,
            margin_left_percent: Some(7),
            margin_right_percent: None,
            max_column_width_px: Some(800),
            flow: None,
            spread: None,
            updated_at: 42,
        };
        save_book_reading_settings(&conn, &settings).unwrap();
        let loaded = get_book_reading_settings(&conn, "settings")
            .unwrap()
            .unwrap();
        assert_eq!(loaded.theme.as_deref(), Some("sepia"));
        assert_eq!(loaded.font_size_px, Some(20));
        assert_eq!(loaded.paragraph_spacing_multiplier, Some(0.8));
        clear_book_reading_settings(&conn, "settings").unwrap();
        assert!(get_book_reading_settings(&conn, "settings")
            .unwrap()
            .is_none());
    }

    #[test]
    fn test_enum_roundtrip() {
        // Verify that serde_rename produces the correct CHECK-compatible strings
        assert_eq!(serde_rename(&BookFormat::Epub), "epub");
        assert_eq!(serde_rename(&BookFormat::Pdf), "pdf");
        assert_eq!(serde_rename(&SourceKind::DesktopPath), "desktop_path");
        assert_eq!(
            serde_rename(&SourceKind::AndroidContentUri),
            "android_content_uri"
        );
        assert_eq!(serde_rename(&BookStatus::Available), "available");
        assert_eq!(serde_rename(&BookStatus::Missing), "missing");
        assert_eq!(serde_rename(&BookStatus::Error), "error");
    }
}
