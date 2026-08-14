use std::sync::Mutex;

#[cfg(not(target_os = "android"))]
use std::path::Path;

use rusqlite::Connection;
use tauri::{AppHandle, Runtime};

use crate::db::models::BookStatus;
use crate::db::repository;
use crate::source::SourceManager;

use super::{normalize_entry_path, read_book_resource};

#[cfg(not(target_os = "android"))]
use tauri_plugin_dialog::DialogExt;

pub fn save_book_image<R: Runtime>(
    app: &AppHandle<R>,
    db: &Mutex<Connection>,
    source_manager: &SourceManager,
    book_id: &str,
    entry_path: &str,
) -> Result<bool, String> {
    let entry_path = normalize_entry_path(entry_path)?;
    let book = {
        let conn = db
            .lock()
            .map_err(|_| "INTERNAL_ERROR: database unavailable".to_string())?;
        repository::find_book_by_id(&conn, book_id)
            .map_err(|_| "INTERNAL_ERROR: book query failed".to_string())?
            .ok_or_else(|| format!("BOOK_NOT_FOUND: no book with id {book_id}"))?
    };
    if !matches!(book.status, BookStatus::Available) {
        return Err("BOOK_SOURCE_UNAVAILABLE: book is unavailable".to_string());
    }

    let (lease, _) = source_manager
        .acquire(app, &book.id, &book.source_locator)
        .map_err(|error| sanitize_source_error(&error))?;
    let resource = read_book_resource(&book, lease.open_reader()?, &entry_path)?;
    validate_image_mime(&resource.mime)?;

    save_image_file(app, &entry_path, &resource.mime, &resource.body)
}

fn sanitize_source_error(error: &str) -> String {
    // 只放行已知的稳定错误前缀；其余（包括可能携带盘符或路径的
    // 原始错误文本）一律映射为 BOOK_SOURCE_UNAVAILABLE。
    // 旧的 split_once(':') 会把 "C:\...\book.epub: ..." 的盘符
    // "C" 当作错误前缀返回给前端，破坏稳定错误契约。
    const STABLE_PREFIXES: [&str; 3] = [
        "BOOK_SOURCE_UNAVAILABLE",
        "BOOK_RESOURCE_LIMIT_EXCEEDED",
        "INTERNAL_ERROR",
    ];
    let prefix = STABLE_PREFIXES
        .iter()
        .find(|prefix| error.starts_with(**prefix))
        .copied()
        .unwrap_or("BOOK_SOURCE_UNAVAILABLE");
    format!("{prefix}: source is unavailable")
}

fn validate_image_mime(mime: &str) -> Result<(), String> {
    if mime.starts_with("image/") {
        Ok(())
    } else {
        Err("VALIDATION_ERROR: selected EPUB resource is not an image".to_string())
    }
}

#[cfg(not(target_os = "android"))]
fn save_image_file<R: Runtime>(
    app: &AppHandle<R>,
    entry_path: &str,
    mime: &str,
    body: &[u8],
) -> Result<bool, String> {
    let file_name = Path::new(entry_path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("epub-image");
    let file_name = sanitize_file_name(file_name);
    let extension = Path::new(&file_name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty());

    let mut dialog = app
        .dialog()
        .file()
        .set_title("保存 EPUB 图片")
        .set_file_name(&file_name);
    if let Some(extension) = extension {
        dialog = dialog.add_filter(mime, &[extension]);
    }

    let Some(destination) = dialog.blocking_save_file() else {
        return Ok(false);
    };
    let path = destination
        .as_path()
        .ok_or_else(|| "INTERNAL_ERROR: selected destination is not a writable file".to_string())?;
    std::fs::write(path, body)
        .map_err(|_| "INTERNAL_ERROR: image could not be saved".to_string())?;
    Ok(true)
}

#[cfg(not(target_os = "android"))]
fn sanitize_file_name(file_name: &str) -> String {
    let sanitized = file_name
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0'..='\u{1f}' => '_',
            _ => character,
        })
        .collect::<String>();
    let sanitized = sanitized.trim_matches([' ', '.']);
    if sanitized.is_empty() {
        "epub-image".to_string()
    } else {
        sanitized.to_string()
    }
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::{sanitize_file_name, sanitize_source_error, validate_image_mime};

    #[test]
    fn export_accepts_only_image_resources() {
        assert!(validate_image_mime("image/png").is_ok());
        assert!(validate_image_mime("application/xhtml+xml").is_err());
    }

    #[test]
    fn suggested_file_name_removes_host_path_characters() {
        assert_eq!(sanitize_file_name("cover?.png"), "cover_.png");
        assert_eq!(sanitize_file_name("..."), "epub-image");
    }

    #[test]
    fn source_errors_do_not_expose_locator_details() {
        assert_eq!(
            sanitize_source_error("BOOK_SOURCE_UNAVAILABLE: C:\\private\\book.epub"),
            "BOOK_SOURCE_UNAVAILABLE: source is unavailable"
        );
    }

    #[test]
    fn source_error_sanitization_keeps_only_known_prefixes() {
        assert_eq!(
            sanitize_source_error("BOOK_SOURCE_UNAVAILABLE: file vanished"),
            "BOOK_SOURCE_UNAVAILABLE: source is unavailable"
        );
        assert_eq!(
            sanitize_source_error("BOOK_RESOURCE_LIMIT_EXCEEDED: too large"),
            "BOOK_RESOURCE_LIMIT_EXCEEDED: source is unavailable"
        );
        assert_eq!(
            sanitize_source_error("INTERNAL_ERROR: lock poisoned"),
            "INTERNAL_ERROR: source is unavailable"
        );
    }

    #[test]
    fn source_error_sanitization_never_splits_windows_drive_letters() {
        // 回归测试：旧实现 split_once(':') 会把盘符 "C" 当作错误前缀。
        assert_eq!(
            sanitize_source_error("C:\\Users\\alice\\book.epub: Access is denied"),
            "BOOK_SOURCE_UNAVAILABLE: source is unavailable"
        );
        assert_eq!(
            sanitize_source_error("some unknown failure without any prefix"),
            "BOOK_SOURCE_UNAVAILABLE: source is unavailable"
        );
    }
}

#[cfg(target_os = "android")]
fn save_image_file<R: Runtime>(
    _app: &AppHandle<R>,
    _entry_path: &str,
    _mime: &str,
    _body: &[u8],
) -> Result<bool, String> {
    Err(
        "FORMAT_NOT_SUPPORTED: Android image export requires SAF create-document support"
            .to_string(),
    )
}
