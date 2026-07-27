mod catalog_service;
mod format_service;
mod image_service;
mod library_service;
mod notes_service;
mod settings_service;

pub use catalog_service::*;
pub use format_service::{normalize_entry_path, parse_book_metadata, read_book_resource};
pub use image_service::save_book_image;
pub use library_service::{delete_book, import_book, open_book, relocate_book};
pub use notes_service::{create_note, delete_note, list_notes, update_note};
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
