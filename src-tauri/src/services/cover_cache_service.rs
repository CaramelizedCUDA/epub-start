use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::resource_budget::{COVER_CACHE_HARD_LIMIT_BYTES, COVER_CACHE_SOFT_LIMIT_BYTES};

pub struct CoverCache {
    cache_dir: PathBuf,
    db: Arc<Mutex<Connection>>,
    maintenance: Mutex<()>,
}

impl CoverCache {
    pub fn new(cache_dir: PathBuf, db: Arc<Mutex<Connection>>) -> Result<Self, String> {
        Self::new_with_limits(
            cache_dir,
            db,
            COVER_CACHE_SOFT_LIMIT_BYTES,
            COVER_CACHE_HARD_LIMIT_BYTES,
        )
    }

    fn new_with_limits(
        cache_dir: PathBuf,
        db: Arc<Mutex<Connection>>,
        soft_limit: u64,
        hard_limit: u64,
    ) -> Result<Self, String> {
        fs::create_dir_all(&cache_dir)
            .map_err(|_| "INTERNAL_ERROR: cover cache directory cannot be created".to_string())?;
        let cache = Self {
            cache_dir,
            db,
            maintenance: Mutex::new(()),
        };
        cache.reconcile()?;
        cache.enforce_limits(soft_limit, hard_limit)?;
        Ok(cache)
    }

    pub fn directory(&self) -> &Path {
        &self.cache_dir
    }

    pub fn admit_candidate(
        &self,
        candidate_path: &Path,
        previous_path: Option<&Path>,
    ) -> Result<(), String> {
        self.admit_candidate_with_limits(
            candidate_path,
            previous_path,
            COVER_CACHE_SOFT_LIMIT_BYTES,
            COVER_CACHE_HARD_LIMIT_BYTES,
        )
    }

    pub fn discard_candidate(
        &self,
        candidate_path: &Path,
        previous_path: Option<&Path>,
    ) -> Result<(), String> {
        if previous_path == Some(candidate_path) {
            return Ok(());
        }
        if !is_direct_cache_child(&self.cache_dir, candidate_path) {
            return Err("INTERNAL_ERROR: cover cache candidate is invalid".to_string());
        }
        self.remove_cache_file(candidate_path)
    }

    pub fn remove_replaced_cover(
        &self,
        previous_path: Option<&str>,
        current_path: Option<&str>,
    ) -> Result<(), String> {
        if previous_path == current_path {
            return Ok(());
        }
        if let Some(previous_path) = previous_path {
            self.remove_stored_cover(previous_path)?;
        }
        Ok(())
    }

    pub fn remove_stored_cover(&self, stored_path: &str) -> Result<(), String> {
        let path = PathBuf::from(stored_path);
        if !is_direct_cache_child(&self.cache_dir, &path) {
            return Ok(());
        }
        self.remove_cache_file(&path)
    }

    fn admit_candidate_with_limits(
        &self,
        candidate_path: &Path,
        previous_path: Option<&Path>,
        soft_limit: u64,
        hard_limit: u64,
    ) -> Result<(), String> {
        if !is_direct_cache_child(&self.cache_dir, candidate_path)
            || !fs::metadata(candidate_path)
                .map(|metadata| metadata.is_file())
                .unwrap_or(false)
        {
            return Err("INTERNAL_ERROR: cover cache candidate is invalid".to_string());
        }
        let mut protected = HashSet::from([candidate_path.to_path_buf()]);
        if let Some(previous_path) =
            previous_path.filter(|path| is_direct_cache_child(&self.cache_dir, path))
        {
            protected.insert(previous_path.to_path_buf());
        }
        self.enforce_limits_protecting(soft_limit, hard_limit, &protected)
    }

    fn reconcile(&self) -> Result<(), String> {
        let _maintenance = self
            .maintenance
            .lock()
            .map_err(|_| "INTERNAL_ERROR: cover cache lock poisoned".to_string())?;
        let persisted = {
            let conn = self
                .db
                .lock()
                .map_err(|_| "INTERNAL_ERROR: cover cache database lock poisoned".to_string())?;
            let mut statement = conn
                .prepare(
                    "SELECT id, cover_cache_path FROM books WHERE cover_cache_path IS NOT NULL",
                )
                .map_err(|_| "INTERNAL_ERROR: cover cache metadata cannot be read".to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|_| "INTERNAL_ERROR: cover cache metadata cannot be read".to_string())?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|_| "INTERNAL_ERROR: cover cache metadata cannot be read".to_string())?
        };

        let mut referenced_paths = HashSet::new();
        let mut stale_references = Vec::new();
        for (book_id, stored_path) in persisted {
            let path = PathBuf::from(&stored_path);
            let is_valid = is_direct_cache_child(&self.cache_dir, &path)
                && fs::metadata(&path)
                    .map(|metadata| metadata.is_file())
                    .unwrap_or(false);
            if is_valid {
                referenced_paths.insert(path);
            } else {
                stale_references.push((book_id, stored_path));
            }
        }

        if !stale_references.is_empty() {
            let mut conn = self
                .db
                .lock()
                .map_err(|_| "INTERNAL_ERROR: cover cache database lock poisoned".to_string())?;
            let transaction = conn.transaction().map_err(|_| {
                "INTERNAL_ERROR: cover cache metadata cannot be reconciled".to_string()
            })?;
            for (book_id, stored_path) in stale_references {
                transaction
                    .execute(
                        "UPDATE books SET cover_cache_path = NULL
                         WHERE id = ?1 AND cover_cache_path = ?2",
                        rusqlite::params![book_id, stored_path],
                    )
                    .map_err(|_| {
                        "INTERNAL_ERROR: cover cache metadata cannot be reconciled".to_string()
                    })?;
            }
            transaction.commit().map_err(|_| {
                "INTERNAL_ERROR: cover cache metadata cannot be reconciled".to_string()
            })?;
        }

        for entry in fs::read_dir(&self.cache_dir)
            .map_err(|_| "INTERNAL_ERROR: cover cache cannot be enumerated".to_string())?
        {
            let entry = entry
                .map_err(|_| "INTERNAL_ERROR: cover cache entry cannot be read".to_string())?;
            let file_type = entry
                .file_type()
                .map_err(|_| "INTERNAL_ERROR: cover cache entry cannot be read".to_string())?;
            if file_type.is_file() && !referenced_paths.contains(&entry.path()) {
                fs::remove_file(entry.path()).map_err(|_| {
                    "INTERNAL_ERROR: orphan cover cache entry cannot be removed".to_string()
                })?;
            }
        }

        Ok(())
    }

    fn enforce_limits(&self, soft_limit: u64, hard_limit: u64) -> Result<(), String> {
        self.enforce_limits_protecting(soft_limit, hard_limit, &HashSet::new())
    }

    fn enforce_limits_protecting(
        &self,
        soft_limit: u64,
        hard_limit: u64,
        protected: &HashSet<PathBuf>,
    ) -> Result<(), String> {
        if soft_limit > hard_limit {
            return Err("INTERNAL_ERROR: cover cache limits are invalid".to_string());
        }
        let _maintenance = self
            .maintenance
            .lock()
            .map_err(|_| "INTERNAL_ERROR: cover cache lock poisoned".to_string())?;
        let persisted = {
            let conn = self
                .db
                .lock()
                .map_err(|_| "INTERNAL_ERROR: cover cache database lock poisoned".to_string())?;
            let mut statement = conn
                .prepare(
                    "SELECT id, cover_cache_path, updated_at
                     FROM books WHERE cover_cache_path IS NOT NULL",
                )
                .map_err(|_| "INTERNAL_ERROR: cover cache metadata cannot be read".to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                })
                .map_err(|_| "INTERNAL_ERROR: cover cache metadata cannot be read".to_string())?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|_| "INTERNAL_ERROR: cover cache metadata cannot be read".to_string())?
        };

        let mut total = 0_u64;
        let mut persisted_paths = HashSet::new();
        let mut entries = Vec::new();
        for (book_id, stored_path, updated_at) in persisted {
            let path = PathBuf::from(&stored_path);
            if !is_direct_cache_child(&self.cache_dir, &path) {
                continue;
            }
            let size = match fs::metadata(&path) {
                Ok(metadata) if metadata.is_file() => metadata.len(),
                Ok(_) => continue,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => {
                    return Err(
                        "INTERNAL_ERROR: cover cache entry metadata cannot be read".to_string()
                    )
                }
            };
            total = total.checked_add(size).ok_or_else(|| {
                "BOOK_RESOURCE_LIMIT_EXCEEDED: cover cache size overflow".to_string()
            })?;
            persisted_paths.insert(path.clone());
            entries.push((updated_at, book_id, Some(stored_path), path, size));
        }
        for path in protected {
            if persisted_paths.contains(path) {
                continue;
            }
            let size = fs::metadata(path)
                .map_err(|_| "INTERNAL_ERROR: cover cache candidate cannot be read".to_string())?
                .len();
            total = total.checked_add(size).ok_or_else(|| {
                "BOOK_RESOURCE_LIMIT_EXCEEDED: cover cache size overflow".to_string()
            })?;
            entries.push((
                i64::MAX,
                path.to_string_lossy().to_string(),
                None,
                path.clone(),
                size,
            ));
        }
        entries.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));

        for (_, book_id, stored_path, path, size) in entries {
            if total <= soft_limit {
                break;
            }
            if protected.contains(&path) {
                continue;
            }
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => continue,
            }
            if let Some(stored_path) = stored_path {
                let conn = self.db.lock().map_err(|_| {
                    "INTERNAL_ERROR: cover cache database lock poisoned".to_string()
                })?;
                conn.execute(
                    "UPDATE books SET cover_cache_path = NULL
                     WHERE id = ?1 AND cover_cache_path = ?2",
                    rusqlite::params![book_id, stored_path],
                )
                .map_err(|_| {
                    "INTERNAL_ERROR: cover cache metadata cannot be updated".to_string()
                })?;
            }
            total = total.saturating_sub(size);
        }

        if total > hard_limit {
            return Err(
                "BOOK_RESOURCE_LIMIT_EXCEEDED: cover cache hard limit cannot be satisfied while import covers are protected"
                    .to_string(),
            );
        }
        Ok(())
    }

    fn remove_cache_file(&self, path: &Path) -> Result<(), String> {
        let _maintenance = self
            .maintenance
            .lock()
            .map_err(|_| "INTERNAL_ERROR: cover cache lock poisoned".to_string())?;
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("INTERNAL_ERROR: cover cache entry cannot be removed".to_string()),
        }
    }
}

fn is_direct_cache_child(cache_dir: &Path, path: &Path) -> bool {
    path.file_name().is_some() && path.parent() == Some(cache_dir)
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    use rusqlite::Connection;

    use super::CoverCache;

    fn insert_book_with_cover(
        conn: &Connection,
        book_id: &str,
        cover_path: &Path,
        updated_at: i64,
    ) {
        conn.execute(
            "INSERT INTO books (
                id, title, authors_json, format, cover_cache_path,
                source_locator, source_kind, file_size_bytes, last_modified_ts,
                status, added_at, updated_at
             ) VALUES (?1, 'Book', '[]', 'epub', ?2, ?3, 'desktop_path', 1, 1,
                       'available', 1, ?4)",
            rusqlite::params![
                book_id,
                cover_path.to_string_lossy(),
                format!("C:\\{book_id}.epub"),
                updated_at
            ],
        )
        .unwrap();
    }

    #[test]
    fn startup_removes_orphans_and_clears_missing_database_paths() {
        let cache_dir =
            std::env::temp_dir().join(format!("epub-cover-cache-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&cache_dir).unwrap();
        let db = Arc::new(Mutex::new(Connection::open_in_memory().unwrap()));
        crate::db::migrations::run_migrations(&db.lock().unwrap()).unwrap();
        let valid_path = cache_dir.join("valid.jpg");
        let missing_path = cache_dir.join("missing.jpg");
        let orphan_path = cache_dir.join("orphan.jpg");
        std::fs::write(&valid_path, b"valid").unwrap();
        std::fs::write(&orphan_path, b"orphan").unwrap();
        {
            let conn = db.lock().unwrap();
            insert_book_with_cover(&conn, "book-valid", &valid_path, 20);
            insert_book_with_cover(&conn, "book-missing", &missing_path, 10);
        }

        let cache =
            CoverCache::new_with_limits(cache_dir.clone(), Arc::clone(&db), 64, 128).unwrap();

        assert!(valid_path.exists());
        assert!(!orphan_path.exists());
        let missing_cover: Option<String> = db
            .lock()
            .unwrap()
            .query_row(
                "SELECT cover_cache_path FROM books WHERE id = 'book-missing'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(missing_cover, None);
        drop(cache);
        std::fs::remove_dir_all(cache_dir).unwrap();
    }

    #[test]
    fn cache_evicts_oldest_book_cover_to_soft_limit() {
        let cache_dir =
            std::env::temp_dir().join(format!("epub-cover-budget-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&cache_dir).unwrap();
        let db = Arc::new(Mutex::new(Connection::open_in_memory().unwrap()));
        crate::db::migrations::run_migrations(&db.lock().unwrap()).unwrap();
        {
            let conn = db.lock().unwrap();
            for (book_id, updated_at) in [
                ("book-oldest", 10_i64),
                ("book-middle", 20_i64),
                ("book-newest", 30_i64),
            ] {
                let cover_path = cache_dir.join(format!("{book_id}.jpg"));
                std::fs::write(&cover_path, b"1234").unwrap();
                insert_book_with_cover(&conn, book_id, &cover_path, updated_at);
            }
        }

        let cache = CoverCache::new_with_limits(cache_dir.clone(), Arc::clone(&db), 8, 16).unwrap();

        assert!(!cache_dir.join("book-oldest.jpg").exists());
        assert!(cache_dir.join("book-middle.jpg").exists());
        assert!(cache_dir.join("book-newest.jpg").exists());
        let oldest_cover: Option<String> = db
            .lock()
            .unwrap()
            .query_row(
                "SELECT cover_cache_path FROM books WHERE id = 'book-oldest'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(oldest_cover, None);
        drop(cache);
        std::fs::remove_dir_all(cache_dir).unwrap();
    }

    #[test]
    fn admission_protects_candidate_and_previous_cover() {
        let cache_dir =
            std::env::temp_dir().join(format!("epub-cover-admission-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&cache_dir).unwrap();
        let db = Arc::new(Mutex::new(Connection::open_in_memory().unwrap()));
        crate::db::migrations::run_migrations(&db.lock().unwrap()).unwrap();
        let previous_path = cache_dir.join("book-current-old.jpg");
        let unrelated_path = cache_dir.join("book-unrelated.jpg");
        std::fs::write(&previous_path, b"1234").unwrap();
        std::fs::write(&unrelated_path, b"5678").unwrap();
        {
            let conn = db.lock().unwrap();
            insert_book_with_cover(&conn, "book-current", &previous_path, 10);
            insert_book_with_cover(&conn, "book-unrelated", &unrelated_path, 20);
        }
        let cache =
            CoverCache::new_with_limits(cache_dir.clone(), Arc::clone(&db), 100, 100).unwrap();
        let candidate_path = cache_dir.join("book-current-new.jpg");
        std::fs::write(&candidate_path, b"abcd").unwrap();

        cache
            .admit_candidate_with_limits(&candidate_path, Some(&previous_path), 8, 16)
            .unwrap();

        assert!(candidate_path.exists());
        assert!(previous_path.exists());
        assert!(!unrelated_path.exists());
        let unrelated_cover: Option<String> = db
            .lock()
            .unwrap()
            .query_row(
                "SELECT cover_cache_path FROM books WHERE id = 'book-unrelated'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(unrelated_cover, None);
        drop(cache);
        std::fs::remove_dir_all(cache_dir).unwrap();
    }

    #[test]
    fn protected_import_covers_over_hard_limit_return_stable_error() {
        let cache_dir =
            std::env::temp_dir().join(format!("epub-cover-hard-limit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&cache_dir).unwrap();
        let db = Arc::new(Mutex::new(Connection::open_in_memory().unwrap()));
        crate::db::migrations::run_migrations(&db.lock().unwrap()).unwrap();
        let previous_path = cache_dir.join("book-current-old.jpg");
        std::fs::write(&previous_path, b"123456").unwrap();
        insert_book_with_cover(&db.lock().unwrap(), "book-current", &previous_path, 10);
        let cache =
            CoverCache::new_with_limits(cache_dir.clone(), Arc::clone(&db), 100, 100).unwrap();
        let candidate_path = cache_dir.join("book-current-new.jpg");
        std::fs::write(&candidate_path, b"abcdef").unwrap();

        let error = cache
            .admit_candidate_with_limits(&candidate_path, Some(&previous_path), 4, 8)
            .unwrap_err();

        assert_eq!(
            error,
            "BOOK_RESOURCE_LIMIT_EXCEEDED: cover cache hard limit cannot be satisfied while import covers are protected"
        );
        assert!(candidate_path.exists());
        assert!(previous_path.exists());
        drop(cache);
        std::fs::remove_dir_all(cache_dir).unwrap();
    }

    #[test]
    fn failed_import_cleanup_removes_candidate_but_preserves_previous_cover() {
        let cache_dir =
            std::env::temp_dir().join(format!("epub-cover-failed-import-{}", uuid::Uuid::new_v4()));
        let db = Arc::new(Mutex::new(Connection::open_in_memory().unwrap()));
        crate::db::migrations::run_migrations(&db.lock().unwrap()).unwrap();
        let cache =
            CoverCache::new_with_limits(cache_dir.clone(), Arc::clone(&db), 100, 100).unwrap();
        let previous_path = cache_dir.join("book-old.jpg");
        let candidate_path = cache_dir.join("book-new.jpg");
        std::fs::write(&previous_path, b"old").unwrap();
        std::fs::write(&candidate_path, b"new").unwrap();

        cache
            .discard_candidate(&candidate_path, Some(&previous_path))
            .unwrap();

        assert!(!candidate_path.exists());
        assert!(previous_path.exists());
        cache
            .discard_candidate(&previous_path, Some(&previous_path))
            .unwrap();
        assert!(previous_path.exists());
        drop(cache);
        std::fs::remove_dir_all(cache_dir).unwrap();
    }
}
