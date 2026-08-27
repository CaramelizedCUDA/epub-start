use crate::commands::AppState;
use crate::db::models::{
    DeleteReadingHistoryResult, LibraryReadingOverview, ReadingActivityReceipt,
    ReadingActivityState, ReadingFootprint, ReadingFootprintScope, ReadingHistoryScope,
    ReadingOverviewPeriod,
};
use crate::services;

#[tauri::command]
pub fn begin_reading_activity(
    state: tauri::State<AppState>,
    book_id: String,
    utc_offset_minutes: i64,
) -> Result<ReadingActivityReceipt, String> {
    services::begin_reading_activity(&state.db, &book_id, utc_offset_minutes)
}

#[tauri::command]
pub fn observe_reading_activity(
    state: tauri::State<AppState>,
    session_id: String,
    sequence: i64,
    activity_state: ReadingActivityState,
    utc_offset_minutes: i64,
) -> Result<ReadingActivityReceipt, String> {
    services::observe_reading_activity(
        &state.db,
        &session_id,
        sequence,
        activity_state,
        utc_offset_minutes,
    )
}

#[tauri::command]
pub fn get_library_reading_overview(
    state: tauri::State<AppState>,
    period: ReadingOverviewPeriod,
    anchor_local_date: String,
    utc_offset_minutes: i64,
) -> Result<LibraryReadingOverview, String> {
    services::get_library_reading_overview(
        &state.db,
        period,
        &anchor_local_date,
        utc_offset_minutes,
    )
}

#[tauri::command]
pub fn get_reading_footprint(
    state: tauri::State<AppState>,
    scope: ReadingFootprintScope,
) -> Result<ReadingFootprint, String> {
    services::get_reading_footprint(&state.db, scope)
}

#[tauri::command]
pub fn delete_reading_history(
    state: tauri::State<AppState>,
    scope: ReadingHistoryScope,
) -> Result<DeleteReadingHistoryResult, String> {
    services::delete_reading_history(&state.db, scope)
}
