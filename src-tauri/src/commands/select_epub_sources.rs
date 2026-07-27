use tauri::AppHandle;

use crate::db::models::SelectedSource;
use crate::platform;

/// Opens OS-native file dialog filtered to .epub files and returns
/// selected source locators. Desktop uses `tauri-plugin-dialog`;
/// Android uses the project's own SAF plugin via `platform::select_epub_sources`.
#[tauri::command]
pub async fn select_epub_sources(app: AppHandle) -> Result<Vec<SelectedSource>, String> {
    platform::select_epub_sources(&app).await
}
