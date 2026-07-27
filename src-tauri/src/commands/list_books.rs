use crate::commands::AppState;
use crate::db::models::BookSummary;
use crate::db::repository;

/// Returns every book in the library ordered by most recently updated.
/// Source-locator fields are excluded from the response for privacy.
#[tauri::command]
pub fn list_books(state: tauri::State<AppState>) -> Result<Vec<BookSummary>, String> {
    let db = state
        .db
        .lock()
        .map_err(|e| format!("internal error: db lock poisoned: {}", e))?;

    repository::list_all_books(&db)
        .map(|books| books.into_iter().map(BookSummary::from).collect())
        .map_err(|e| format!("internal error: db query failed: {}", e))
}
