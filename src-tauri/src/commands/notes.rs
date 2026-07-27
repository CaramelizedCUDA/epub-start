use crate::commands::AppState;
use crate::db::models::{CreateNoteInput, Note, UpdateNoteInput};
use crate::services;

#[tauri::command]
pub fn list_notes(state: tauri::State<AppState>, book_id: String) -> Result<Vec<Note>, String> {
    services::list_notes(&state.db, &book_id)
}

#[tauri::command]
pub fn create_note(state: tauri::State<AppState>, note: CreateNoteInput) -> Result<Note, String> {
    services::create_note(&state.db, note)
}

#[tauri::command]
pub fn update_note(state: tauri::State<AppState>, note: UpdateNoteInput) -> Result<Note, String> {
    services::update_note(&state.db, note)
}

#[tauri::command]
pub fn delete_note(state: tauri::State<AppState>, note_id: String) -> Result<(), String> {
    services::delete_note(&state.db, &note_id)
}
