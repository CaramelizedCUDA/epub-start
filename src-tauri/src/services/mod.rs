mod catalog_service;
mod cover_cache_service;
mod format_service;
mod image_service;
mod library_service;
mod notes_service;
mod reading_activity_service;
mod search_service;
mod settings_service;

pub use catalog_service::*;
pub use cover_cache_service::CoverCache;
pub use format_service::{normalize_entry_path, parse_book_metadata, read_book_resource};
pub use image_service::save_book_image;
pub use library_service::{
    delete_book, get_reading_progress, import_book, list_books, open_book, relocate_book,
    save_reading_progress,
};
pub use notes_service::{create_note, delete_note, list_notes, update_note};
pub use reading_activity_service::*;
pub use search_service::{
    cancel_search_index, ensure_series_search_index, get_search_index_status,
    recover_interrupted_search_tasks, search_series, SearchTaskRegistry,
};
pub use settings_service::{
    clear_book_reading_settings, get_global_reading_settings, get_reading_settings,
    save_book_reading_settings, save_global_reading_settings,
};

pub(super) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
