use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use rusqlite::{params, Connection, Error as SqlError, ErrorCode, OptionalExtension};
use tauri::{AppHandle, Manager, Runtime};

use crate::commands::AppState;
use crate::db::models::{SearchIndexStatus, SearchResult, SearchTaskStatus};
use crate::db::repository;
use crate::formats::epub::{extract_search_documents, SearchExtraction};

pub const MAX_QUERY_LENGTH: usize = 200;
pub const DEFAULT_RESULT_LIMIT: i64 = 100;
pub const MAX_SEARCH_TASK_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Hard cap for the reconstructable SQLite search payload. This is an
/// accounting budget for indexed text, not a promise about SQLite page/WAL
/// overhead; the runtime storage gate must measure the actual database too.
pub const MAX_SEARCH_INDEX_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone)]
struct SearchTaskControl {
    series_id: String,
    cancelled: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Default)]
pub struct SearchTaskRegistry(Arc<Mutex<HashMap<String, SearchTaskControl>>>);

impl SearchTaskRegistry {
    fn register(
        &self,
        task_id: String,
        series_id: String,
        cancelled: Arc<AtomicBool>,
    ) -> Result<(), String> {
        let mut tasks = self
            .0
            .lock()
            .map_err(|_| "INTERNAL_ERROR: search task lock poisoned".to_string())?;
        if tasks.values().any(|task| task.series_id == series_id) {
            return Err(
                "SEARCH_INDEX_UNAVAILABLE: a search index task is already running for this series"
                    .to_string(),
            );
        }
        tasks.insert(
            task_id,
            SearchTaskControl {
                series_id,
                cancelled,
            },
        );
        Ok(())
    }

    fn cancel(&self, task_id: &str) -> Result<(), String> {
        let cancelled = self
            .0
            .lock()
            .map_err(|_| "INTERNAL_ERROR: search task lock poisoned".to_string())?
            .get(task_id)
            .map(|task| task.cancelled.clone())
            .ok_or_else(|| {
                "SEARCH_INDEX_UNAVAILABLE: search task is no longer running".to_string()
            })?;
        cancelled.store(true, Ordering::Release);
        Ok(())
    }

    fn remove(&self, task_id: &str) {
        if let Ok(mut tasks) = self.0.lock() {
            tasks.remove(task_id);
        }
    }
}

/// Marks in-flight rows as pending after a process restart. The committed
/// documents remain queryable only after the caller explicitly resumes the
/// series task, while the state no longer lies that a dead worker is active.
pub fn recover_interrupted_search_tasks(db: &Mutex<Connection>) -> Result<(), String> {
    let conn = db
        .lock()
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())?;
    conn.execute(
        "UPDATE search_index_state
         SET status='pending', error_detail='SEARCH_INDEX_INTERRUPTED: previous task stopped', updated_at=?1
         WHERE status='building'",
        [now_ms()],
    )
    .map(|_| ())
    .map_err(|error| map_search_sql_error("search recovery state update failed", error))
}

pub fn ensure_series_search_index<R: Runtime>(
    app: &AppHandle<R>,
    db: &Mutex<Connection>,
    tasks: &SearchTaskRegistry,
    series_id: String,
    rebuild: bool,
) -> Result<SearchTaskStatus, String> {
    let book_ids = series_book_ids(db, &series_id)?;
    if book_ids.is_empty() && !series_exists(db, &series_id)? {
        return Err(format!("SERIES_NOT_FOUND: no series with id {series_id}"));
    }

    let task_id = uuid::Uuid::new_v4().to_string();
    let cancelled = Arc::new(AtomicBool::new(false));
    tasks.register(task_id.clone(), series_id.clone(), cancelled.clone())?;

    let task = SearchTaskStatus {
        task_id: task_id.clone(),
        series_id: series_id.clone(),
        status: "building".into(),
        indexed_documents: 0,
        total_documents: 0,
        error_detail: None,
        updated_at: now_ms(),
    };
    let app = app.clone();
    let tasks = tasks.clone();
    thread::spawn(move || {
        let state = app.state::<AppState>();
        let result = build_series_index(
            &app,
            &state.db,
            &state.source_manager,
            &series_id,
            &book_ids,
            rebuild,
            &cancelled,
        );
        if let Err(error) = result {
            eprintln!("[SEARCH] index task {task_id} failed: {error}");
        }
        tasks.remove(&task_id);
    });
    Ok(task)
}

pub fn get_search_index_status(
    db: &Mutex<Connection>,
    series_id: &str,
) -> Result<SearchIndexStatus, String> {
    if !series_exists(db, series_id)? {
        return Err(format!("SERIES_NOT_FOUND: no series with id {series_id}"));
    }
    let conn = db
        .lock()
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(s.status, 'pending'), COALESCE(s.indexed_documents, 0),
                    COALESCE(s.total_documents, 0), s.error_detail, COALESCE(s.updated_at, 0)
             FROM book_series bs
             LEFT JOIN search_index_state s ON bs.book_id = s.book_id
             WHERE bs.series_id = ?1",
        )
        .map_err(|_| "INTERNAL_ERROR: search status query failed".to_string())?;
    let rows = stmt
        .query_map([series_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|_| "INTERNAL_ERROR: search status query failed".to_string())?;
    let mut count = 0i64;
    let mut indexed = 0i64;
    let mut total = 0i64;
    let mut latest = 0i64;
    let mut has_building = false;
    let mut has_pending = false;
    let mut has_error = false;
    let mut error_detail = None;
    for row in rows {
        let (row_status, row_indexed, row_total, row_error, updated_at) =
            row.map_err(|_| "INTERNAL_ERROR: search status row failed".to_string())?;
        count += 1;
        indexed += row_indexed;
        total += row_total;
        latest = latest.max(updated_at);
        match row_status.as_str() {
            "building" => {
                has_building = true;
                if error_detail.is_none() {
                    error_detail = row_error;
                }
            }
            "pending" => {
                has_pending = true;
                if error_detail.is_none() {
                    error_detail = row_error;
                }
            }
            "error" => {
                has_error = true;
                if error_detail.is_none() {
                    error_detail = row_error;
                }
            }
            _ => {
                // A ready index may still be partial (for example, a chapter
                // exceeded the search extraction budget). Preserve the
                // diagnostic so callers do not mistake it for a clean build.
                if error_detail.is_none() {
                    error_detail = row_error;
                }
            }
        }
    }
    let status = if has_building {
        "building"
    } else if has_pending {
        "pending"
    } else if has_error {
        "error"
    } else if count == 0 {
        "pending"
    } else {
        "ready"
    }
    .to_string();
    Ok(SearchIndexStatus {
        series_id: series_id.to_string(),
        status,
        indexed_documents: indexed,
        total_documents: total,
        error_detail,
        updated_at: latest,
    })
}

pub fn cancel_search_index(tasks: &SearchTaskRegistry, task_id: &str) -> Result<(), String> {
    tasks.cancel(task_id)
}

pub fn search_series(
    db: &Mutex<Connection>,
    series_id: &str,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<SearchResult>, String> {
    let query = query.trim().to_string();
    if query.is_empty() || query.chars().count() > MAX_QUERY_LENGTH {
        return Err(format!(
            "VALIDATION_ERROR: query must contain 1-{} characters",
            MAX_QUERY_LENGTH
        ));
    }
    let limit = limit
        .unwrap_or(DEFAULT_RESULT_LIMIT)
        .clamp(1, DEFAULT_RESULT_LIMIT);
    let conn = db
        .lock()
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())?;
    if !series_exists_conn(&conn, series_id)? {
        return Err(format!("SERIES_NOT_FOUND: no series with id {series_id}"));
    }
    let ready: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM search_index_state s JOIN book_series bs ON bs.book_id=s.book_id
             WHERE bs.series_id=?1 AND s.status='ready'",
            [series_id],
            |row| row.get(0),
        )
        .map_err(|_| "INTERNAL_ERROR: search status query failed".to_string())?;
    if ready == 0 {
        return Err("SEARCH_INDEX_UNAVAILABLE: series search index is not ready".into());
    }

    let mut results = Vec::new();
    if query.chars().count() < 3 {
        let pattern = format!("%{}%", escape_like_pattern(&query));
        let mut stmt = conn
            .prepare(
                "SELECT d.book_id, d.spine_index, d.href, d.title,
                        substr(d.body, 1, 240), d.cfi
                 FROM search_documents d JOIN book_series bs ON bs.book_id=d.book_id
                 JOIN search_index_state s ON s.book_id=d.book_id
                 WHERE bs.series_id=?1 AND s.status='ready'
                   AND (d.title COLLATE NOCASE LIKE ?2 ESCAPE '\\'
                        OR d.body COLLATE NOCASE LIKE ?2 ESCAPE '\\')
                 ORDER BY d.book_id, d.spine_index LIMIT ?3",
            )
            .map_err(|_| "INTERNAL_ERROR: search query failed".to_string())?;
        let rows = stmt
            .query_map(params![series_id, pattern, limit], map_result_row)
            .map_err(|_| "INTERNAL_ERROR: search query failed".to_string())?;
        for row in rows {
            results.push(row.map_err(|_| "INTERNAL_ERROR: search result failed".to_string())?);
        }
    } else {
        let fts_query = format!("\"{}\"", query.replace('"', "\"\""));
        let mut stmt = conn
            .prepare(
                "SELECT d.book_id, d.spine_index, d.href, d.title,
                        snippet(search_documents_fts, 1, '[', ']', '…', 24), d.cfi
                 FROM search_documents_fts
                 JOIN search_documents d ON d.id=search_documents_fts.rowid
                 JOIN book_series bs ON bs.book_id=d.book_id
                 JOIN search_index_state s ON s.book_id=d.book_id
                 WHERE bs.series_id=?1 AND s.status='ready'
                   AND search_documents_fts MATCH ?2
                 ORDER BY d.book_id, d.spine_index LIMIT ?3",
            )
            .map_err(|_| "INTERNAL_ERROR: search query failed".to_string())?;
        let rows = stmt
            .query_map(params![series_id, fts_query, limit], map_result_row)
            .map_err(|_| "INTERNAL_ERROR: search query failed".to_string())?;
        for row in rows {
            results.push(row.map_err(|_| "INTERNAL_ERROR: search result failed".to_string())?);
        }
    }
    Ok(results)
}

fn escape_like_pattern(query: &str) -> String {
    let mut escaped = String::with_capacity(query.len());
    for character in query.chars() {
        if matches!(character, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn map_result_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SearchResult> {
    Ok(SearchResult {
        book_id: row.get(0)?,
        spine_index: row.get(1)?,
        href: row.get(2)?,
        title: row.get(3)?,
        snippet: row.get(4)?,
        cfi: row.get(5)?,
    })
}

fn build_series_index<R: Runtime>(
    app: &AppHandle<R>,
    db: &Mutex<Connection>,
    source_manager: &crate::source::SourceManager,
    series_id: &str,
    book_ids: &[String],
    rebuild: bool,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let mut task_bytes = 0u64;
    for book_id in book_ids {
        if cancelled.load(Ordering::Acquire) {
            break;
        }
        let book = {
            let conn = db
                .lock()
                .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())?;
            repository::find_book_by_id(&conn, book_id)
                .map_err(|_| "INTERNAL_ERROR: book query failed".to_string())?
                .ok_or_else(|| format!("BOOK_NOT_FOUND: no book with id {book_id}"))?
        };
        let (lease, fingerprint) = match source_manager.acquire(app, &book.id, &book.source_locator)
        {
            Ok(value) => value,
            Err(error) => {
                if error.starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:") {
                    mark_budget_error_preserving_documents(db, &book.id, &error)?;
                } else {
                    persist_error(db, &book.id, &error)?;
                }
                continue;
            }
        };
        let fingerprint_json = serde_json::to_string(&fingerprint)
            .map_err(|_| "INTERNAL_ERROR: search fingerprint encoding failed".to_string())?;
        if !rebuild && is_ready_with_fingerprint(db, &book.id, &fingerprint_json)? {
            continue;
        }
        mark_building(db, &book.id)?;
        let reader = match lease.open_reader() {
            Ok(reader) => reader,
            Err(error) => {
                persist_error(db, &book.id, &error)?;
                continue;
            }
        };
        let extraction =
            match extract_search_documents(reader, || cancelled.load(Ordering::Acquire)) {
                Ok(extraction) => extraction,
                Err(error) => {
                    if error.starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:") {
                        mark_budget_error_preserving_documents(db, &book.id, &error)?;
                    } else {
                        persist_error(db, &book.id, &error)?;
                    }
                    continue;
                }
            };
        task_bytes = match checked_search_task_total(task_bytes, extraction.bytes_extracted) {
            Ok(value) => value,
            Err(error) => {
                mark_budget_error_preserving_documents(db, &book.id, &error)?;
                break;
            }
        };
        if let Err(error) = enforce_search_task_budget(task_bytes) {
            mark_budget_error_preserving_documents(db, &book.id, &error)?;
            break;
        }
        if let Err(error) = persist_documents(db, &book.id, &fingerprint_json, &extraction) {
            if error.starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:") {
                mark_budget_error_preserving_documents(db, &book.id, &error)?;
                break;
            }
            persist_error(db, &book.id, &error)?;
            return Err(error);
        }
    }
    let _ = series_id;
    Ok(())
}

fn persist_documents(
    db: &Mutex<Connection>,
    book_id: &str,
    fingerprint_json: &str,
    extraction: &crate::formats::epub::SearchExtraction,
) -> Result<(), String> {
    persist_documents_with_budget(
        db,
        book_id,
        fingerprint_json,
        extraction,
        MAX_SEARCH_INDEX_BYTES,
    )
}

fn persist_documents_with_budget(
    db: &Mutex<Connection>,
    book_id: &str,
    fingerprint_json: &str,
    extraction: &SearchExtraction,
    max_index_bytes: u64,
) -> Result<(), String> {
    let new_bytes = extraction_bytes(extraction)?;
    let conn = db
        .lock()
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())?;
    conn.execute_batch("BEGIN IMMEDIATE;")
        .map_err(|error| map_search_sql_error("search transaction failed", error))?;

    let existing_bytes: i64 = match conn.query_row(
        "SELECT COALESCE(SUM(
             length(CAST(title AS BLOB)) +
             length(CAST(body AS BLOB)) +
             length(CAST(href AS BLOB)) +
             length(CAST(COALESCE(cfi, '') AS BLOB))
         ), 0)
         FROM search_documents WHERE book_id <> ?1",
        [book_id],
        |row| row.get(0),
    ) {
        Ok(value) => value,
        Err(_) => {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err("INTERNAL_ERROR: search index size query failed".to_string());
        }
    };
    if let Err(error) = enforce_index_budget_with_limit(existing_bytes, new_bytes, max_index_bytes)
    {
        let _ = conn.execute_batch("ROLLBACK;");
        return Err(error);
    }

    let result = (|| -> rusqlite::Result<()> {
        conn.execute("DELETE FROM search_documents WHERE book_id=?1", [book_id])?;
        for document in &extraction.documents {
            conn.execute(
                "INSERT INTO search_documents (book_id, spine_index, href, title, body, cfi)
                 VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    book_id,
                    document.spine_index,
                    document.href,
                    document.title,
                    document.body,
                    document.cfi
                ],
            )?;
        }
        conn.execute(
            "INSERT INTO search_documents_fts(search_documents_fts) VALUES ('rebuild')",
            [],
        )?;
        let status = if extraction.cancelled {
            "error"
        } else {
            "ready"
        };
        let detail = if extraction.cancelled {
            Some("SEARCH_INDEX_CANCELLED: task cancelled".to_string())
        } else if extraction.errors.is_empty() {
            None
        } else {
            Some(extraction.errors.join("; "))
        };
        conn.execute(
            "INSERT INTO search_index_state (book_id, fingerprint_json, status, indexed_documents, total_documents, error_detail, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(book_id) DO UPDATE SET fingerprint_json=excluded.fingerprint_json,status=excluded.status,
             indexed_documents=excluded.indexed_documents,total_documents=excluded.total_documents,error_detail=excluded.error_detail,updated_at=excluded.updated_at",
            params![book_id, fingerprint_json, status, extraction.documents.len() as i64, extraction.total_documents, detail, now_ms()],
        )?;
        Ok(())
    })();
    match result {
        Ok(()) => match conn.execute_batch("COMMIT;") {
            Ok(()) => Ok(()),
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK;");
                Err(map_search_sql_error("search commit failed", error))
            }
        },
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(map_search_sql_error("search persistence failed", error))
        }
    }
}

fn map_search_sql_error(context: &str, error: SqlError) -> String {
    if matches!(
        error,
        SqlError::SqliteFailure(ref failure, _)
            if matches!(failure.code, ErrorCode::DiskFull)
    ) {
        return "BOOK_RESOURCE_LIMIT_EXCEEDED: search index storage is full".to_string();
    }
    format!("INTERNAL_ERROR: {context}")
}

fn checked_index_total(existing_bytes: i64, new_bytes: u64) -> Result<u64, String> {
    (existing_bytes.max(0) as u64)
        .checked_add(new_bytes)
        .ok_or_else(|| "BOOK_RESOURCE_LIMIT_EXCEEDED: search index byte counter overflow".into())
}

fn enforce_index_budget_with_limit(
    existing_bytes: i64,
    new_bytes: u64,
    max_index_bytes: u64,
) -> Result<(), String> {
    let total = checked_index_total(existing_bytes, new_bytes)?;
    if total > max_index_bytes {
        return Err(format!(
            "BOOK_RESOURCE_LIMIT_EXCEEDED: search index exceeds {} bytes",
            max_index_bytes
        ));
    }
    Ok(())
}

fn extraction_bytes(extraction: &crate::formats::epub::SearchExtraction) -> Result<u64, String> {
    extraction
        .documents
        .iter()
        .try_fold(0u64, |total, document| {
            total
                .checked_add(document.title.len() as u64)
                .and_then(|value| value.checked_add(document.body.len() as u64))
                .and_then(|value| value.checked_add(document.href.len() as u64))
                .and_then(|value| {
                    value.checked_add(document.cfi.as_deref().unwrap_or("").len() as u64)
                })
        })
        .ok_or_else(|| "BOOK_RESOURCE_LIMIT_EXCEEDED: search index byte counter overflow".into())
}

fn checked_search_task_total(current: u64, added: u64) -> Result<u64, String> {
    current.checked_add(added).ok_or_else(|| {
        "BOOK_RESOURCE_LIMIT_EXCEEDED: search task byte counter overflow".to_string()
    })
}

fn enforce_search_task_budget(total: u64) -> Result<(), String> {
    if total > MAX_SEARCH_TASK_BYTES {
        return Err(format!(
            "BOOK_RESOURCE_LIMIT_EXCEEDED: search task exceeds {} bytes",
            MAX_SEARCH_TASK_BYTES
        ));
    }
    Ok(())
}

fn persist_error(db: &Mutex<Connection>, book_id: &str, error: &str) -> Result<(), String> {
    persist_error_with_fts_sql(
        db,
        book_id,
        error,
        "INSERT INTO search_documents_fts(search_documents_fts) VALUES ('rebuild')",
    )
}

fn persist_error_with_fts_sql(
    db: &Mutex<Connection>,
    book_id: &str,
    error: &str,
    fts_rebuild_sql: &str,
) -> Result<(), String> {
    let conn = db
        .lock()
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())?;
    conn.execute_batch("BEGIN IMMEDIATE;")
        .map_err(|error| map_search_sql_error("search error transaction failed", error))?;
    let result = (|| -> rusqlite::Result<()> {
        conn.execute("DELETE FROM search_documents WHERE book_id=?1", [book_id])?;
        conn.execute(fts_rebuild_sql, [])?;
        conn.execute(
            "INSERT INTO search_index_state (book_id,fingerprint_json,status,indexed_documents,total_documents,error_detail,updated_at)
             VALUES (?1,'{}','error',0,0,?2,?3)
             ON CONFLICT(book_id) DO UPDATE SET fingerprint_json='{}',status='error',indexed_documents=0,total_documents=0,error_detail=excluded.error_detail,updated_at=excluded.updated_at",
            params![book_id, error, now_ms()],
        )?;
        Ok(())
    })();
    finish_search_transaction(&conn, result, "search error state update failed")
}

fn finish_search_transaction(
    conn: &Connection,
    result: rusqlite::Result<()>,
    context: &str,
) -> Result<(), String> {
    match result {
        Ok(()) => match conn.execute_batch("COMMIT;") {
            Ok(()) => Ok(()),
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK;");
                Err(map_search_sql_error("search commit failed", error))
            }
        },
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(map_search_sql_error(context, error))
        }
    }
}

fn mark_budget_error_preserving_documents(
    db: &Mutex<Connection>,
    book_id: &str,
    error: &str,
) -> Result<(), String> {
    let conn = db
        .lock()
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())?;
    conn.execute(
        "INSERT INTO search_index_state
         (book_id,fingerprint_json,status,indexed_documents,total_documents,error_detail,updated_at)
         VALUES (?1,'{}','error',0,0,?2,?3)
         ON CONFLICT(book_id) DO UPDATE SET status='error',error_detail=excluded.error_detail,updated_at=excluded.updated_at",
        params![book_id, error, now_ms()],
    )
    .map(|_| ())
    .map_err(|error| map_search_sql_error("search budget state update failed", error))
}

fn mark_building(db: &Mutex<Connection>, book_id: &str) -> Result<(), String> {
    let conn = db
        .lock()
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())?;
    conn.execute(
        "INSERT INTO search_index_state (book_id,fingerprint_json,status,indexed_documents,total_documents,error_detail,updated_at)
         VALUES (?1,'{}','building',0,0,NULL,?2)
         ON CONFLICT(book_id) DO UPDATE SET status='building',error_detail=NULL,updated_at=excluded.updated_at",
        params![book_id, now_ms()],
    )
    .map_err(|error| map_search_sql_error("search state update failed", error))?;
    Ok(())
}

fn is_ready_with_fingerprint(
    db: &Mutex<Connection>,
    book_id: &str,
    fingerprint: &str,
) -> Result<bool, String> {
    let conn = db
        .lock()
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())?;
    conn.query_row(
        "SELECT status='ready' AND fingerprint_json=?2 FROM search_index_state WHERE book_id=?1",
        params![book_id, fingerprint],
        |row| row.get(0),
    )
    .optional()
    .map(|value| value.unwrap_or(false))
    .map_err(|_| "INTERNAL_ERROR: search state query failed".to_string())
}

fn series_exists(db: &Mutex<Connection>, series_id: &str) -> Result<bool, String> {
    let conn = db
        .lock()
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())?;
    series_exists_conn(&conn, series_id)
}

fn series_exists_conn(conn: &Connection, series_id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM series WHERE id=?1)",
        [series_id],
        |row| row.get(0),
    )
    .map_err(|_| "INTERNAL_ERROR: series query failed".to_string())
}

fn series_book_ids(db: &Mutex<Connection>, series_id: &str) -> Result<Vec<String>, String> {
    let conn = db
        .lock()
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare("SELECT book_id FROM book_series WHERE series_id=?1 ORDER BY sort_order, book_id")
        .map_err(|_| "INTERNAL_ERROR: series books query failed".to_string())?;
    let rows = stmt
        .query_map([series_id], |row| row.get(0))
        .map_err(|_| "INTERNAL_ERROR: series books query failed".to_string())?;
    rows.collect::<Result<Vec<String>, _>>()
        .map_err(|_| "INTERNAL_ERROR: series books query failed".to_string())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::run_migrations;
    use crate::formats::epub::SearchDocument;

    fn seeded_db() -> Mutex<Connection> {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO books (id,title,authors_json,format,source_locator,source_kind,file_size_bytes,last_modified_ts,status,added_at,updated_at)
             VALUES ('b1','一号书','[]','epub','/b1.epub','desktop_path',1,1,'available',1,1)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO series VALUES ('s1','系列',1,1)", [])
            .unwrap();
        conn.execute("INSERT INTO book_series VALUES ('b1','s1','',0)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO search_documents (book_id,spine_index,href,title,body,cfi)
             VALUES ('b1',0,'chapter.xhtml','第一章','你好世界 Rust 搜索','epubcfi(/6/2)')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO search_documents_fts(search_documents_fts) VALUES ('rebuild')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO search_index_state VALUES ('b1','{}','ready',1,1,NULL,1)",
            [],
        )
        .unwrap();
        Mutex::new(conn)
    }

    #[test]
    fn short_queries_use_parameterized_like_and_return_cjk() {
        let db = seeded_db();
        let result = search_series(&db, "s1", "你好".into(), None).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].book_id, "b1");
        assert_eq!(result[0].cfi.as_deref(), Some("epubcfi(/6/2)"));
    }

    #[test]
    fn short_queries_treat_like_wildcards_as_literal_text() {
        let db = seeded_db();
        for query in ["%", "_", "\\"] {
            assert!(search_series(&db, "s1", query.into(), None)
                .unwrap()
                .is_empty());
        }
    }

    #[test]
    fn duplicate_series_tasks_are_rejected_atomically() {
        let tasks = SearchTaskRegistry::default();
        let barrier = Arc::new(std::sync::Barrier::new(8));
        let handles: Vec<_> = (0..8)
            .map(|index| {
                let tasks = tasks.clone();
                let barrier = barrier.clone();
                thread::spawn(move || {
                    barrier.wait();
                    tasks
                        .register(
                            format!("task-{index}"),
                            "series-1".into(),
                            Arc::new(AtomicBool::new(false)),
                        )
                        .is_ok()
                })
            })
            .collect();
        let success_count = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .filter(|success| *success)
            .count();
        assert_eq!(success_count, 1);
        tasks
            .register(
                "other-series-task".into(),
                "series-2".into(),
                Arc::new(AtomicBool::new(false)),
            )
            .unwrap();
    }

    #[test]
    fn trigram_queries_return_matching_document_and_enforce_limit() {
        let db = seeded_db();
        let result = search_series(&db, "s1", "你好世".into(), Some(1)).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].book_id, "b1");
    }

    #[test]
    fn search_requires_ready_index_and_rejects_oversized_query() {
        let db = seeded_db();
        db.lock()
            .unwrap()
            .execute("UPDATE search_index_state SET status='building'", [])
            .unwrap();
        let error = search_series(&db, "s1", "你好".into(), None).unwrap_err();
        assert!(error.starts_with("SEARCH_INDEX_UNAVAILABLE:"));
        let too_long = "x".repeat(MAX_QUERY_LENGTH + 1);
        let error = search_series(&db, "s1", too_long, None).unwrap_err();
        assert!(error.starts_with("VALIDATION_ERROR:"));
    }

    #[test]
    fn interrupted_tasks_are_reset_to_pending_for_resume() {
        let db = seeded_db();
        db.lock()
            .unwrap()
            .execute("UPDATE search_index_state SET status='building'", [])
            .unwrap();
        recover_interrupted_search_tasks(&db).unwrap();
        let row: (String, String) = db
            .lock()
            .unwrap()
            .query_row(
                "SELECT status,error_detail FROM search_index_state WHERE book_id='b1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(row.0, "pending");
        assert!(row.1.starts_with("SEARCH_INDEX_INTERRUPTED:"));
    }

    #[test]
    fn aggregate_status_does_not_hide_pending_books_behind_ready_books() {
        let db = seeded_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO books (id,title,authors_json,format,source_locator,source_kind,file_size_bytes,last_modified_ts,status,added_at,updated_at)
             VALUES ('b2','Two','[]','epub','/b2.epub','desktop_path',1,1,'available',1,1)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO book_series VALUES ('b2','s1','',1)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO search_index_state VALUES ('b2','{}','pending',0,1,'SEARCH_INDEX_INTERRUPTED: previous task stopped',2)",
            [],
        )
        .unwrap();
        drop(conn);
        let status = get_search_index_status(&db, "s1").unwrap();
        assert_eq!(status.status, "pending");
    }

    #[test]
    fn aggregate_status_treats_missing_book_state_as_pending() {
        let db = seeded_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO books (id,title,authors_json,format,source_locator,source_kind,file_size_bytes,last_modified_ts,status,added_at,updated_at)
             VALUES ('b3','Three','[]','epub','/b3.epub','desktop_path',1,1,'available',1,1)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO book_series VALUES ('b3','s1','',2)", [])
            .unwrap();
        drop(conn);
        let status = get_search_index_status(&db, "s1").unwrap();
        assert_eq!(status.status, "pending");
        assert_eq!(status.indexed_documents, 1);
        assert_eq!(status.total_documents, 1);
    }

    #[test]
    fn aggregate_status_preserves_partial_ready_error() {
        let db = seeded_db();
        let detail = "chapter.xhtml: entry exceeds the size limit";
        db.lock()
            .unwrap()
            .execute("UPDATE search_index_state SET error_detail=?1", [detail])
            .unwrap();
        let status = get_search_index_status(&db, "s1").unwrap();
        assert_eq!(status.status, "ready");
        assert_eq!(status.error_detail.as_deref(), Some(detail));
    }

    #[test]
    fn fingerprint_mismatch_forces_an_index_rebuild() {
        let db = seeded_db();
        assert!(is_ready_with_fingerprint(&db, "b1", "{}").unwrap());
        assert!(!is_ready_with_fingerprint(&db, "b1", "{\"last_modified_ts\":2}").unwrap());
    }

    #[test]
    fn search_index_budget_counter_rejects_overflow() {
        let error = checked_index_total(i64::MAX, u64::MAX).unwrap_err();
        assert!(error.starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:"));
    }

    #[test]
    fn search_index_budget_rejects_over_limit_with_stable_error() {
        let error = enforce_index_budget_with_limit(
            MAX_SEARCH_INDEX_BYTES as i64,
            1,
            MAX_SEARCH_INDEX_BYTES,
        )
        .unwrap_err();
        assert_eq!(
            error,
            format!(
                "BOOK_RESOURCE_LIMIT_EXCEEDED: search index exceeds {} bytes",
                MAX_SEARCH_INDEX_BYTES
            )
        );
    }

    #[test]
    fn search_task_budget_rejects_over_limit_with_stable_error() {
        let error = enforce_search_task_budget(MAX_SEARCH_TASK_BYTES + 1).unwrap_err();
        assert_eq!(
            error,
            format!(
                "BOOK_RESOURCE_LIMIT_EXCEEDED: search task exceeds {} bytes",
                MAX_SEARCH_TASK_BYTES
            )
        );
    }

    #[test]
    fn search_task_counter_rejects_overflow() {
        let error = checked_search_task_total(u64::MAX, 1).unwrap_err();
        assert!(error.starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:"));
    }

    #[test]
    fn search_index_budget_failure_preserves_previous_documents() {
        let db = seeded_db();
        let extraction = SearchExtraction {
            documents: vec![SearchDocument {
                spine_index: 0,
                href: "new.xhtml".into(),
                title: "new".into(),
                body: "new body".into(),
                cfi: Some("epubcfi(/6/2)".into()),
            }],
            total_documents: 1,
            ..SearchExtraction::default()
        };
        let error =
            persist_documents_with_budget(&db, "b1", "{\"new\":true}", &extraction, 1).unwrap_err();
        assert!(error.starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:"));
        let conn = db.lock().unwrap();
        let body: String = conn
            .query_row(
                "SELECT body FROM search_documents WHERE book_id='b1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(body, "你好世界 Rust 搜索");
        let state: (String, String) = conn
            .query_row(
                "SELECT status,fingerprint_json FROM search_index_state WHERE book_id='b1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(state, ("ready".into(), "{}".into()));
    }

    #[test]
    fn search_index_budget_counts_utf8_bytes_for_existing_documents() {
        let db = seeded_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO books (id,title,authors_json,format,source_locator,source_kind,file_size_bytes,last_modified_ts,status,added_at,updated_at)
             VALUES ('b2','二号书','[]','epub','/b2.epub','desktop_path',1,1,'available',1,1)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO book_series VALUES ('b2','s1','',1)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO search_documents (book_id,spine_index,href,title,body,cfi)
             VALUES ('b2',0,'b2.xhtml','','界界界界',NULL)",
            [],
        )
        .unwrap();
        drop(conn);

        let error = persist_documents_with_budget(
            &db,
            "b1",
            "{\"new\":true}",
            &SearchExtraction::default(),
            15,
        )
        .unwrap_err();
        assert!(error.starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:"));
    }

    #[test]
    fn budget_error_state_update_keeps_existing_documents() {
        let db = seeded_db();
        mark_budget_error_preserving_documents(&db, "b1", "BOOK_RESOURCE_LIMIT_EXCEEDED: test")
            .unwrap();
        let conn = db.lock().unwrap();
        let body: String = conn
            .query_row(
                "SELECT body FROM search_documents WHERE book_id='b1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(body, "你好世界 Rust 搜索");
        let status: String = conn
            .query_row(
                "SELECT status FROM search_index_state WHERE book_id='b1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "error");
    }

    #[test]
    fn sqlite_full_maps_to_resource_limit_error() {
        let error =
            SqlError::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_FULL), None);
        assert!(map_search_sql_error("write", error).starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:"));
    }

    #[test]
    fn persist_error_rolls_back_when_fts_rebuild_fails() {
        let db = seeded_db();
        let error = persist_error_with_fts_sql(
            &db,
            "b1",
            "BOOK_SOURCE_UNAVAILABLE: test",
            "INSERT INTO missing_search_fts(missing_search_fts) VALUES ('rebuild')",
        )
        .unwrap_err();
        assert!(error.starts_with("INTERNAL_ERROR:"));
        let conn = db.lock().unwrap();
        let body: String = conn
            .query_row(
                "SELECT body FROM search_documents WHERE book_id='b1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let status: String = conn
            .query_row(
                "SELECT status FROM search_index_state WHERE book_id='b1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(body, "你好世界 Rust 搜索");
        assert_eq!(status, "ready");
    }

    #[test]
    fn sqlite_full_during_error_persistence_preserves_previous_index() {
        let db = seeded_db();
        {
            let conn = db.lock().unwrap();
            let page_count: i64 = conn
                .pragma_query_value(None, "page_count", |row| row.get(0))
                .unwrap();
            conn.pragma_update(None, "max_page_count", page_count)
                .unwrap();
        }
        let huge_error = format!("BOOK_SOURCE_UNAVAILABLE: {}", "x".repeat(8 * 1024 * 1024));
        let error = persist_error(&db, "b1", &huge_error).unwrap_err();
        assert!(error.starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:"));
        let conn = db.lock().unwrap();
        let document_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM search_documents WHERE book_id='b1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let status: String = conn
            .query_row(
                "SELECT status FROM search_index_state WHERE book_id='b1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(document_count, 1);
        assert_eq!(status, "ready");
    }

    #[test]
    fn sqlite_non_full_io_errors_remain_internal_errors() {
        let error =
            SqlError::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_IOERR), None);
        assert!(map_search_sql_error("write", error).starts_with("INTERNAL_ERROR:"));
    }
}
