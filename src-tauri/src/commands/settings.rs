use crate::commands::AppState;
use crate::db::models::{
    BookReadingSettings, BookReadingSettingsInput, ReadingSettings, ReadingSettingsInput,
    ReadingSettingsResult,
};
use crate::services;

#[tauri::command]
pub fn get_reading_settings(
    state: tauri::State<AppState>,
    book_id: String,
) -> Result<ReadingSettingsResult, String> {
    services::get_reading_settings(&state.db, &book_id)
}

#[tauri::command]
pub fn get_global_reading_settings(
    state: tauri::State<AppState>,
) -> Result<ReadingSettings, String> {
    services::get_global_reading_settings(&state.db)
}

#[tauri::command]
pub fn save_global_reading_settings(
    state: tauri::State<AppState>,
    settings: ReadingSettingsInput,
) -> Result<ReadingSettings, String> {
    services::save_global_reading_settings(&state.db, settings)
}

#[tauri::command]
pub fn save_book_reading_settings(
    state: tauri::State<AppState>,
    settings: BookReadingSettingsInput,
) -> Result<BookReadingSettings, String> {
    services::save_book_reading_settings(&state.db, settings)
}

#[tauri::command]
pub fn clear_book_reading_settings(
    state: tauri::State<AppState>,
    book_id: String,
) -> Result<(), String> {
    services::clear_book_reading_settings(&state.db, &book_id)
}
