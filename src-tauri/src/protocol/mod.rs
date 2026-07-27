//! Controlled EPUB resource responses for the renderer.

use tauri::http::{header, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext};

use crate::commands::AppState;
use crate::db::repository;

pub fn epub_protocol<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let path = request.uri().path().trim_start_matches('/');
    let result = serve_entry(ctx.app_handle(), path);
    let cors_origin = allowed_cors_origin(&request);

    match result {
        Ok((body, mime)) => protocol_response(StatusCode::OK, &mime, body, cors_origin.as_deref()),
        Err((status, message)) => protocol_response(
            status,
            "text/plain; charset=utf-8",
            message.into_bytes(),
            cors_origin.as_deref(),
        ),
    }
}

fn serve_entry(
    app: &AppHandle<impl Runtime>,
    path: &str,
) -> Result<(Vec<u8>, String), (StatusCode, String)> {
    let segments = path.splitn(3, '/').collect::<Vec<_>>();
    if segments.len() != 3 || segments[0] != "book" || segments[1].is_empty() {
        return Err((StatusCode::BAD_REQUEST, "invalid EPUB resource URI".into()));
    }

    let book_id = segments[1];
    let entry_path = crate::services::normalize_entry_path(segments[2])
        .map_err(|message| (StatusCode::FORBIDDEN, message))?;
    let state = app.state::<AppState>();
    let book = {
        let db = state.db.lock().map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "database unavailable".into(),
            )
        })?;
        repository::find_book_by_id(&db, book_id)
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "database query failed".into(),
                )
            })?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "book not found".into()))?
    };

    if !matches!(book.status, crate::db::models::BookStatus::Available) {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "book is unavailable".into(),
        ));
    }

    let (lease, _) = state
        .source_manager
        .acquire(app, &book.id, &book.source_locator)
        .map_err(|error| (StatusCode::NOT_FOUND, sanitize_source_error(&error)))?;
    let reader = lease
        .open_reader()
        .map_err(|error| (StatusCode::NOT_FOUND, sanitize_source_error(&error)))?;

    crate::services::read_book_resource(&book, reader, &entry_path)
        .map(|resource| (resource.body, resource.mime))
        .map_err(map_resource_error)
}

fn map_resource_error(error: String) -> (StatusCode, String) {
    let status = if error.starts_with("BOOK_RESOURCE_NOT_FOUND:") {
        StatusCode::NOT_FOUND
    } else if error.starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:") {
        StatusCode::PAYLOAD_TOO_LARGE
    } else if error.starts_with("FORMAT_NOT_SUPPORTED:") {
        StatusCode::NOT_IMPLEMENTED
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };
    (status, error)
}

fn sanitize_source_error(error: &str) -> String {
    error
        .split_once(':')
        .map(|(prefix, _)| format!("{prefix}: source is unavailable"))
        .unwrap_or_else(|| "BOOK_SOURCE_UNAVAILABLE: source is unavailable".to_string())
}

fn allowed_cors_origin(request: &tauri::http::Request<Vec<u8>>) -> Option<String> {
    request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .filter(|origin| {
            matches!(
                *origin,
                "http://localhost:1420"
                    | "http://127.0.0.1:1420"
                    | "http://tauri.localhost"
                    | "tauri://localhost"
                    | "http://epub.localhost"
                    | "epub://localhost"
                    | "null"
            )
        })
        .map(str::to_owned)
}

fn protocol_response(
    status: StatusCode,
    content_type: &str,
    body: Vec<u8>,
    cors_origin: Option<&str>,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store");
    if let Some(origin) = cors_origin {
        builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(origin: &str) -> tauri::http::Request<Vec<u8>> {
        tauri::http::Request::builder()
            .uri("http://epub.localhost/book/test/item/chapter.xhtml")
            .header(header::ORIGIN, origin)
            .body(Vec::new())
            .unwrap()
    }

    #[test]
    fn cors_is_restricted_to_application_origins() {
        assert_eq!(
            allowed_cors_origin(&request("tauri://localhost")).as_deref(),
            Some("tauri://localhost")
        );
        assert_eq!(allowed_cors_origin(&request("https://example.com")), None);
    }

    #[test]
    fn entry_path_rejects_traversal_and_backslashes() {
        assert!(crate::services::normalize_entry_path("../secret").is_err());
        assert!(crate::services::normalize_entry_path("item\\secret").is_err());
        assert_eq!(
            crate::services::normalize_entry_path("item/./chapter.xhtml").unwrap(),
            "item/chapter.xhtml"
        );
    }
}
