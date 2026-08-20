use rusqlite::Connection;
use std::sync::{Arc, Mutex};

pub mod catalog;
pub mod delete_book;
pub mod get_reading_progress;
pub mod import_book;
pub mod list_books;
pub mod notes;
pub mod open_book;
pub mod relocate_book;
pub mod save_book_image;
pub mod save_reading_progress;
pub mod search;
pub mod select_epub_sources;
pub mod settings;

/// Application-wide state managed by Tauri.
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub cover_cache: crate::services::CoverCache,
    pub source_manager: crate::source::SourceManager,
    pub search_tasks: crate::services::SearchTaskRegistry,
}
