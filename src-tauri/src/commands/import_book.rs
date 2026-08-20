use tauri::AppHandle;

use crate::commands::AppState;
use crate::db::models::{Book, SelectedSource};
use crate::services;

#[tauri::command]
pub fn import_book(
    app: AppHandle,
    state: tauri::State<AppState>,
    source: SelectedSource,
) -> Result<Book, String> {
    services::import_book(
        &app,
        &state.db,
        &state.cover_cache,
        &state.source_manager,
        source,
    )
}
