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

pub fn create_note(db: &Mutex<Connection>, input: CreateNoteInput) -> Result<Note, String> {
    validate_note_fields(
        &input.cfi_start,
        &input.cfi_end,
        input.cfi_range.as_deref(),
        &input.selected_text,
        &input.content,
        &input.color,
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
        color: normalize_color(&input.color)?,
        created_at: now,
        updated_at: now,
    };
    repository::insert_note(&conn, &note)
        .map_err(|_| "INTERNAL_ERROR: note insert failed".to_string())?;
    Ok(note)
}

pub fn update_note(db: &Mutex<Connection>, input: UpdateNoteInput) -> Result<Note, String> {
    validate_note_fields(
        &input.cfi_start,
        &input.cfi_end,
        input.cfi_range.as_deref(),
        &input.selected_text,
        &input.content,
        &input.color,
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
        color: normalize_color(&input.color)?,
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

fn validate_note_fields(
    cfi_start: &str,
    cfi_end: &str,
    cfi_range: Option<&str>,
    selected_text: &str,
    content: &str,
    color: &str,
) -> Result<(), String> {
    if cfi_start.is_empty() || cfi_end.is_empty() {
        return Err("VALIDATION_ERROR: note CFI must not be empty".into());
    }
    if cfi_start.chars().count() > MAX_CFI_LENGTH
        || cfi_end.chars().count() > MAX_CFI_LENGTH
        || cfi_range.is_some_and(|value| value.chars().count() > MAX_CFI_LENGTH)
    {
        return Err("VALIDATION_ERROR: CFI is too long".into());
    }
    if selected_text.chars().count() > MAX_SELECTED_TEXT_LENGTH {
        return Err("VALIDATION_ERROR: selected text is too long".into());
    }
    if content.chars().count() > MAX_CONTENT_LENGTH {
        return Err("VALIDATION_ERROR: note content is too long".into());
    }
    normalize_color(color)?;
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
