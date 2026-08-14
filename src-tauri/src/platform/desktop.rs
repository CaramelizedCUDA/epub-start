use std::fs;
use std::path::Path;

use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

use super::FileMetadata;
use crate::db::models::{SelectedSource, SourceKind};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("epub_saf").build()
}

pub async fn select_epub_sources<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<SelectedSource>, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("EPUB Books", &["epub"])
        .blocking_pick_file();

    match file {
        Some(path) => {
            let locator = path
                .as_path()
                .ok_or_else(|| "BOOK_SOURCE_UNAVAILABLE: invalid file path".to_string())?
                .to_str()
                .ok_or_else(|| "BOOK_SOURCE_UNAVAILABLE: path contains invalid UTF-8".to_string())?
                .to_string();

            Ok(vec![SelectedSource {
                source_locator: locator,
                source_kind: SourceKind::DesktopPath,
            }])
        }
        None => Ok(Vec::new()),
    }
}

pub fn validate_epub_source<R: Runtime>(
    _app: &AppHandle<R>,
    path: &str,
) -> Result<FileMetadata, String> {
    let source = Path::new(path);

    if !source.exists() {
        return Err("BOOK_SOURCE_UNAVAILABLE: file not found".to_string());
    }
    if !source.is_file() {
        return Err("BOOK_SOURCE_UNAVAILABLE: source is not a regular file".to_string());
    }

    fs::File::open(source)
        .map_err(|_| "BOOK_SOURCE_UNAVAILABLE: source cannot be opened".to_string())?;

    match source.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("epub") => {}
        _ => return Err("VALIDATION_ERROR: source is not an EPUB file".to_string()),
    }

    let metadata = fs::metadata(source)
        .map_err(|_| "BOOK_SOURCE_UNAVAILABLE: source metadata is unavailable".to_string())?;
    let file_size_bytes = i64::try_from(metadata.len()).unwrap_or(i64::MAX);
    let last_modified_ts = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);

    Ok(FileMetadata {
        file_size_bytes,
        last_modified_ts,
    })
}

pub fn validate_selected_source(source: &SelectedSource) -> Result<(), String> {
    if matches!(source.source_kind, SourceKind::DesktopPath)
        && !source.source_locator.starts_with("content://")
    {
        let path = Path::new(&source.source_locator);
        if !path.is_absolute() {
            return Err("VALIDATION_ERROR: desktop source must be an absolute path".to_string());
        }
        Ok(())
    } else {
        Err("VALIDATION_ERROR: desktop source kind does not match its locator".to_string())
    }
}

pub fn open_source_file<R: Runtime>(_app: &AppHandle<R>, path: &str) -> Result<fs::File, String> {
    fs::File::open(path).map_err(|_| "BOOK_SOURCE_UNAVAILABLE: source cannot be opened".to_string())
}

pub fn release_source_permission<R: Runtime>(
    _app: &AppHandle<R>,
    _path: &str,
) -> Result<(), String> {
    Ok(())
}

pub fn epub_root_url(book_id: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("http://epub.localhost/book/{book_id}/")
    } else {
        format!("epub://localhost/book/{book_id}/")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{SelectedSource, SourceKind};

    fn absolute_path() -> String {
        if cfg!(target_os = "windows") {
            r"C:\books\sample.epub".to_string()
        } else {
            "/home/user/books/sample.epub".to_string()
        }
    }

    #[test]
    fn desktop_selection_accepts_absolute_desktop_path() {
        let source = SelectedSource {
            source_locator: absolute_path(),
            source_kind: SourceKind::DesktopPath,
        };
        assert!(validate_selected_source(&source).is_ok());
    }

    #[test]
    fn desktop_selection_rejects_relative_paths() {
        let source = SelectedSource {
            source_locator: "books/sample.epub".to_string(),
            source_kind: SourceKind::DesktopPath,
        };
        let error = validate_selected_source(&source).unwrap_err();
        assert!(
            error.starts_with("VALIDATION_ERROR:"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn desktop_selection_rejects_kind_locator_mismatch() {
        // Android 的 content:// locator 不能携带 DesktopPath kind。
        let source = SelectedSource {
            source_locator: "content://provider/document/1".to_string(),
            source_kind: SourceKind::DesktopPath,
        };
        let error = validate_selected_source(&source).unwrap_err();
        assert!(error.starts_with("VALIDATION_ERROR:"));
    }
}
