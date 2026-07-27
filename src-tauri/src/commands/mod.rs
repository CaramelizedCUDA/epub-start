use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

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
pub mod select_epub_sources;
pub mod settings;

/// Application-wide state managed by Tauri.
pub struct AppState {
    pub db: Mutex<Connection>,
    pub cover_cache_dir: PathBuf,
    pub source_manager: crate::source::SourceManager,
}
