use crate::commands::AppState;
use crate::db::models::{
    BookSeries, BookTag, CreateSeriesInput, CreateTagGroupInput, CreateTagInput, Series,
    SeriesBookPosition, Tag, TagGroup, UpdateSeriesInput, UpdateTagGroupInput, UpdateTagInput,
};
use crate::services;

#[tauri::command]
pub fn list_series(state: tauri::State<AppState>) -> Result<Vec<Series>, String> {
    services::list_series(&state.db)
}
#[tauri::command]
pub fn create_series(
    state: tauri::State<AppState>,
    series: CreateSeriesInput,
) -> Result<Series, String> {
    services::create_series(&state.db, series)
}
#[tauri::command]
pub fn update_series(
    state: tauri::State<AppState>,
    series: UpdateSeriesInput,
) -> Result<Series, String> {
    services::update_series(&state.db, series)
}
#[tauri::command]
pub fn delete_series(state: tauri::State<AppState>, series_id: String) -> Result<(), String> {
    services::delete_series(&state.db, &series_id)
}
#[tauri::command]
pub fn set_book_series(
    state: tauri::State<AppState>,
    assignment: BookSeries,
) -> Result<BookSeries, String> {
    services::set_book_series(&state.db, assignment)
}
#[tauri::command]
pub fn clear_book_series(state: tauri::State<AppState>, book_id: String) -> Result<(), String> {
    services::clear_book_series(&state.db, &book_id)
}
#[tauri::command]
pub fn list_series_books(
    state: tauri::State<AppState>,
    series_id: String,
) -> Result<Vec<BookSeries>, String> {
    services::list_series_books(&state.db, &series_id)
}
#[tauri::command]
pub fn reorder_series_books(
    state: tauri::State<AppState>,
    series_id: String,
    positions: Vec<SeriesBookPosition>,
) -> Result<Vec<BookSeries>, String> {
    services::reorder_series_books(&state.db, &series_id, positions)
}
#[tauri::command]
pub fn list_tag_groups(state: tauri::State<AppState>) -> Result<Vec<TagGroup>, String> {
    services::list_tag_groups(&state.db)
}
#[tauri::command]
pub fn create_tag_group(
    state: tauri::State<AppState>,
    group: CreateTagGroupInput,
) -> Result<TagGroup, String> {
    services::create_tag_group(&state.db, group)
}
#[tauri::command]
pub fn update_tag_group(
    state: tauri::State<AppState>,
    group: UpdateTagGroupInput,
) -> Result<TagGroup, String> {
    services::update_tag_group(&state.db, group)
}
#[tauri::command]
pub fn delete_tag_group(state: tauri::State<AppState>, group_id: String) -> Result<(), String> {
    services::delete_tag_group(&state.db, &group_id)
}
#[tauri::command]
pub fn list_tags(state: tauri::State<AppState>) -> Result<Vec<Tag>, String> {
    services::list_tags(&state.db)
}
#[tauri::command]
pub fn create_tag(state: tauri::State<AppState>, tag: CreateTagInput) -> Result<Tag, String> {
    services::create_tag(&state.db, tag)
}
#[tauri::command]
pub fn update_tag(state: tauri::State<AppState>, tag: UpdateTagInput) -> Result<Tag, String> {
    services::update_tag(&state.db, tag)
}
#[tauri::command]
pub fn delete_tag(state: tauri::State<AppState>, tag_id: String) -> Result<(), String> {
    services::delete_tag(&state.db, &tag_id)
}
#[tauri::command]
pub fn set_book_tags(
    state: tauri::State<AppState>,
    book_id: String,
    tag_ids: Vec<String>,
) -> Result<Vec<BookTag>, String> {
    services::set_book_tags(&state.db, &book_id, tag_ids)
}
#[tauri::command]
pub fn set_series_tags(
    state: tauri::State<AppState>,
    series_id: String,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    services::set_series_tags(&state.db, &series_id, tag_ids)
}
#[tauri::command]
pub fn list_book_tags(
    state: tauri::State<AppState>,
    book_id: String,
) -> Result<Vec<BookTag>, String> {
    services::list_book_tags(&state.db, &book_id)
}
