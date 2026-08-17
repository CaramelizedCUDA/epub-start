use std::sync::Mutex;

use rusqlite::Connection;

use crate::db::models::{CreateNoteInput, Note, UpdateNoteInput};
use crate::db::repository;

const MAX_CFI_LENGTH: usize = 4_096;
const MAX_SELECTED_TEXT_LENGTH: usize = 10_000;
const MAX_CONTENT_LENGTH: usize = 20_000;

pub fn list_notes(db: &Mutex<Connection>, book_id: &str) -> Result<Vec<Note>, String> {
    let conn = lock_db(db)?;
    require_book(&conn, book_id)?;
    repository::list_notes(&conn, book_id)
        .map_err(|_| "INTERNAL_ERROR: note query failed".to_string())
}

pub fn create_note(db: &Mutex<Connection>, mut input: CreateNoteInput) -> Result<Note, String> {
    normalize_note_fields(
        &mut input.cfi_start,
        &mut input.cfi_end,
        &mut input.cfi_range,
        &mut input.selected_text,
        &mut input.content,
        &mut input.color,
    )?;
    let conn = lock_db(db)?;
    require_book(&conn, &input.book_id)?;
    let now = super::now_ms();
    let note = Note {
        id: uuid::Uuid::new_v4().to_string(),
        book_id: input.book_id,
        cfi_start: input.cfi_start,
        cfi_end: input.cfi_end,
        cfi_range: input.cfi_range,
        selected_text: input.selected_text,
        content: input.content,
        color: input.color,
        created_at: now,
        updated_at: now,
    };
    repository::insert_note(&conn, &note)
        .map_err(|_| "INTERNAL_ERROR: note insert failed".to_string())?;
    Ok(note)
}

pub fn update_note(db: &Mutex<Connection>, mut input: UpdateNoteInput) -> Result<Note, String> {
    normalize_note_fields(
        &mut input.cfi_start,
        &mut input.cfi_end,
        &mut input.cfi_range,
        &mut input.selected_text,
        &mut input.content,
        &mut input.color,
    )?;
    let conn = lock_db(db)?;
    let existing = repository::find_note_by_id(&conn, &input.id)
        .map_err(|_| "INTERNAL_ERROR: note query failed".to_string())?
        .ok_or_else(|| format!("NOTE_NOT_FOUND: no note with id {}", input.id))?;
    let note = Note {
        id: input.id,
        book_id: existing.book_id,
        cfi_start: input.cfi_start,
        cfi_end: input.cfi_end,
        cfi_range: input.cfi_range,
        selected_text: input.selected_text,
        content: input.content,
        color: input.color,
        created_at: existing.created_at,
        updated_at: super::now_ms(),
    };
    repository::update_note(&conn, &note)
        .map_err(|_| "INTERNAL_ERROR: note update failed".to_string())?;
    Ok(note)
}

pub fn delete_note(db: &Mutex<Connection>, note_id: &str) -> Result<(), String> {
    let conn = lock_db(db)?;
    if repository::delete_note(&conn, note_id)
        .map_err(|_| "INTERNAL_ERROR: note delete failed".to_string())?
        == 0
    {
        return Err(format!("NOTE_NOT_FOUND: no note with id {note_id}"));
    }
    Ok(())
}

fn normalize_note_fields(
    cfi_start: &mut String,
    cfi_end: &mut String,
    cfi_range: &mut Option<String>,
    selected_text: &mut String,
    content: &mut String,
    color: &mut String,
) -> Result<(), String> {
    *cfi_start = cfi_start.trim().to_string();
    *cfi_end = cfi_end.trim().to_string();
    *cfi_range = cfi_range
        .take()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    *selected_text = selected_text.trim().to_string();
    *content = content.trim().to_string();
    *color = normalize_color(color)?;

    if cfi_start.is_empty() || cfi_end.is_empty() {
        return Err("VALIDATION_ERROR: note CFI must not be empty".into());
    }
    if cfi_start.chars().count() > MAX_CFI_LENGTH
        || cfi_end.chars().count() > MAX_CFI_LENGTH
        || cfi_range
            .as_deref()
            .is_some_and(|value| value.chars().count() > MAX_CFI_LENGTH)
    {
        return Err("VALIDATION_ERROR: CFI is too long".into());
    }
    if selected_text.chars().count() > MAX_SELECTED_TEXT_LENGTH {
        return Err("VALIDATION_ERROR: selected text is too long".into());
    }
    if content.chars().count() > MAX_CONTENT_LENGTH {
        return Err("VALIDATION_ERROR: note content is too long".into());
    }
    Ok(())
}

fn normalize_color(color: &str) -> Result<String, String> {
    let color = color.trim();
    if color.len() != 7
        || !color.starts_with('#')
        || !color[1..].bytes().all(|value| value.is_ascii_hexdigit())
    {
        return Err("VALIDATION_ERROR: note color must be #RRGGBB".into());
    }
    Ok(color.to_ascii_lowercase())
}

fn require_book(conn: &Connection, book_id: &str) -> Result<(), String> {
    if repository::find_book_by_id(conn, book_id)
        .map_err(|_| "INTERNAL_ERROR: book query failed".to_string())?
        .is_none()
    {
        return Err(format!("BOOK_NOT_FOUND: no book with id {book_id}"));
    }
    Ok(())
}

fn lock_db(db: &Mutex<Connection>) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.lock()
        .map_err(|_| "INTERNAL_ERROR: database is unavailable".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::run_migrations;

    fn test_db() -> Mutex<Connection> {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO books VALUES ('b','Title','[]','epub',NULL,'/book.epub','desktop_path',1,2,NULL,'available',NULL,3,4)",
            [],
        )
        .unwrap();
        Mutex::new(conn)
    }

    fn valid_input() -> CreateNoteInput {
        CreateNoteInput {
            book_id: "b".into(),
            cfi_start: "epubcfi(/6/4[chap01]!/4[body01]/10[para05]/3:10)".into(),
            cfi_end: "epubcfi(/6/4[chap01]!/4[body01]/10[para05]/5:2)".into(),
            cfi_range: Some(
                "epubcfi(/6/4[chap01]!/4[body01]/10[para05]/3:10,/6/4[chap01]!/4[body01]/10[para05]/5:2)"
                    .into(),
            ),
            selected_text: "selected words".into(),
            content: "".into(),
            color: "#AABBCC".into(),
        }
    }

    #[test]
    fn create_note_normalizes_color_and_generates_audit_fields() {
        let db = test_db();
        let note = create_note(&db, valid_input()).unwrap();
        assert!(!note.id.is_empty());
        assert_eq!(note.color, "#aabbcc");
        assert_eq!(note.book_id, "b");
        assert!(note.created_at > 0);
        assert_eq!(note.updated_at, note.created_at);
        let listed = list_notes(&db, "b").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, note.id);
    }

    #[test]
    fn cfi_round_trips_through_database_exactly() {
        let db = test_db();
        let input = valid_input();
        let created = create_note(&db, input.clone()).unwrap();
        let listed = list_notes(&db, "b").unwrap();
        assert_eq!(listed.len(), 1);
        let stored = &listed[0];
        assert_eq!(stored.id, created.id);
        assert_eq!(stored.cfi_start, input.cfi_start);
        assert_eq!(stored.cfi_end, input.cfi_end);
        assert_eq!(stored.cfi_range, input.cfi_range);
        assert_eq!(stored.selected_text, input.selected_text);
    }

    #[test]
    fn note_survives_database_reopen_with_every_recovery_field() {
        struct RemoveDbOnDrop(std::path::PathBuf);

        impl Drop for RemoveDbOnDrop {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }

        let db_path = std::env::temp_dir().join(format!(
            "epub-start-note-restart-{}.db",
            uuid::Uuid::new_v4()
        ));
        let _cleanup = RemoveDbOnDrop(db_path.clone());
        let created = {
            let conn = Connection::open(&db_path).unwrap();
            run_migrations(&conn).unwrap();
            conn.execute(
                "INSERT INTO books VALUES ('b','Title','[]','epub',NULL,'/book.epub','desktop_path',1,2,NULL,'available',NULL,3,4)",
                [],
            )
            .unwrap();
            let db = Mutex::new(conn);
            create_note(&db, valid_input()).unwrap()
        };

        let restored = {
            let conn = Connection::open(&db_path).unwrap();
            run_migrations(&conn).unwrap();
            let db = Mutex::new(conn);
            let notes = list_notes(&db, "b").unwrap();
            assert_eq!(notes.len(), 1);
            notes.into_iter().next().unwrap()
        };

        assert_eq!(restored.id, created.id);
        assert_eq!(restored.book_id, created.book_id);
        assert_eq!(restored.cfi_start, created.cfi_start);
        assert_eq!(restored.cfi_end, created.cfi_end);
        assert_eq!(restored.cfi_range, created.cfi_range);
        assert_eq!(restored.selected_text, created.selected_text);
        assert_eq!(restored.content, created.content);
        assert_eq!(restored.color, created.color);
        assert_eq!(restored.created_at, created.created_at);
        assert_eq!(restored.updated_at, created.updated_at);
    }

    #[test]
    fn note_text_contract_trims_outer_whitespace_and_preserves_literal_text() {
        let db = test_db();
        let mut input = valid_input();
        input.cfi_start = format!(" \n{}\t", input.cfi_start);
        input.cfi_end = format!("\t{} \n", input.cfi_end);
        input.cfi_range = input.cfi_range.map(|value| format!(" \n{value}\t"));
        input.selected_text = " \n<strong>selected</strong>\t".into();
        input.content = " \n<script>alert('literal')</script>\t".into();
        input.color = " #ABCDEF ".into();

        let created = create_note(&db, input).unwrap();
        assert!(created.cfi_start.starts_with("epubcfi("));
        assert!(created.cfi_end.starts_with("epubcfi("));
        assert!(created
            .cfi_range
            .as_deref()
            .is_some_and(|value| value.starts_with("epubcfi(")));
        assert_eq!(created.selected_text, "<strong>selected</strong>");
        assert_eq!(created.content, "<script>alert('literal')</script>");
        assert_eq!(created.color, "#abcdef");

        let updated = update_note(
            &db,
            UpdateNoteInput {
                id: created.id.clone(),
                cfi_start: format!(" {} ", created.cfi_start),
                cfi_end: format!(" {} ", created.cfi_end),
                cfi_range: Some(" \n\t ".into()),
                selected_text: " <em>updated selection</em> ".into(),
                content: " first line\nsecond line ".into(),
                color: " #123ABC ".into(),
            },
        )
        .unwrap();
        assert_eq!(updated.cfi_start, created.cfi_start);
        assert_eq!(updated.cfi_end, created.cfi_end);
        assert_eq!(updated.cfi_range, None);
        assert_eq!(updated.selected_text, "<em>updated selection</em>");
        assert_eq!(updated.content, "first line\nsecond line");
        assert_eq!(updated.color, "#123abc");

        let listed = list_notes(&db, "b").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].selected_text, updated.selected_text);
        assert_eq!(listed[0].content, updated.content);
        assert_eq!(listed[0].cfi_range, None);
    }

    #[test]
    fn create_note_rejects_empty_or_whitespace_only_cfi() {
        let db = test_db();
        for (cfi_start, cfi_end) in [
            (String::new(), "epubcfi(/6/4)".into()),
            (" \n\t ".into(), "epubcfi(/6/4)".into()),
            ("epubcfi(/6/4)".into(), " \n\t ".into()),
        ] {
            let mut input = valid_input();
            input.cfi_start = cfi_start;
            input.cfi_end = cfi_end;
            let err = create_note(&db, input).unwrap_err();
            assert!(
                err.starts_with("VALIDATION_ERROR:"),
                "unexpected error: {err}"
            );
        }
    }

    #[test]
    fn create_note_rejects_overlong_cfi() {
        let db = test_db();
        let mut input = valid_input();
        input.cfi_start = "x".repeat(4_097);
        let err = create_note(&db, input).unwrap_err();
        assert!(err.contains("CFI is too long"), "unexpected error: {err}");
    }

    #[test]
    fn create_note_rejects_overlong_range_cfi() {
        let db = test_db();
        let mut input = valid_input();
        input.cfi_range = Some("x".repeat(4_097));
        let err = create_note(&db, input).unwrap_err();
        assert!(err.contains("CFI is too long"), "unexpected error: {err}");
    }

    #[test]
    fn create_note_rejects_overlong_selected_text() {
        let db = test_db();
        let mut input = valid_input();
        input.selected_text = "x".repeat(10_001);
        let err = create_note(&db, input).unwrap_err();
        assert!(
            err.contains("selected text is too long"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn create_note_rejects_overlong_content() {
        let db = test_db();
        let mut input = valid_input();
        input.content = "x".repeat(20_001);
        let err = create_note(&db, input).unwrap_err();
        assert!(
            err.contains("note content is too long"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn create_note_accepts_unicode_fields_at_character_limits() {
        let db = test_db();
        let mut input = valid_input();
        input.cfi_start = "界".repeat(4_096);
        input.cfi_end = "終".repeat(4_096);
        input.cfi_range = Some("範".repeat(4_096));
        input.selected_text = "選".repeat(10_000);
        input.content = "注".repeat(20_000);

        let note = create_note(&db, input).unwrap();
        assert_eq!(note.cfi_start.chars().count(), 4_096);
        assert_eq!(note.cfi_end.chars().count(), 4_096);
        assert_eq!(
            note.cfi_range
                .as_deref()
                .map(str::chars)
                .map(Iterator::count),
            Some(4_096)
        );
        assert_eq!(note.selected_text.chars().count(), 10_000);
        assert_eq!(note.content.chars().count(), 20_000);
    }

    #[test]
    fn create_note_rejects_invalid_color() {
        let db = test_db();
        for bad in ["red", "#12345", "#12345g", "112233", "##112233"] {
            let mut input = valid_input();
            input.color = bad.into();
            let err = create_note(&db, input).unwrap_err();
            assert!(
                err.contains("color must be #RRGGBB"),
                "color {bad:?} produced: {err}"
            );
        }
    }

    #[test]
    fn create_note_trims_and_normalizes_whitespace_padded_color() {
        let db = test_db();
        let mut input = valid_input();
        input.color = " #112233 ".into();
        let note = create_note(&db, input).unwrap();
        assert_eq!(note.color, "#112233");
    }

    #[test]
    fn create_note_rejects_unknown_book() {
        let db = test_db();
        let mut input = valid_input();
        input.book_id = "missing".into();
        let err = create_note(&db, input).unwrap_err();
        assert!(
            err.starts_with("BOOK_NOT_FOUND:"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn list_notes_rejects_unknown_book() {
        let db = test_db();
        let err = list_notes(&db, "missing").unwrap_err();
        assert!(
            err.starts_with("BOOK_NOT_FOUND:"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn update_note_preserves_book_id_and_created_at() {
        let db = test_db();
        let created = create_note(&db, valid_input()).unwrap();
        let update = UpdateNoteInput {
            id: created.id.clone(),
            cfi_start: created.cfi_start.clone(),
            cfi_end: created.cfi_end.clone(),
            cfi_range: created.cfi_range.clone(),
            selected_text: created.selected_text.clone(),
            content: "new annotation text".into(),
            color: "#00FF00".into(),
        };
        let updated = update_note(&db, update).unwrap();
        assert_eq!(updated.book_id, created.book_id);
        assert_eq!(updated.created_at, created.created_at);
        assert_eq!(updated.color, "#00ff00");
        assert_eq!(updated.content, "new annotation text");
        assert!(updated.updated_at >= created.updated_at);
    }

    #[test]
    fn update_note_rejects_overlong_content() {
        let db = test_db();
        let created = create_note(&db, valid_input()).unwrap();
        let update = UpdateNoteInput {
            id: created.id.clone(),
            cfi_start: created.cfi_start,
            cfi_end: created.cfi_end,
            cfi_range: created.cfi_range,
            selected_text: created.selected_text,
            content: "x".repeat(20_001),
            color: created.color,
        };
        let err = update_note(&db, update).unwrap_err();
        assert!(
            err.contains("note content is too long"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn update_missing_note_returns_not_found() {
        let db = test_db();
        let mut input = valid_input();
        input.content = "text".into();
        let update = UpdateNoteInput {
            id: "nope".into(),
            cfi_start: input.cfi_start,
            cfi_end: input.cfi_end,
            cfi_range: input.cfi_range,
            selected_text: input.selected_text,
            content: input.content,
            color: input.color,
        };
        let err = update_note(&db, update).unwrap_err();
        assert!(
            err.starts_with("NOTE_NOT_FOUND:"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn delete_note_removes_row_and_second_delete_fails() {
        let db = test_db();
        let created = create_note(&db, valid_input()).unwrap();
        delete_note(&db, &created.id).unwrap();
        assert!(list_notes(&db, "b").unwrap().is_empty());
        let err = delete_note(&db, &created.id).unwrap_err();
        assert!(
            err.starts_with("NOTE_NOT_FOUND:"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn concurrent_note_creation_preserves_all_rows() {
        let db = std::sync::Arc::new(test_db());
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let db = db.clone();
                std::thread::spawn(move || {
                    for _ in 0..20 {
                        create_note(&db, valid_input()).unwrap();
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
        assert_eq!(list_notes(&db, "b").unwrap().len(), 160);
    }

    #[test]
    fn failed_update_keeps_original_note_content() {
        let db = test_db();
        let created = create_note(&db, valid_input()).unwrap();
        let update = UpdateNoteInput {
            id: created.id.clone(),
            cfi_start: created.cfi_start.clone(),
            cfi_end: created.cfi_end.clone(),
            cfi_range: created.cfi_range.clone(),
            selected_text: created.selected_text.clone(),
            content: "keep me".into(),
            color: "not-a-color".into(),
        };
        assert!(update_note(&db, update).is_err());
        let listed = list_notes(&db, "b").unwrap();
        assert_eq!(listed[0].content, created.content);
    }

    #[test]
    fn deleting_book_cascades_notes() {
        let db = test_db();
        let created = create_note(&db, valid_input()).unwrap();
        let update = UpdateNoteInput {
            id: created.id,
            cfi_start: created.cfi_start,
            cfi_end: created.cfi_end,
            cfi_range: created.cfi_range,
            selected_text: created.selected_text,
            content: "must not survive book deletion".into(),
            color: created.color,
        };
        {
            let conn = db.lock().unwrap();
            crate::db::repository::delete_book(&conn, "b").unwrap();
        }
        let err = list_notes(&db, "b").unwrap_err();
        assert!(err.starts_with("BOOK_NOT_FOUND:"));
        let err = update_note(&db, update).unwrap_err();
        assert!(err.starts_with("NOTE_NOT_FOUND:"));
    }
}
