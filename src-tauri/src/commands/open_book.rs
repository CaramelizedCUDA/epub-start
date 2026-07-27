use tauri::AppHandle;

use crate::commands::AppState;
use crate::db::models::OpenBookResult;
use crate::services;

#[tauri::command]
pub fn open_book(
    app: AppHandle,
    state: tauri::State<AppState>,
    book_id: String,
) -> Result<OpenBookResult, String> {
    services::open_book(&app, &state.db, &book_id)
}
