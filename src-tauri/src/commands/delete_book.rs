use tauri::AppHandle;

use crate::commands::AppState;
use crate::services;

#[tauri::command]
pub fn delete_book(
    app: AppHandle,
    state: tauri::State<AppState>,
    book_id: String,
) -> Result<String, String> {
    services::delete_book(
        &app,
        &state.db,
        &state.cover_cache,
        &state.source_manager,
        &book_id,
    )
}
