use tauri::{AppHandle, State};

use crate::commands::AppState;
use crate::db::models::{SearchIndexStatus, SearchResult, SearchTaskStatus};
use crate::services;

#[tauri::command]
pub fn ensure_series_search_index(
    app: AppHandle,
    state: State<AppState>,
    series_id: String,
) -> Result<SearchTaskStatus, String> {
    services::ensure_series_search_index(&app, &state.db, &state.search_tasks, series_id, false)
}

#[tauri::command]
pub fn rebuild_search_index(
    app: AppHandle,
    state: State<AppState>,
    series_id: String,
) -> Result<SearchTaskStatus, String> {
    services::ensure_series_search_index(&app, &state.db, &state.search_tasks, series_id, true)
}

#[tauri::command]
pub fn get_search_index_status(
    state: State<AppState>,
    series_id: String,
) -> Result<SearchIndexStatus, String> {
    services::get_search_index_status(&state.db, &series_id)
}

#[tauri::command]
pub fn cancel_search_index(state: State<AppState>, task_id: String) -> Result<(), String> {
    services::cancel_search_index(&state.search_tasks, &task_id)
}

#[tauri::command]
pub fn search_series(
    state: State<AppState>,
    series_id: String,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<SearchResult>, String> {
    services::search_series(&state.db, &series_id, query, limit)
}
