use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{AppHandle, Runtime};

use crate::db::models::{
    Book, BookFormat, BookStatus, BookSummary, OpenBookResult, ReadingProgress, SelectedSource,
    SourceKind,
};
use crate::db::repository;
use crate::platform;
use crate::source::{ReadSeek, SourceManager};

use super::parse_book_metadata;

pub fn import_book<R: Runtime>(
    app: &AppHandle<R>,
    db: &Mutex<Connection>,
    cover_cache_dir: &Path,
    source_manager: &SourceManager,
    source: SelectedSource,
) -> Result<Book, String> {
    platform::validate_selected_source(&source)?;
    let exact_existing = {
        let conn = lock_db(db)?;
        repository::find_book_by_source_locator(&conn, &source.source_locator)
            .map_err(|error| format!("INTERNAL_ERROR: db query failed: {error}"))?
    };

    let now = unix_epoch_millis();
    let probe_id = exact_existing
        .as_ref()
        .map(|book| book.id.clone())
        .unwrap_or_else(|| format!("{}-import", uuid::Uuid::new_v4()));
    eprintln!("[EPUB-IMPORT] import_book: acquire start (probe={probe_id})");
    let (lease, fingerprint) = source_manager.acquire(app, &probe_id, &source.source_locator)?;
    eprintln!("[EPUB-IMPORT] import_book: acquire done, parse metadata start");

    let inspected = parse_book_metadata(&BookFormat::Epub, lease.open_reader()?, None);
    eprintln!(
        "[EPUB-IMPORT] import_book: parse done ok={}",
        inspected.is_ok()
    );
    let existing = if exact_existing.is_some() {
        exact_existing
    } else if let Ok(metadata) = &inspected {
        let recoverable = {
            let conn = lock_db(db)?;
            repository::list_recoverable_books(&conn)
                .map_err(|error| format!("INTERNAL_ERROR: db query failed: {error}"))?
        };
        match unique_recoverable_match(recoverable, &fingerprint, &metadata.package_identifier) {
            Err(error) => {
                drop(lease);
                source_manager.invalidate(&probe_id);
                let _ = platform::release_source_permission(app, &source.source_locator);
                return Err(error);
            }
            Ok(Some(book)) => Some(book),
            Ok(None) => None,
        }
    } else {
        None
    };

    let book_id = existing
        .as_ref()
        .map(|book| book.id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let parsed = parse_import_metadata(
        lease.open_reader()?,
        &source.source_locator,
        cover_cache_dir,
        &book_id,
    );

    let old_locator = existing.as_ref().map(|book| book.source_locator.clone());
    let old_cover = existing
        .as_ref()
        .and_then(|book| book.cover_cache_path.clone());
    let book = merge_imported_book(existing, book_id, source, &fingerprint, parsed, now);

    let conn = lock_db(db)?;
    if repository::find_book_by_id(&conn, &book.id)
        .map_err(|error| format!("INTERNAL_ERROR: db query failed: {error}"))?
        .is_some()
    {
        repository::update_book_by_id(&conn, &book)
            .map_err(|error| format!("INTERNAL_ERROR: db update failed: {error}"))?;
    } else {
        repository::insert_book(&conn, &book)
            .map_err(|error| format!("INTERNAL_ERROR: db insert failed: {error}"))?;
    }
    drop(conn);
    drop(lease);

    if probe_id != book.id {
        source_manager.invalidate(&book.id);
        let _ = source_manager.acquire(app, &book.id, &book.source_locator);
        source_manager.invalidate(&probe_id);
    }
    if let Some(locator) = old_locator.filter(|locator| locator != &book.source_locator) {
        let _ = platform::release_source_permission(app, &locator);
    }
    if let Some(path) = old_cover.filter(|path| Some(path) != book.cover_cache_path.as_ref()) {
        let _ = std::fs::remove_file(path);
    }

    Ok(book)
}

pub fn open_book<R: Runtime>(
    app: &AppHandle<R>,
    db: &Mutex<Connection>,
    book_id: &str,
) -> Result<OpenBookResult, String> {
    let mut book = {
        let conn = lock_db(db)?;
        repository::find_book_by_id(&conn, book_id)
            .map_err(|error| format!("INTERNAL_ERROR: db query failed: {error}"))?
            .ok_or_else(|| format!("BOOK_NOT_FOUND: no book with id {book_id}"))?
    };

    if matches!(
        book.source_kind,
        SourceKind::DesktopPath | SourceKind::AndroidContentUri
    ) {
        if let Err(error) = platform::validate_epub_source(app, &book.source_locator) {
            book.status = BookStatus::Missing;
            book.status_detail = Some(error.clone());
            book.updated_at = unix_epoch_millis();
            let conn = lock_db(db)?;
            repository::update_book_by_source(&conn, &book)
                .map_err(|db_error| format!("INTERNAL_ERROR: db update failed: {db_error}"))?;
            return Err(error);
        }
    }

    Ok(OpenBookResult {
        epub_root_url: platform::epub_root_url(&book.id),
        book,
    })
}

pub fn relocate_book<R: Runtime>(
    app: &AppHandle<R>,
    db: &Mutex<Connection>,
    source_manager: &SourceManager,
    book_id: &str,
    source: SelectedSource,
) -> Result<Book, String> {
    platform::validate_selected_source(&source)?;
    let (old_book, candidate_already_in_use) = {
        let conn = lock_db(db)?;
        let old_book = repository::find_book_by_id(&conn, book_id)
            .map_err(|error| format!("INTERNAL_ERROR: db query failed: {error}"))?
            .ok_or_else(|| format!("BOOK_NOT_FOUND: no book with id {book_id}"))?;
        let candidate_already_in_use =
            repository::find_book_by_source_locator(&conn, &source.source_locator)
                .map_err(|error| format!("INTERNAL_ERROR: db query failed: {error}"))?
                .is_some();
        (old_book, candidate_already_in_use)
    };

    let candidate_cache_id = format!("{book_id}-relocate");
    let (candidate_lease, candidate_fingerprint) =
        source_manager.acquire(app, &candidate_cache_id, &source.source_locator)?;
    let candidate_metadata =
        match parse_book_metadata(&old_book.format, candidate_lease.open_reader()?, None) {
            Ok(metadata) => metadata,
            Err(error) => {
                drop(candidate_lease);
                source_manager.invalidate(&candidate_cache_id);
                return Err(format!(
                    "BOOK_PARSE_FAILED: relocation candidate cannot be parsed: {error}"
                ));
            }
        };
    drop(candidate_lease);

    if !relocation_matches(
        &old_book,
        &candidate_fingerprint,
        &candidate_metadata.package_identifier,
    ) {
        source_manager.invalidate(&candidate_cache_id);
        release_rejected_candidate(
            app,
            &old_book.source_locator,
            &source.source_locator,
            candidate_already_in_use,
        );
        return Err(
            "BOOK_RELOCATION_MISMATCH: candidate does not match the stored EPUB fingerprint"
                .to_string(),
        );
    }

    let old_locator = old_book.source_locator.clone();
    let mut updated = old_book;
    updated.source_locator = source.source_locator.clone();
    updated.source_kind = source.source_kind;
    updated.file_size_bytes = candidate_fingerprint.file_size_bytes;
    updated.last_modified_ts = candidate_fingerprint.last_modified_ts;
    updated.package_identifier = candidate_metadata.package_identifier;
    updated.status = BookStatus::Available;
    updated.status_detail = None;
    updated.updated_at = unix_epoch_millis();

    let update_result = {
        let conn = lock_db(db)?;
        repository::update_book_by_id(&conn, &updated)
    };
    if let Err(error) = update_result {
        source_manager.invalidate(&candidate_cache_id);
        release_rejected_candidate(
            app,
            &old_locator,
            &source.source_locator,
            candidate_already_in_use,
        );
        return Err(format!("INTERNAL_ERROR: db update failed: {error}"));
    }

    source_manager.invalidate(book_id);
    let _ = source_manager.acquire(app, book_id, &source.source_locator);
    source_manager.invalidate(&candidate_cache_id);
    if old_locator != source.source_locator {
        let _ = platform::release_source_permission(app, &old_locator);
    }
    Ok(updated)
}

pub fn delete_book<R: Runtime>(
    app: &AppHandle<R>,
    db: &Mutex<Connection>,
    source_manager: &SourceManager,
    book_id: &str,
) -> Result<String, String> {
    let (source_locator, cover_path) = {
        let conn = lock_db(db)?;
        repository::delete_book(&conn, book_id).map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                format!("BOOK_NOT_FOUND: no book with id {book_id}")
            }
            _ => format!("INTERNAL_ERROR: db delete failed: {error}"),
        })?
    };

    source_manager.invalidate(book_id);
    if let Some(path) = cover_path {
        let _ = std::fs::remove_file(path);
    }
    let _ = platform::release_source_permission(app, &source_locator);
    Ok(book_id.to_string())
}

struct ParsedImportMetadata {
    title: String,
    authors: Vec<String>,
    package_identifier: Option<String>,
    cover_cache_path: Option<String>,
    status: BookStatus,
    status_detail: Option<String>,
}

fn merge_imported_book(
    existing: Option<Book>,
    book_id: String,
    source: SelectedSource,
    fingerprint: &crate::source::SourceFingerprint,
    parsed: ParsedImportMetadata,
    now: i64,
) -> Book {
    let mut book = existing.unwrap_or(Book {
        id: book_id,
        title: String::new(),
        authors: Vec::new(),
        format: BookFormat::Epub,
        cover_cache_path: None,
        source_locator: source.source_locator.clone(),
        source_kind: source.source_kind.clone(),
        file_size_bytes: fingerprint.file_size_bytes,
        last_modified_ts: fingerprint.last_modified_ts,
        package_identifier: None,
        status: BookStatus::Available,
        status_detail: None,
        added_at: now,
        updated_at: now,
    });

    book.title = parsed.title;
    book.authors = parsed.authors;
    book.source_locator = source.source_locator;
    book.source_kind = source.source_kind;
    book.file_size_bytes = fingerprint.file_size_bytes;
    book.last_modified_ts = fingerprint.last_modified_ts;
    book.package_identifier = parsed.package_identifier;
    book.cover_cache_path = parsed.cover_cache_path;
    book.status = parsed.status;
    book.status_detail = parsed.status_detail;
    book.updated_at = now;
    book
}

fn parse_import_metadata(
    reader: Box<dyn ReadSeek>,
    source_locator: &str,
    cover_cache_dir: &Path,
    book_id: &str,
) -> ParsedImportMetadata {
    match parse_book_metadata(&BookFormat::Epub, reader, Some((cover_cache_dir, book_id))) {
        Ok(metadata) => ParsedImportMetadata {
            title: if metadata.title.is_empty() {
                fallback_title(source_locator)
            } else {
                metadata.title
            },
            authors: metadata.authors,
            package_identifier: metadata.package_identifier,
            cover_cache_path: metadata.cover_cache_path,
            status: BookStatus::Available,
            status_detail: None,
        },
        Err(error) => ParsedImportMetadata {
            title: fallback_title(source_locator),
            authors: Vec::new(),
            package_identifier: None,
            cover_cache_path: None,
            status: BookStatus::Error,
            status_detail: Some(error),
        },
    }
}

fn relocation_matches(
    old_book: &Book,
    candidate: &crate::source::SourceFingerprint,
    candidate_package_identifier: &Option<String>,
) -> bool {
    let has_complete_fingerprint = old_book.file_size_bytes > 0
        && old_book.last_modified_ts > 0
        && candidate.file_size_bytes > 0
        && candidate.last_modified_ts > 0;
    if has_complete_fingerprint {
        return old_book.file_size_bytes == candidate.file_size_bytes
            && old_book.last_modified_ts == candidate.last_modified_ts;
    }

    old_book
        .package_identifier
        .as_deref()
        .filter(|identifier| !identifier.is_empty())
        .zip(
            candidate_package_identifier
                .as_deref()
                .filter(|identifier| !identifier.is_empty()),
        )
        .map(|(old, candidate)| old == candidate)
        .unwrap_or(false)
}

fn unique_recoverable_match(
    candidates: Vec<Book>,
    fingerprint: &crate::source::SourceFingerprint,
    package_identifier: &Option<String>,
) -> Result<Option<Book>, String> {
    let mut matches = candidates
        .into_iter()
        .filter(|book| relocation_matches(book, fingerprint, package_identifier));
    let first = matches.next();
    if first.is_some() && matches.next().is_some() {
        return Err(
            "VALIDATION_ERROR: selected EPUB matches multiple missing books; use each book's relocate action"
                .to_string(),
        );
    }
    Ok(first)
}

fn release_rejected_candidate<R: Runtime>(
    app: &AppHandle<R>,
    old_locator: &str,
    candidate_locator: &str,
    candidate_already_in_use: bool,
) {
    if candidate_locator != old_locator && !candidate_already_in_use {
        let _ = platform::release_source_permission(app, candidate_locator);
    }
}

fn fallback_title(source_locator: &str) -> String {
    Path::new(source_locator)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("Unknown Book")
        .to_string()
}

/// Returns every book in the library ordered by most recently updated.
/// Source-locator fields are excluded from the response for privacy.
pub fn list_books(db: &Mutex<Connection>) -> Result<Vec<BookSummary>, String> {
    let conn = lock_db(db)?;
    repository::list_all_books(&conn)
        .map(|books| books.into_iter().map(BookSummary::from).collect())
        .map_err(|error| format!("INTERNAL_ERROR: db query failed: {error}"))
}

/// Returns the saved reading progress for the given book, or `None`
/// (JSON `null`) if no progress has been recorded yet.
pub fn get_reading_progress(
    db: &Mutex<Connection>,
    book_id: &str,
) -> Result<Option<ReadingProgress>, String> {
    let conn = lock_db(db)?;
    repository::get_reading_progress(&conn, book_id)
        .map_err(|error| format!("INTERNAL_ERROR: db query failed: {error}"))
}

/// Persists the current reading position with upsert semantics.
///
/// `location_cfi` must be a valid EPUB CFI string and `progression`
/// must be in the range [0.0, 1.0]. Re-queries the row after the
/// upsert so callers receive canonical stored values.
pub fn save_reading_progress(
    db: &Mutex<Connection>,
    book_id: String,
    location_cfi: String,
    progression: f64,
) -> Result<ReadingProgress, String> {
    if !(0.0..=1.0).contains(&progression) {
        return Err(format!(
            "VALIDATION_ERROR: progression must be between 0.0 and 1.0, got {}",
            progression
        ));
    }

    let progress = ReadingProgress {
        book_id,
        location_cfi: Some(location_cfi),
        progression: Some(progression),
        updated_at: unix_epoch_millis(),
    };

    let conn = lock_db(db)?;
    repository::upsert_reading_progress(&conn, &progress)
        .map_err(|error| format!("INTERNAL_ERROR: db upsert failed: {error}"))?;

    repository::get_reading_progress(&conn, &progress.book_id)
        .map_err(|error| format!("INTERNAL_ERROR: db query failed: {error}"))?
        .ok_or_else(|| "INTERNAL_ERROR: progress was just saved but not found".to_string())
}

fn lock_db(db: &Mutex<Connection>) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.lock()
        .map_err(|error| format!("INTERNAL_ERROR: db lock poisoned: {error}"))
}

fn unix_epoch_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::SourceKind;
    use crate::source::SourceFingerprint;

    fn book(size: i64, modified: i64, package: Option<&str>) -> Book {
        Book {
            id: "book".into(),
            title: "Title".into(),
            authors: Vec::new(),
            format: BookFormat::Epub,
            cover_cache_path: None,
            source_locator: "old.epub".into(),
            source_kind: SourceKind::DesktopPath,
            file_size_bytes: size,
            last_modified_ts: modified,
            package_identifier: package.map(str::to_string),
            status: BookStatus::Available,
            status_detail: None,
            added_at: 0,
            updated_at: 0,
        }
    }

    fn fingerprint(size: i64, modified: i64) -> SourceFingerprint {
        SourceFingerprint {
            source_locator: "new.epub".into(),
            file_size_bytes: size,
            last_modified_ts: modified,
            head_sample: Vec::new(),
        }
    }

    #[test]
    fn relocation_uses_complete_size_and_mtime() {
        assert!(relocation_matches(
            &book(10, 20, Some("old")),
            &fingerprint(10, 20),
            &Some("different".into())
        ));
        assert!(!relocation_matches(
            &book(10, 20, Some("same")),
            &fingerprint(10, 21),
            &Some("same".into())
        ));
    }

    #[test]
    fn relocation_falls_back_to_package_when_metadata_is_unknown() {
        assert!(relocation_matches(
            &book(0, 0, Some("package")),
            &fingerprint(0, 0),
            &Some("package".into())
        ));
        assert!(!relocation_matches(
            &book(0, 0, None),
            &fingerprint(0, 0),
            &None
        ));
    }

    #[test]
    fn same_source_reimport_reuses_id_and_preserves_lifecycle_fields() {
        let mut existing = book(10, 20, Some("package"));
        existing.id = "stable-id".into();
        existing.source_locator = "same.epub".into();
        existing.status = BookStatus::Missing;
        existing.added_at = 123;
        let source = SelectedSource {
            source_locator: "same.epub".into(),
            source_kind: SourceKind::DesktopPath,
        };
        let fingerprint = SourceFingerprint {
            source_locator: "same.epub".into(),
            file_size_bytes: 11,
            last_modified_ts: 21,
            head_sample: Vec::new(),
        };
        let merged = merge_imported_book(
            Some(existing),
            "unused-new-id".into(),
            source,
            &fingerprint,
            ParsedImportMetadata {
                title: "Updated".into(),
                authors: vec!["Author".into()],
                package_identifier: Some("package".into()),
                cover_cache_path: None,
                status: BookStatus::Available,
                status_detail: None,
            },
            456,
        );

        assert_eq!(merged.id, "stable-id");
        assert_eq!(merged.added_at, 123);
        assert!(matches!(merged.status, BookStatus::Available));
    }

    #[test]
    fn generic_import_recovers_one_unique_missing_book() {
        let mut missing = book(10, 20, Some("package"));
        missing.id = "missing-id".into();
        missing.status = BookStatus::Missing;
        let matched =
            unique_recoverable_match(vec![missing], &fingerprint(10, 20), &Some("package".into()))
                .unwrap()
                .unwrap();
        assert_eq!(matched.id, "missing-id");

        assert!(unique_recoverable_match(
            Vec::new(),
            &fingerprint(10, 20),
            &Some("package".into())
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn generic_import_rejects_ambiguous_missing_matches() {
        let mut first = book(0, 0, Some("same-package"));
        first.id = "first".into();
        first.status = BookStatus::Missing;
        let mut second = first.clone();
        second.id = "second".into();

        let error = unique_recoverable_match(
            vec![first, second],
            &fingerprint(0, 0),
            &Some("same-package".into()),
        )
        .unwrap_err();
        assert!(error.starts_with("VALIDATION_ERROR:"));
    }
}
