use tauri::AppHandle;

use crate::commands::AppState;
use crate::services;

#[tauri::command]
pub async fn save_book_image(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    book_id: String,
    entry_path: String,
) -> Result<bool, String> {
    services::save_book_image(
        &app,
        &state.db,
        &state.source_manager,
        &book_id,
        &entry_path,
    )
}
