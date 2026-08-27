use tauri::{AppHandle, Manager, State};

use crate::commands::AppState;
use crate::services::{self, PrivateDataReport};

/// Returns a physical app-data breakdown only in the explicitly controlled
/// B3 diagnostic build. This command is intentionally absent from normal
/// release builds and never writes a report into the measured data root.
#[tauri::command]
pub fn get_b3_private_data_report(
    app: AppHandle,
    state: State<AppState>,
) -> Result<PrivateDataReport, String> {
    let app_data_root = app
        .path()
        .app_data_dir()
        .map_err(|_| "INTERNAL_ERROR: failed to resolve private data root".to_string())?;
    let db = state
        .db
        .lock()
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())?;
    let report = services::collect_private_data_report(&app_data_root, &db)?;
    let serialized = serde_json::to_string(&report)
        .map_err(|_| "INTERNAL_ERROR: private data report serialization failed".to_string())?;
    eprintln!("[B3_PRIVATE_DATA_REPORT] {serialized}");
    Ok(report)
}
