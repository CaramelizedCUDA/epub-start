use crate::commands::AppState;
use crate::db::models::ReadingProgress;
use crate::db::repository;

/// Returns the saved reading progress for the given book, or `null`
/// (JSON `null`) if no progress has been recorded yet.
#[tauri::command]
pub fn get_reading_progress(
    state: tauri::State<AppState>,
    book_id: String,
) -> Result<Option<ReadingProgress>, String> {
    let db = state
        .db
        .lock()
        .map_err(|e| format!("internal error: db lock poisoned: {}", e))?;

    repository::get_reading_progress(&db, &book_id)
        .map_err(|e| format!("internal error: db query failed: {}", e))
}
