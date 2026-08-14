use crate::commands::AppState;
use crate::db::models::BookSummary;
use crate::services;

/// Returns every book in the library ordered by most recently updated.
/// Source-locator fields are excluded from the response for privacy.
#[tauri::command]
pub fn list_books(state: tauri::State<AppState>) -> Result<Vec<BookSummary>, String> {
    services::list_books(&state.db)
}
