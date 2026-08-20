use std::collections::HashMap;
#[cfg(any(target_os = "android", test))]
use std::collections::HashSet;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};
#[cfg(target_os = "android")]
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(any(target_os = "android", test))]
use std::io;
#[cfg(target_os = "android")]
use std::io::{Read, Seek, SeekFrom, Write};

use tauri::{AppHandle, Runtime};

#[cfg(any(target_os = "android", test))]
use rusqlite::params;
use rusqlite::Connection;

use super::fingerprint::SourceFingerprint;
#[cfg(target_os = "android")]
use super::reader::MAX_SOURCE_SIZE;
use super::reader::{open_checked_source, ReadSeek};
#[cfg(any(target_os = "android", test))]
use crate::resource_budget::{SOURCE_CACHE_HARD_LIMIT_BYTES, SOURCE_CACHE_SOFT_LIMIT_BYTES};

pub struct SourceLease {
    path: PathBuf,
    _guard: Arc<()>,
}

impl SourceLease {
    pub fn open_reader(&self) -> Result<Box<dyn ReadSeek>, String> {
        File::open(&self.path)
            .map(|file| Box::new(file) as Box<dyn ReadSeek>)
            .map_err(|_| "BOOK_SOURCE_UNAVAILABLE: leased source cannot be opened".to_string())
    }
}

pub struct SourceManager {
    cache_dir: PathBuf,
    db: Arc<Mutex<Connection>>,
    active: Mutex<HashMap<String, Weak<()>>>,
}

impl SourceManager {
    pub fn new(cache_dir: PathBuf, db: Arc<Mutex<Connection>>) -> Result<Self, String> {
        let manager = Self::create(cache_dir, db)?;
        #[cfg(any(target_os = "android", test))]
        manager
            .initialize_cache_state(SOURCE_CACHE_SOFT_LIMIT_BYTES, SOURCE_CACHE_HARD_LIMIT_BYTES)?;
        Ok(manager)
    }

    fn create(cache_dir: PathBuf, db: Arc<Mutex<Connection>>) -> Result<Self, String> {
        fs::create_dir_all(&cache_dir)
            .map_err(|_| "INTERNAL_ERROR: source cache directory cannot be created".to_string())?;
        cleanup_temporary_files(&cache_dir);
        Ok(Self {
            cache_dir,
            db,
            active: Mutex::new(HashMap::new()),
        })
    }

    #[cfg(test)]
    fn new_with_limits(
        cache_dir: PathBuf,
        db: Arc<Mutex<Connection>>,
        soft_limit: u64,
        hard_limit: u64,
    ) -> Result<Self, String> {
        let manager = Self::create(cache_dir, db)?;
        manager.initialize_cache_state(soft_limit, hard_limit)?;
        Ok(manager)
    }

    #[cfg(any(target_os = "android", test))]
    fn initialize_cache_state(&self, soft_limit: u64, hard_limit: u64) -> Result<(), String> {
        self.reconcile_cache_state()?;
        self.enforce_cache_limits(None, soft_limit, hard_limit)
    }

    pub fn acquire<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        book_id: &str,
        source_locator: &str,
    ) -> Result<(SourceLease, SourceFingerprint), String> {
        #[cfg(not(target_os = "android"))]
        {
            let (_file, fingerprint) = open_checked_source(app, source_locator)?;
            let guard = self.guard_for(book_id)?;
            return Ok((
                SourceLease {
                    path: PathBuf::from(source_locator),
                    _guard: guard,
                },
                fingerprint,
            ));
        }

        #[cfg(target_os = "android")]
        {
            self.acquire_android(app, book_id, source_locator)
        }
    }

    fn guard_for(&self, book_id: &str) -> Result<Arc<()>, String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "INTERNAL_ERROR: source lease lock poisoned".to_string())?;
        if let Some(existing) = active.get(book_id).and_then(Weak::upgrade) {
            return Ok(existing);
        }
        let guard = Arc::new(());
        active.insert(book_id.to_string(), Arc::downgrade(&guard));
        Ok(guard)
    }

    #[cfg(target_os = "android")]
    fn acquire_android<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        book_id: &str,
        source_locator: &str,
    ) -> Result<(SourceLease, SourceFingerprint), String> {
        eprintln!("[EPUB-IMPORT] acquire_android: open_checked_source start");
        let (mut source, before) = open_checked_source(app, source_locator)?;
        eprintln!("[EPUB-IMPORT] acquire_android: open_checked_source ok");
        let cache_path = self.cache_dir.join(format!("{book_id}.source"));
        let fingerprint_path = self.cache_dir.join(format!("{book_id}.fingerprint.json"));

        if before.can_persist_across_restarts()
            && cache_path.is_file()
            && read_fingerprint(&fingerprint_path)
                .map(|stored| stored.cache_matches(&before))
                .unwrap_or(false)
        {
            self.touch_cache_hit(book_id, &cache_path, &before)?;
            let guard = self.guard_for(book_id)?;
            return Ok((
                SourceLease {
                    path: cache_path,
                    _guard: guard,
                },
                before,
            ));
        }

        remove_if_exists(&cache_path);
        remove_if_exists(&fingerprint_path);
        eprintln!("[EPUB-IMPORT] acquire_android: copy_source_atomically start");
        self.copy_source_atomically(book_id, &mut source, &cache_path)?;
        eprintln!("[EPUB-IMPORT] acquire_android: copy done, re-verify start");

        let (_after_file, after) = open_checked_source(app, source_locator)?;
        eprintln!("[EPUB-IMPORT] acquire_android: re-verify done");
        if !before.cache_matches(&after) {
            remove_if_exists(&cache_path);
            return Err("BOOK_SOURCE_UNAVAILABLE: source changed while being cached".into());
        }
        if after.can_persist_across_restarts() {
            write_fingerprint(&fingerprint_path, &after)?;
        }
        self.persist_cache_entry(book_id, &cache_path, &after)?;
        self.evict_if_needed(book_id)?;
        let guard = self.guard_for(book_id)?;
        Ok((
            SourceLease {
                path: cache_path,
                _guard: guard,
            },
            after,
        ))
    }

    #[cfg(target_os = "android")]
    fn copy_source_atomically(
        &self,
        book_id: &str,
        source: &mut File,
        cache_path: &Path,
    ) -> Result<(), String> {
        let temp_path = self.cache_dir.join(format!("{book_id}.source.tmp"));
        let mut target =
            File::create(&temp_path).map_err(|error| source_cache_io_error("create", &error))?;
        source
            .seek(SeekFrom::Start(0))
            .map_err(|_| "BOOK_SOURCE_UNAVAILABLE: Android source cannot be rewound".to_string())?;
        let mut limited = source.take(MAX_SOURCE_SIZE + 1);
        let copied = std::io::copy(&mut limited, &mut target)
            .map_err(|error| source_cache_io_error("copy", &error))?;
        target
            .flush()
            .map_err(|error| source_cache_io_error("flush", &error))?;
        if copied > MAX_SOURCE_SIZE {
            remove_if_exists(&temp_path);
            return Err("BOOK_RESOURCE_LIMIT_EXCEEDED: compressed source is too large".into());
        }
        fs::rename(&temp_path, cache_path).map_err(|error| source_cache_io_error("commit", &error))
    }

    #[cfg(target_os = "android")]
    fn evict_if_needed(&self, current_book_id: &str) -> Result<(), String> {
        let result = self.enforce_cache_limits(
            Some(current_book_id),
            SOURCE_CACHE_SOFT_LIMIT_BYTES,
            SOURCE_CACHE_HARD_LIMIT_BYTES,
        );
        if result
            .as_ref()
            .is_err_and(|error| error.starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:"))
        {
            self.invalidate(current_book_id);
        }
        result
    }

    #[cfg(any(target_os = "android", test))]
    fn is_active(&self, book_id: &str) -> Result<bool, String> {
        self.active
            .lock()
            .map(|active| active.get(book_id).and_then(Weak::upgrade).is_some())
            .map_err(|_| "INTERNAL_ERROR: source lease lock poisoned".to_string())
    }

    #[cfg(any(target_os = "android", test))]
    fn reconcile_cache_state(&self) -> Result<(), String> {
        let persisted_entries = {
            let conn = self
                .db
                .lock()
                .map_err(|_| "INTERNAL_ERROR: source cache database lock poisoned".to_string())?;
            let mut statement = conn
                .prepare("SELECT book_id, cache_size_bytes FROM source_cache_entries")
                .map_err(|_| "INTERNAL_ERROR: source cache metadata cannot be read".to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .map_err(|_| "INTERNAL_ERROR: source cache metadata cannot be read".to_string())?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|_| "INTERNAL_ERROR: source cache metadata cannot be read".to_string())?
        };

        let mut valid_book_ids = HashSet::new();
        let mut stale_book_ids = Vec::new();
        for (book_id, persisted_size) in persisted_entries {
            let source_path = self.cache_dir.join(format!("{book_id}.source"));
            let is_valid = match fs::metadata(&source_path) {
                Ok(metadata) => {
                    metadata.is_file() && i64::try_from(metadata.len()).ok() == Some(persisted_size)
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => false,
                Err(_) => {
                    return Err(
                        "INTERNAL_ERROR: source cache entry metadata cannot be read".to_string()
                    )
                }
            };
            if is_valid {
                valid_book_ids.insert(book_id);
                continue;
            }

            remove_cache_file_for_reconciliation(&source_path)?;
            remove_cache_file_for_reconciliation(
                &self.cache_dir.join(format!("{book_id}.fingerprint.json")),
            )?;
            stale_book_ids.push(book_id);
        }

        if !stale_book_ids.is_empty() {
            let mut conn = self
                .db
                .lock()
                .map_err(|_| "INTERNAL_ERROR: source cache database lock poisoned".to_string())?;
            let transaction = conn.transaction().map_err(|_| {
                "INTERNAL_ERROR: source cache metadata cannot be reconciled".to_string()
            })?;
            for book_id in stale_book_ids {
                transaction
                    .execute(
                        "DELETE FROM source_cache_entries WHERE book_id = ?1",
                        [&book_id],
                    )
                    .map_err(|_| {
                        "INTERNAL_ERROR: source cache metadata cannot be reconciled".to_string()
                    })?;
            }
            transaction.commit().map_err(|_| {
                "INTERNAL_ERROR: source cache metadata cannot be reconciled".to_string()
            })?;
        }

        for entry in fs::read_dir(&self.cache_dir)
            .map_err(|_| "INTERNAL_ERROR: source cache cannot be enumerated".to_string())?
        {
            let entry = entry
                .map_err(|_| "INTERNAL_ERROR: source cache entry cannot be read".to_string())?;
            let path = entry.path();
            let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
                return Err("INTERNAL_ERROR: source cache entry name is invalid".to_string());
            };
            let book_id = file_name
                .strip_suffix(".source")
                .or_else(|| file_name.strip_suffix(".fingerprint.json"));
            let Some(book_id) = book_id else {
                continue;
            };
            if book_id.is_empty() || valid_book_ids.contains(book_id) {
                continue;
            }
            remove_cache_file_for_reconciliation(&path)?;
        }

        Ok(())
    }

    #[cfg(any(target_os = "android", test))]
    fn enforce_cache_limits(
        &self,
        current_book_id: Option<&str>,
        soft_limit: u64,
        hard_limit: u64,
    ) -> Result<(), String> {
        if soft_limit > hard_limit {
            return Err("INTERNAL_ERROR: source cache limits are invalid".to_string());
        }

        let access_times = {
            let conn = self
                .db
                .lock()
                .map_err(|_| "INTERNAL_ERROR: source cache database lock poisoned".to_string())?;
            let mut statement = conn
                .prepare("SELECT book_id, last_accessed_at FROM source_cache_entries")
                .map_err(|_| "INTERNAL_ERROR: source cache metadata cannot be read".to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .map_err(|_| "INTERNAL_ERROR: source cache metadata cannot be read".to_string())?;
            rows.collect::<rusqlite::Result<HashMap<_, _>>>()
                .map_err(|_| "INTERNAL_ERROR: source cache metadata cannot be read".to_string())?
        };

        let mut entries = Vec::new();
        let mut total = 0_u64;
        for entry in fs::read_dir(&self.cache_dir)
            .map_err(|_| "INTERNAL_ERROR: source cache cannot be enumerated".to_string())?
        {
            let entry = entry
                .map_err(|_| "INTERNAL_ERROR: source cache entry cannot be read".to_string())?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("source") {
                continue;
            }
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "INTERNAL_ERROR: source cache entry name is invalid".to_string())?;
            let book_id = file_name
                .strip_suffix(".source")
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "INTERNAL_ERROR: source cache entry name is invalid".to_string())?
                .to_string();
            let size = entry
                .metadata()
                .map_err(|_| {
                    "INTERNAL_ERROR: source cache entry metadata cannot be read".to_string()
                })?
                .len();
            total = total.checked_add(size).ok_or_else(|| {
                "BOOK_RESOURCE_LIMIT_EXCEEDED: source cache size overflow".to_string()
            })?;
            entries.push((
                access_times.get(&book_id).copied().unwrap_or(i64::MIN),
                book_id,
                path,
                size,
            ));
        }
        entries.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));

        for (_, book_id, path, size) in entries {
            if total <= soft_limit {
                break;
            }
            if current_book_id == Some(book_id.as_str()) || self.is_active(&book_id)? {
                continue;
            }
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(_) => {
                    return Err("INTERNAL_ERROR: source cache entry cannot be evicted".to_string())
                }
            }
            remove_if_exists(&self.cache_dir.join(format!("{book_id}.fingerprint.json")));
            let conn = self
                .db
                .lock()
                .map_err(|_| "INTERNAL_ERROR: source cache database lock poisoned".to_string())?;
            conn.execute(
                "DELETE FROM source_cache_entries WHERE book_id = ?1",
                [&book_id],
            )
            .map_err(|_| "INTERNAL_ERROR: source cache metadata cannot be removed".to_string())?;
            total = total.saturating_sub(size);
        }

        if total > hard_limit {
            return Err(
                "BOOK_RESOURCE_LIMIT_EXCEEDED: source cache hard limit cannot be satisfied while active leases are protected"
                    .to_string(),
            );
        }
        Ok(())
    }

    pub fn invalidate(&self, book_id: &str) {
        remove_if_exists(&self.cache_dir.join(format!("{book_id}.source")));
        remove_if_exists(&self.cache_dir.join(format!("{book_id}.fingerprint.json")));
        if let Ok(conn) = self.db.lock() {
            let _ = conn.execute(
                "DELETE FROM source_cache_entries WHERE book_id = ?1",
                [book_id],
            );
        }
    }

    #[cfg(target_os = "android")]
    fn touch_cache_hit(
        &self,
        book_id: &str,
        cache_path: &Path,
        fingerprint: &SourceFingerprint,
    ) -> Result<(), String> {
        let conn = self
            .db
            .lock()
            .map_err(|_| "INTERNAL_ERROR: source cache database lock poisoned".to_string())?;
        let now = unix_epoch_millis();
        if touch_cache_entry(&conn, book_id, now)
            .map_err(|_| "INTERNAL_ERROR: source cache access time cannot be updated".to_string())?
        {
            return Ok(());
        }
        persist_cache_entry(&conn, book_id, cache_path, fingerprint, now)
    }

    #[cfg(target_os = "android")]
    fn persist_cache_entry(
        &self,
        book_id: &str,
        cache_path: &Path,
        fingerprint: &SourceFingerprint,
    ) -> Result<(), String> {
        let conn = self
            .db
            .lock()
            .map_err(|_| "INTERNAL_ERROR: source cache database lock poisoned".to_string())?;
        persist_cache_entry(&conn, book_id, cache_path, fingerprint, unix_epoch_millis())
    }
}

#[cfg(any(target_os = "android", test))]
fn touch_cache_entry(conn: &Connection, book_id: &str, observed_at: i64) -> rusqlite::Result<bool> {
    conn.execute(
        "UPDATE source_cache_entries
         SET last_accessed_at = MAX(
             ?2,
             (SELECT COALESCE(MAX(last_accessed_at), 0) + 1 FROM source_cache_entries)
         )
         WHERE book_id = ?1",
        params![book_id, observed_at],
    )
    .map(|changed| changed == 1)
}

#[cfg(any(target_os = "android", test))]
fn persist_cache_entry(
    conn: &Connection,
    book_id: &str,
    cache_path: &Path,
    fingerprint: &SourceFingerprint,
    observed_at: i64,
) -> Result<(), String> {
    let cache_size = fs::metadata(cache_path)
        .map_err(|_| "BOOK_SOURCE_UNAVAILABLE: cached source metadata cannot be read".to_string())?
        .len();
    let cache_size = i64::try_from(cache_size)
        .map_err(|_| "BOOK_RESOURCE_LIMIT_EXCEEDED: source cache size overflow".to_string())?;
    let last_accessed_at = conn
        .query_row(
            "SELECT MAX(?1, COALESCE(MAX(last_accessed_at), 0) + 1)
             FROM source_cache_entries",
            [observed_at],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|_| "INTERNAL_ERROR: source cache access time cannot be read".to_string())?;
    conn.execute(
        "INSERT INTO source_cache_entries (
             book_id, cache_path, source_locator, file_size_bytes,
             last_modified_ts, head_sample, cache_size_bytes, last_accessed_at
         )
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
         WHERE EXISTS (SELECT 1 FROM books WHERE id = ?1)
         ON CONFLICT(book_id) DO UPDATE SET
             cache_path = excluded.cache_path,
             source_locator = excluded.source_locator,
             file_size_bytes = excluded.file_size_bytes,
             last_modified_ts = excluded.last_modified_ts,
             head_sample = excluded.head_sample,
             cache_size_bytes = excluded.cache_size_bytes,
             last_accessed_at = excluded.last_accessed_at",
        params![
            book_id,
            cache_path.to_string_lossy(),
            fingerprint.source_locator,
            fingerprint.file_size_bytes,
            fingerprint.last_modified_ts,
            fingerprint.head_sample,
            cache_size,
            last_accessed_at,
        ],
    )
    .map(|_| ())
    .map_err(|_| "INTERNAL_ERROR: source cache metadata cannot be persisted".to_string())
}

#[cfg(target_os = "android")]
fn unix_epoch_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

fn cleanup_temporary_files(cache_dir: &Path) {
    if let Ok(entries) = fs::read_dir(cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) == Some("tmp") {
                remove_if_exists(&path);
            }
        }
    }
}

fn remove_if_exists(path: &Path) {
    let _ = fs::remove_file(path);
}

#[cfg(any(target_os = "android", test))]
fn remove_cache_file_for_reconciliation(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("INTERNAL_ERROR: source cache entry cannot be reconciled".to_string()),
    }
}

#[cfg(any(target_os = "android", test))]
fn source_cache_io_error(operation: &str, error: &io::Error) -> String {
    if is_storage_exhausted(error) {
        return format!(
            "BOOK_RESOURCE_LIMIT_EXCEEDED: source cache {operation} failed because device storage is full"
        );
    }
    format!("BOOK_SOURCE_UNAVAILABLE: source cache {operation} failed")
}

#[cfg(any(target_os = "android", test))]
fn is_storage_exhausted(error: &io::Error) -> bool {
    matches!(error.raw_os_error(), Some(28 | 122 | 112))
}

#[cfg(target_os = "android")]
fn read_fingerprint(path: &Path) -> Option<SourceFingerprint> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(target_os = "android")]
fn write_fingerprint(path: &Path, fingerprint: &SourceFingerprint) -> Result<(), String> {
    let bytes = serde_json::to_vec(fingerprint)
        .map_err(|_| "INTERNAL_ERROR: source fingerprint cannot be encoded".to_string())?;
    fs::write(path, bytes)
        .map_err(|_| "INTERNAL_ERROR: source fingerprint cannot be persisted".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager() -> SourceManager {
        SourceManager {
            cache_dir: std::env::temp_dir()
                .join(format!("epub-cache-test-{}", uuid::Uuid::new_v4())),
            db: Arc::new(Mutex::new(Connection::open_in_memory().unwrap())),
            active: Mutex::new(HashMap::new()),
        }
    }

    fn cache_manager() -> SourceManager {
        let manager = manager();
        fs::create_dir_all(&manager.cache_dir).unwrap();
        crate::db::migrations::run_migrations(&manager.db.lock().unwrap()).unwrap();
        manager
    }

    fn seed_cache_entry(manager: &SourceManager, book_id: &str, size: usize, accessed_at: i64) {
        let cache_path = manager.cache_dir.join(format!("{book_id}.source"));
        fs::write(&cache_path, vec![0_u8; size]).unwrap();
        let conn = manager.db.lock().unwrap();
        conn.execute(
            "INSERT INTO books (
                id, title, authors_json, format, source_locator, source_kind,
                file_size_bytes, last_modified_ts, status, added_at, updated_at
             ) VALUES (?1, 'Book', '[]', 'epub', ?2, 'android_content_uri', ?3, 1, 'available', 1, 1)",
            rusqlite::params![book_id, format!("content://{book_id}"), size as i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO source_cache_entries (
                book_id, cache_path, source_locator, file_size_bytes,
                last_modified_ts, head_sample, cache_size_bytes, last_accessed_at
             ) VALUES (?1, ?2, ?3, ?4, 1, X'00', ?4, ?5)",
            rusqlite::params![
                book_id,
                cache_path.to_string_lossy(),
                format!("content://{book_id}"),
                size as i64,
                accessed_at
            ],
        )
        .unwrap();
    }

    #[test]
    fn concurrent_guards_for_same_book_share_one_arc() {
        let manager = std::sync::Arc::new(manager());
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let manager = manager.clone();
                std::thread::spawn(move || {
                    for _ in 0..100 {
                        let guard = manager.guard_for("book-a").unwrap();
                        std::thread::yield_now();
                        drop(guard);
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
        // 锁未中毒、未死锁：并发结束后仍可正常获取租约。
        let guard = manager.guard_for("book-a").unwrap();
        assert_eq!(Arc::strong_count(&guard), 1);
    }

    #[test]
    fn guard_is_shared_while_any_lease_is_alive() {
        let manager = manager();
        let first = manager.guard_for("book-b").unwrap();
        let second = manager.guard_for("book-b").unwrap();
        assert!(
            Arc::ptr_eq(&first, &second),
            "concurrent leases for one book must share the same guard"
        );
    }

    #[test]
    fn guard_is_recreated_after_all_leases_drop() {
        let manager = manager();
        let first = manager.guard_for("book-c").unwrap();
        drop(first);
        let second = manager.guard_for("book-c").unwrap();
        assert_eq!(Arc::strong_count(&second), 1);
        let third = manager.guard_for("book-c").unwrap();
        assert!(
            Arc::ptr_eq(&second, &third),
            "recreated guard must be shared by subsequent leases"
        );
    }

    #[test]
    fn distinct_books_get_distinct_guards() {
        let manager = manager();
        let first = manager.guard_for("book-d").unwrap();
        let second = manager.guard_for("book-e").unwrap();
        assert!(!Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn temporary_files_are_cleaned_on_startup() {
        let dir = std::env::temp_dir().join(format!("epub-cache-tmp-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("stale.tmp"), b"x").unwrap();
        fs::write(dir.join("keep.source"), b"y").unwrap();
        cleanup_temporary_files(&dir);
        assert!(!dir.join("stale.tmp").exists());
        assert!(dir.join("keep.source").exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn storage_write_errors_use_resource_limit_prefix() {
        let error = io::Error::from_raw_os_error(28);
        assert!(source_cache_io_error("copy", &error).starts_with("BOOK_RESOURCE_LIMIT_EXCEEDED:"));
    }

    #[test]
    fn non_storage_write_errors_remain_source_errors() {
        let error = io::Error::from(io::ErrorKind::PermissionDenied);
        assert!(source_cache_io_error("copy", &error).starts_with("BOOK_SOURCE_UNAVAILABLE:"));
    }

    #[test]
    fn cache_hit_advances_persisted_lru_clock() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrations::run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO books (
                id, title, authors_json, format, source_locator, source_kind,
                file_size_bytes, last_modified_ts, status, added_at, updated_at
             ) VALUES (?1, 'Book', '[]', 'epub', ?2, 'android_content_uri', 4, 1, 'available', 1, 1)",
            rusqlite::params!["book-a", "content://book-a"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO source_cache_entries (
                book_id, cache_path, source_locator, file_size_bytes,
                last_modified_ts, head_sample, cache_size_bytes, last_accessed_at
             ) VALUES (?1, 'book-a.source', ?2, 4, 1, X'0102', 4, 10)",
            rusqlite::params!["book-a", "content://book-a"],
        )
        .unwrap();

        touch_cache_entry(&conn, "book-a", 5).unwrap();

        let last_accessed_at: i64 = conn
            .query_row(
                "SELECT last_accessed_at FROM source_cache_entries WHERE book_id = ?1",
                ["book-a"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(last_accessed_at, 11);
    }

    #[test]
    fn persisted_cache_metadata_uses_actual_file_size() {
        let manager = cache_manager();
        let cache_path = manager.cache_dir.join("book-persisted.source");
        fs::write(&cache_path, b"1234567").unwrap();
        let conn = manager.db.lock().unwrap();
        conn.execute(
            "INSERT INTO books (
                id, title, authors_json, format, source_locator, source_kind,
                file_size_bytes, last_modified_ts, status, added_at, updated_at
             ) VALUES (?1, 'Book', '[]', 'epub', ?2, 'android_content_uri', 99, 42, 'available', 1, 1)",
            rusqlite::params!["book-persisted", "content://book-persisted"],
        )
        .unwrap();
        let fingerprint = SourceFingerprint {
            source_locator: "content://book-persisted".to_string(),
            file_size_bytes: 99,
            last_modified_ts: 42,
            head_sample: vec![1, 2, 3],
        };

        persist_cache_entry(&conn, "book-persisted", &cache_path, &fingerprint, 10).unwrap();

        let persisted: (i64, i64, i64, Vec<u8>) = conn
            .query_row(
                "SELECT file_size_bytes, last_modified_ts, cache_size_bytes, head_sample
                 FROM source_cache_entries WHERE book_id = 'book-persisted'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(persisted, (99, 42, 7, vec![1, 2, 3]));
        drop(conn);
        fs::remove_dir_all(&manager.cache_dir).unwrap();
    }

    #[test]
    fn source_cache_evicts_by_persisted_lru_not_file_mtime() {
        let manager = cache_manager();
        seed_cache_entry(&manager, "book-b", 4, 30);
        seed_cache_entry(&manager, "book-c", 4, 20);
        seed_cache_entry(&manager, "book-a", 4, 10);

        manager.enforce_cache_limits(Some("book-c"), 8, 16).unwrap();

        assert!(!manager.cache_dir.join("book-a.source").exists());
        assert!(manager.cache_dir.join("book-b.source").exists());
        assert!(manager.cache_dir.join("book-c.source").exists());
        let remaining: i64 = manager
            .db
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM source_cache_entries", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(remaining, 2);
        fs::remove_dir_all(&manager.cache_dir).unwrap();
    }

    #[test]
    fn active_source_lease_is_skipped_during_lru_eviction() {
        let manager = cache_manager();
        seed_cache_entry(&manager, "book-a", 4, 10);
        seed_cache_entry(&manager, "book-b", 4, 20);
        seed_cache_entry(&manager, "book-c", 4, 30);
        let active_guard = manager.guard_for("book-a").unwrap();

        manager.enforce_cache_limits(Some("book-c"), 8, 16).unwrap();

        assert!(
            manager.cache_dir.join("book-a.source").exists(),
            "an active source lease must protect its cache file"
        );
        assert!(!manager.cache_dir.join("book-b.source").exists());
        assert!(manager.cache_dir.join("book-c.source").exists());
        drop(active_guard);
        fs::remove_dir_all(&manager.cache_dir).unwrap();
    }

    #[test]
    fn protected_entries_over_hard_limit_return_stable_error() {
        let manager = cache_manager();
        seed_cache_entry(&manager, "book-active", 6, 10);
        seed_cache_entry(&manager, "book-current", 6, 20);
        let active_guard = manager.guard_for("book-active").unwrap();

        let error = manager
            .enforce_cache_limits(Some("book-current"), 4, 8)
            .unwrap_err();

        assert_eq!(
            error,
            "BOOK_RESOURCE_LIMIT_EXCEEDED: source cache hard limit cannot be satisfied while active leases are protected"
        );
        assert!(manager.cache_dir.join("book-active.source").exists());
        assert!(manager.cache_dir.join("book-current.source").exists());
        drop(active_guard);
        fs::remove_dir_all(&manager.cache_dir).unwrap();
    }

    #[test]
    fn source_cache_limits_are_256_and_512_mib() {
        assert_eq!(SOURCE_CACHE_SOFT_LIMIT_BYTES, 256 * 1024 * 1024);
        assert_eq!(SOURCE_CACHE_HARD_LIMIT_BYTES, 512 * 1024 * 1024);
    }

    #[test]
    fn restart_reconciles_orphan_files_and_missing_cache_rows() {
        let seeded = cache_manager();
        seed_cache_entry(&seeded, "book-valid", 4, 10);
        seed_cache_entry(&seeded, "book-missing", 4, 20);
        fs::remove_file(seeded.cache_dir.join("book-missing.source")).unwrap();
        fs::write(seeded.cache_dir.join("orphan.source"), b"orphan").unwrap();
        fs::write(seeded.cache_dir.join("orphan.fingerprint.json"), b"{}").unwrap();
        let cache_dir = seeded.cache_dir.clone();
        let db = Arc::clone(&seeded.db);
        drop(seeded);

        let restarted = SourceManager::new(cache_dir.clone(), Arc::clone(&db)).unwrap();

        assert!(cache_dir.join("book-valid.source").exists());
        assert!(!cache_dir.join("orphan.source").exists());
        assert!(!cache_dir.join("orphan.fingerprint.json").exists());
        let missing_rows: i64 = db
            .lock()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM source_cache_entries WHERE book_id = 'book-missing'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(missing_rows, 0);
        drop(restarted);
        fs::remove_dir_all(cache_dir).unwrap();
    }

    #[test]
    fn restart_reapplies_source_cache_budget() {
        let seeded = cache_manager();
        seed_cache_entry(&seeded, "book-oldest", 4, 10);
        seed_cache_entry(&seeded, "book-middle", 4, 20);
        seed_cache_entry(&seeded, "book-newest", 4, 30);
        let cache_dir = seeded.cache_dir.clone();
        let db = Arc::clone(&seeded.db);
        drop(seeded);

        let restarted =
            SourceManager::new_with_limits(cache_dir.clone(), Arc::clone(&db), 8, 16).unwrap();

        assert!(!cache_dir.join("book-oldest.source").exists());
        assert!(cache_dir.join("book-middle.source").exists());
        assert!(cache_dir.join("book-newest.source").exists());
        let remaining_rows: i64 = db
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM source_cache_entries", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(remaining_rows, 2);
        drop(restarted);
        fs::remove_dir_all(cache_dir).unwrap();
    }
}
