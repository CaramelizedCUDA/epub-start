use crate::commands::AppState;
use crate::db::models::ReadingProgress;
use crate::services;

/// Returns the saved reading progress for the given book, or null
/// (JSON null) if no progress has been recorded yet.
#[tauri::command]
pub fn get_reading_progress(
    state: tauri::State<AppState>,
    book_id: String,
) -> Result<Option<ReadingProgress>, String> {
    services::get_reading_progress(&state.db, &book_id)
}
