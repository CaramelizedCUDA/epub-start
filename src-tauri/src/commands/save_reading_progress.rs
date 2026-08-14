use crate::commands::AppState;
use crate::db::models::ReadingProgress;
use crate::services;

/// Persists the current reading position.
///
/// location_cfi must be a valid EPUB CFI string and progression
/// must be in the range [0.0, 1.0]. Uses upsert semantics so repeated
/// saves are idempotent. Validation, timestamps and the post-upsert
/// re-query live in services::save_reading_progress.
#[tauri::command]
pub fn save_reading_progress(
    state: tauri::State<AppState>,
    book_id: String,
    location_cfi: String,
    progression: f64,
) -> Result<ReadingProgress, String> {
    services::save_reading_progress(&state.db, book_id, location_cfi, progression)
}
