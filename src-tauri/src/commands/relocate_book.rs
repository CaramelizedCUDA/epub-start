use tauri::AppHandle;

use crate::commands::AppState;
use crate::db::models::{Book, SelectedSource};
use crate::services;

#[tauri::command]
pub fn relocate_book(
    app: AppHandle,
    state: tauri::State<AppState>,
    book_id: String,
    source: SelectedSource,
) -> Result<Book, String> {
    services::relocate_book(&app, &state.db, &state.source_manager, &book_id, source)
}
