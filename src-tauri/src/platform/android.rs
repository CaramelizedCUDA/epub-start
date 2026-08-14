use std::os::fd::FromRawFd;

use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};

use super::FileMetadata;
use crate::db::models::{SelectedSource, SourceKind};

const PLUGIN_IDENTIFIER: &str = "com.epubstart.reader";
const PLUGIN_CLASS: &str = "EpubSafPlugin";

struct EpubSaf<R: Runtime>(PluginHandle<R>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UriPayload<'a> {
    source_locator: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PickResponse {
    cancelled: bool,
    source_locator: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InspectResponse {
    file_size_bytes: i64,
    last_modified_ts: i64,
}

#[derive(Debug, Deserialize)]
struct FdResponse {
    fd: i32,
}

#[derive(Debug, Deserialize)]
struct ReleasedResponse {
    released: bool,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("epub_saf")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, PLUGIN_CLASS)?;
            app.manage(EpubSaf(handle));
            Ok(())
        })
        .build()
}

fn plugin<R: Runtime>(app: &AppHandle<R>) -> tauri::State<'_, EpubSaf<R>> {
    app.state::<EpubSaf<R>>()
}

pub async fn select_epub_sources<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<SelectedSource>, String> {
    eprintln!("[EPUB-IMPORT] select_epub_sources: opening picker");
    let response = plugin(app)
        .0
        .run_mobile_plugin_async::<PickResponse>("pickEpub", ())
        .await
        .map_err(|error| format!("SAF_PERMISSION_DENIED: Android picker failed: {error}"))?;
    eprintln!(
        "[EPUB-IMPORT] select_epub_sources: picker returned cancelled={}",
        response.cancelled
    );
    // Workaround for tauri#14994 / plugins-workspace#1741: after returning from
    // ACTION_OPEN_DOCUMENT the wry MainPipe may not wake until the next IPC write,
    // so the frontend promise can hang indefinitely (observed as a stuck
    // "importing…" state that only a process restart clears). A short sleep
    // gives the event loop a chance to flush the response to the renderer.
    // Upstream fix is merged but not yet released (crates.io tauri 2.11.5 is
    // the newest as of 2026-08-14); remove this sleep after upgrading.
    std::thread::sleep(std::time::Duration::from_millis(200));

    super::selection_from_picker_response(response.cancelled, response.source_locator)
}

pub fn validate_epub_source<R: Runtime>(
    app: &AppHandle<R>,
    source_locator: &str,
) -> Result<FileMetadata, String> {
    validate_content_uri(source_locator)?;
    eprintln!("[EPUB-IMPORT] validate_epub_source: inspectUri start");
    let response = plugin(app)
        .0
        .run_mobile_plugin::<InspectResponse>("inspectUri", UriPayload { source_locator })
        .map_err(|error| {
            eprintln!("[EPUB-IMPORT] validate_epub_source: inspectUri FAILED: {error}");
            format!("BOOK_SOURCE_UNAVAILABLE: persisted URI is unavailable: {error}")
        })?;
    eprintln!("[EPUB-IMPORT] validate_epub_source: inspectUri ok");

    Ok(FileMetadata {
        file_size_bytes: response.file_size_bytes.max(0),
        last_modified_ts: response.last_modified_ts.max(0),
    })
}

pub fn validate_selected_source(source: &SelectedSource) -> Result<(), String> {
    if matches!(source.source_kind, SourceKind::AndroidContentUri) {
        validate_content_uri(&source.source_locator)
    } else {
        Err("VALIDATION_ERROR: Android source kind must be android_content_uri".to_string())
    }
}

pub fn open_source_file<R: Runtime>(
    app: &AppHandle<R>,
    source_locator: &str,
) -> Result<std::fs::File, String> {
    validate_content_uri(source_locator)?;
    eprintln!("[EPUB-IMPORT] open_source_file: openReadFd start");
    let response = plugin(app)
        .0
        .run_mobile_plugin::<FdResponse>("openReadFd", UriPayload { source_locator })
        .map_err(|error| {
            eprintln!("[EPUB-IMPORT] open_source_file: openReadFd FAILED: {error}");
            format!("BOOK_SOURCE_UNAVAILABLE: persisted URI cannot be opened: {error}")
        })?;
    eprintln!("[EPUB-IMPORT] open_source_file: fd={}", response.fd);
    if response.fd < 0 {
        return Err("BOOK_SOURCE_UNAVAILABLE: Android returned an invalid file descriptor".into());
    }
    Ok(unsafe { std::fs::File::from_raw_fd(response.fd) })
}

pub fn release_source_permission<R: Runtime>(
    app: &AppHandle<R>,
    source_locator: &str,
) -> Result<(), String> {
    validate_content_uri(source_locator)?;
    let response = plugin(app)
        .0
        .run_mobile_plugin::<ReleasedResponse>("releasePermission", UriPayload { source_locator })
        .map_err(|error| format!("SAF_PERMISSION_DENIED: permission release failed: {error}"))?;

    if response.released {
        Ok(())
    } else {
        Err("SAF_PERMISSION_DENIED: persisted permission was not released".to_string())
    }
}

pub fn epub_root_url(book_id: &str) -> String {
    format!("epub://localhost/book/{book_id}/")
}

fn validate_content_uri(source_locator: &str) -> Result<(), String> {
    if super::is_content_uri(source_locator) {
        Ok(())
    } else {
        Err("VALIDATION_ERROR: Android source must be a content URI".to_string())
    }
}
