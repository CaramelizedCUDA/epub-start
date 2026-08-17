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
        Ok((body, mime)) => {
            let range = request
                .headers()
                .get(header::RANGE)
                .and_then(|value| value.to_str().ok());
            match range {
                Some(raw) => serve_range(body, &mime, raw, cors_origin.as_deref()),
                None => protocol_response(StatusCode::OK, &mime, body, cors_origin.as_deref()),
            }
        }
        Err((status, message)) => protocol_response(
            status,
            "text/plain; charset=utf-8",
            message.into_bytes(),
            cors_origin.as_deref(),
        ),
    }
}

/// Handles single-segment `Range: bytes=start-end` requests.
///
/// Multi-segment ranges and syntactically invalid headers are ignored and
/// served as a full 200 response, per RFC 9110. Unsatisfiable single ranges
/// produce 416 with `Content-Range: bytes */<length>`.
fn serve_range(
    body: Vec<u8>,
    mime: &str,
    raw: &str,
    cors_origin: Option<&str>,
) -> Response<Vec<u8>> {
    let length = body.len() as u64;
    let Some(spec) = raw.trim().strip_prefix("bytes=") else {
        return protocol_response(StatusCode::OK, mime, body, cors_origin);
    };
    if spec.contains(',') || spec.is_empty() {
        return protocol_response(StatusCode::OK, mime, body, cors_origin);
    }

    let (start_s, end_s) = spec.split_once('-').unwrap_or((spec, ""));
    let parse_start = start_s.trim().parse::<u64>().ok();
    let parse_end = end_s.trim().parse::<u64>().ok();

    let (start, end) = match (parse_start, parse_end) {
        // bytes=start-end
        (Some(start), Some(end)) => (start, end.min(length.saturating_sub(1))),
        // bytes=start-
        (Some(start), None) => {
            if length == 0 || start >= length {
                return range_not_satisfiable(length, cors_origin);
            }
            (start, length - 1)
        }
        // bytes=-suffix (last N bytes)
        (None, Some(suffix)) => {
            if suffix == 0 {
                return range_not_satisfiable(length, cors_origin);
            }
            let start = length.saturating_sub(suffix);
            if length == 0 {
                return range_not_satisfiable(length, cors_origin);
            }
            (start, length - 1)
        }
        // bytes=- (invalid)
        (None, None) => return protocol_response(StatusCode::OK, mime, body, cors_origin),
    };

    if start > end || start >= length {
        return range_not_satisfiable(length, cors_origin);
    }

    let slice = body[start as usize..=end as usize].to_vec();
    let mut builder = Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, mime)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{length}"),
        );
    if let Some(origin) = cors_origin {
        builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    builder
        .body(slice)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn range_not_satisfiable(length: u64, cors_origin: Option<&str>) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_RANGE, format!("bytes */{length}"));
    if let Some(origin) = cors_origin {
        builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    builder
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
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
        .map_err(|error| map_source_error(&error))?;
    let reader = lease
        .open_reader()
        .map_err(|error| map_source_error(&error))?;

    crate::services::read_book_resource(&book, reader, &entry_path)
        .map(|resource| (resource.body, resource.mime))
        .map_err(map_resource_error)
}

fn map_resource_error(error: String) -> (StatusCode, String) {
    let status = if error.starts_with("BOOK_RESOURCE_NOT_FOUND:") {
        StatusCode::NOT_FOUND
    } else if error.starts_with("BOOK_SOURCE_UNAVAILABLE:") {
        StatusCode::NOT_FOUND
    } else if error.starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:") {
        StatusCode::PAYLOAD_TOO_LARGE
    } else if error.starts_with("BOOK_PARSE_FAILED:") {
        StatusCode::UNPROCESSABLE_ENTITY
    } else if error.starts_with("VALIDATION_ERROR:") {
        StatusCode::BAD_REQUEST
    } else if error.starts_with("FORMAT_NOT_SUPPORTED:") {
        StatusCode::NOT_IMPLEMENTED
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };
    (status, error)
}

fn map_source_error(error: &str) -> (StatusCode, String) {
    map_resource_error(sanitize_source_error(error))
}

fn sanitize_source_error(error: &str) -> String {
    const SAFE_PREFIXES: [&str; 3] = [
        "BOOK_SOURCE_UNAVAILABLE",
        "BOOK_RESOURCE_LIMIT_EXCEEDED",
        "INTERNAL_ERROR",
    ];

    SAFE_PREFIXES
        .into_iter()
        .find(|prefix| error.starts_with(&format!("{prefix}:")))
        .map(|prefix| format!("{prefix}: source is unavailable"))
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
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCEPT_RANGES, "bytes");
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
    fn source_errors_are_sanitized_to_stable_prefix() {
        assert_eq!(
            sanitize_source_error("BOOK_SOURCE_UNAVAILABLE: content://secret/details"),
            "BOOK_SOURCE_UNAVAILABLE: source is unavailable"
        );
        assert_eq!(
            sanitize_source_error("provider failure: content://secret/details"),
            "BOOK_SOURCE_UNAVAILABLE: source is unavailable"
        );
        assert_eq!(
            sanitize_source_error("raw failure without prefix"),
            "BOOK_SOURCE_UNAVAILABLE: source is unavailable"
        );
    }

    #[test]
    fn resource_errors_map_to_stable_status_codes() {
        assert_eq!(
            map_resource_error("BOOK_RESOURCE_NOT_FOUND: x".into()).0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            map_resource_error("BOOK_RESOURCE_LIMIT_EXCEEDED: x".into()).0,
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert_eq!(
            map_resource_error("FORMAT_NOT_SUPPORTED: x".into()).0,
            StatusCode::NOT_IMPLEMENTED
        );
        assert_eq!(
            map_resource_error("BOOK_SOURCE_UNAVAILABLE: x".into()).0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            map_resource_error("BOOK_PARSE_FAILED: x".into()).0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            map_resource_error("VALIDATION_ERROR: x".into()).0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            map_resource_error("unexpected".into()).0,
            StatusCode::INTERNAL_SERVER_ERROR
        );
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

    fn body_of(response: &Response<Vec<u8>>) -> &[u8] {
        response.body()
    }

    #[test]
    fn range_serves_partial_content_with_correct_headers() {
        let body = b"0123456789".to_vec();
        let response = serve_range(body, "text/plain", "bytes=2-5", None);
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(body_of(&response), b"2345");
        assert_eq!(
            response.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 2-5/10"
        );
        assert_eq!(
            response.headers().get(header::ACCEPT_RANGES).unwrap(),
            "bytes"
        );
    }

    #[test]
    fn range_open_ended_serves_until_end() {
        let response = serve_range(b"0123456789".to_vec(), "text/plain", "bytes=7-", None);
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(body_of(&response), b"789");
        assert_eq!(
            response.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 7-9/10"
        );
    }

    #[test]
    fn range_suffix_serves_last_n_bytes() {
        let response = serve_range(b"0123456789".to_vec(), "text/plain", "bytes=-4", None);
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(body_of(&response), b"6789");
        assert_eq!(
            response.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 6-9/10"
        );
    }

    #[test]
    fn range_out_of_bounds_is_416() {
        let response = serve_range(b"0123456789".to_vec(), "text/plain", "bytes=20-", None);
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(
            response.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes */10"
        );
        assert!(body_of(&response).is_empty());
    }

    #[test]
    fn range_zero_suffix_is_416() {
        let response = serve_range(b"0123456789".to_vec(), "text/plain", "bytes=-0", None);
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    }

    #[test]
    fn malformed_and_multi_ranges_fall_back_to_full_body() {
        for raw in ["items=0-1", "bytes=3-2,5-6", "bytes=-", "bytes="] {
            let response = serve_range(b"0123456789".to_vec(), "text/plain", raw, None);
            assert_eq!(response.status(), StatusCode::OK, "raw={raw}");
            assert_eq!(body_of(&response), b"0123456789");
        }
    }

    #[test]
    fn end_beyond_length_is_clamped() {
        let response = serve_range(b"0123456789".to_vec(), "text/plain", "bytes=5-999", None);
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(body_of(&response), b"56789");
        assert_eq!(
            response.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 5-9/10"
        );
    }

    #[test]
    fn empty_body_range_is_416() {
        let response = serve_range(Vec::new(), "text/plain", "bytes=0-", None);
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    }
}
