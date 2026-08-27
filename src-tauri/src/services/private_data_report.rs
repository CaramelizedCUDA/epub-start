use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Physical application-data accounting used only by the controlled B3
/// release-like diagnostic build. Search-index bytes are a logical ledger
/// reported separately because the index lives inside the SQLite database.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrivateDataReport {
    pub schema_version: u32,
    pub total_bytes: u64,
    pub database_bytes: u64,
    pub source_cache_bytes: u64,
    pub cover_cache_bytes: u64,
    pub other_bytes: u64,
    pub search_index_text_bytes: u64,
    pub search_document_count: u64,
}

/// Collect a non-mutating physical file breakdown and the existing logical
/// search-index ledger. The caller owns the AppHandle/State adapter; this
/// service deliberately knows only about the app-data root and SQLite.
pub fn collect_private_data_report(
    app_data_root: &Path,
    db: &Connection,
) -> Result<PrivateDataReport, String> {
    let physical = collect_physical_bytes(app_data_root)?;
    let (search_index_text_bytes, search_document_count) = search_index_ledger(db)?;

    Ok(PrivateDataReport {
        schema_version: 1,
        total_bytes: physical.total_bytes()?,
        database_bytes: physical.database_bytes,
        source_cache_bytes: physical.source_cache_bytes,
        cover_cache_bytes: physical.cover_cache_bytes,
        other_bytes: physical.other_bytes,
        search_index_text_bytes,
        search_document_count,
    })
}

#[derive(Debug, Default)]
struct PhysicalBytes {
    database_bytes: u64,
    source_cache_bytes: u64,
    cover_cache_bytes: u64,
    other_bytes: u64,
}

impl PhysicalBytes {
    fn add(&mut self, category: PhysicalCategory, bytes: u64) -> Result<(), String> {
        let target = match category {
            PhysicalCategory::Database => &mut self.database_bytes,
            PhysicalCategory::SourceCache => &mut self.source_cache_bytes,
            PhysicalCategory::CoverCache => &mut self.cover_cache_bytes,
            PhysicalCategory::Other => &mut self.other_bytes,
        };
        *target = target
            .checked_add(bytes)
            .ok_or_else(|| "INTERNAL_ERROR: private data byte counter overflow".to_string())?;
        Ok(())
    }

    fn total_bytes(&self) -> Result<u64, String> {
        self.database_bytes
            .checked_add(self.source_cache_bytes)
            .and_then(|total| total.checked_add(self.cover_cache_bytes))
            .and_then(|total| total.checked_add(self.other_bytes))
            .ok_or_else(|| "INTERNAL_ERROR: private data total overflow".to_string())
    }
}

#[derive(Debug, Clone, Copy)]
enum PhysicalCategory {
    Database,
    SourceCache,
    CoverCache,
    Other,
}

fn collect_physical_bytes(app_data_root: &Path) -> Result<PhysicalBytes, String> {
    let root_metadata = fs::symlink_metadata(app_data_root)
        .map_err(|_| "INTERNAL_ERROR: private data root cannot be read".to_string())?;
    if !root_metadata.is_dir() {
        return Err("INTERNAL_ERROR: private data root is not a directory".to_string());
    }

    let mut bytes = PhysicalBytes::default();
    walk_directory(app_data_root, app_data_root, None, &mut bytes)?;
    Ok(bytes)
}

fn walk_directory(
    root: &Path,
    directory: &Path,
    inherited_category: Option<PhysicalCategory>,
    bytes: &mut PhysicalBytes,
) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|_| "INTERNAL_ERROR: private data directory cannot be read".to_string())?;

    for entry in entries {
        let entry =
            entry.map_err(|_| "INTERNAL_ERROR: private data entry cannot be read".to_string())?;
        let entry_path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|_| "INTERNAL_ERROR: private data entry type cannot be read".to_string())?;
        let category = inherited_category.or_else(|| root_entry_category(root, &entry_path));

        if file_type.is_dir() {
            walk_directory(root, &entry_path, category, bytes)?;
        } else if file_type.is_file() {
            let size = entry
                .metadata()
                .map_err(|_| {
                    "INTERNAL_ERROR: private data file metadata cannot be read".to_string()
                })?
                .len();
            bytes.add(category.unwrap_or(PhysicalCategory::Other), size)?;
        } else {
            return Err(
                "INTERNAL_ERROR: private data contains an unsupported filesystem entry".to_string(),
            );
        }
    }
    Ok(())
}

fn root_entry_category(root: &Path, entry: &Path) -> Option<PhysicalCategory> {
    if entry.parent() != Some(root) {
        return None;
    }
    let name = entry.file_name()?.to_str()?;
    if name == "source-cache" {
        Some(PhysicalCategory::SourceCache)
    } else if name == "covers" {
        Some(PhysicalCategory::CoverCache)
    } else if is_database_file(name) {
        Some(PhysicalCategory::Database)
    } else {
        Some(PhysicalCategory::Other)
    }
}

fn is_database_file(name: &str) -> bool {
    matches!(
        name,
        "epubstart.db" | "epubstart.db-journal" | "epubstart.db-wal" | "epubstart.db-shm"
    )
}

fn search_index_ledger(db: &Connection) -> Result<(u64, u64), String> {
    let (bytes, documents): (i64, i64) = db
        .query_row(
            "SELECT COALESCE(SUM(
                 length(CAST(title AS BLOB)) +
                 length(CAST(body AS BLOB)) +
                 length(CAST(href AS BLOB)) +
                 length(CAST(COALESCE(cfi, '') AS BLOB))
             ), 0), COUNT(*)
             FROM search_documents",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "INTERNAL_ERROR: search index ledger cannot be read".to_string())?;

    let bytes = non_negative_i64(bytes, "search index byte counter")?;
    let documents = non_negative_i64(documents, "search document counter")?;
    Ok((bytes, documents))
}

fn non_negative_i64(value: i64, label: &str) -> Result<u64, String> {
    u64::try_from(value).map_err(|_| format!("INTERNAL_ERROR: {label} is negative"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::run_migrations;
    use rusqlite::params;
    use std::fs;
    use std::path::PathBuf;

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "epubstart-b3-private-data-report-{}",
            uuid::Uuid::new_v4()
        ))
    }

    fn write_bytes(path: &std::path::Path, size: usize) -> Result<(), String> {
        fs::write(path, vec![b'x'; size]).map_err(|error| error.to_string())
    }

    #[test]
    fn report_accounts_physical_categories_and_search_ledger() -> Result<(), String> {
        let root = test_root();
        fs::create_dir_all(root.join("source-cache/nested")).map_err(|error| error.to_string())?;
        fs::create_dir_all(root.join("covers")).map_err(|error| error.to_string())?;
        write_bytes(&root.join("epubstart.db"), 3)?;
        write_bytes(&root.join("epubstart.db-journal"), 2)?;
        write_bytes(&root.join("source-cache/nested/source.bin"), 7)?;
        write_bytes(&root.join("covers/cover.jpg"), 11)?;
        write_bytes(&root.join("other.log"), 13)?;

        let db = Connection::open_in_memory().map_err(|error| error.to_string())?;
        run_migrations(&db).map_err(|error| error.to_string())?;
        db.execute(
            "INSERT INTO books (
                id, title, authors_json, format, source_locator, source_kind,
                file_size_bytes, last_modified_ts, status, added_at, updated_at
             ) VALUES ('b1', 'Book', '[]', 'epub', '/book.epub', 'desktop_path', 1, 1,
                       'available', 1, 1)",
            [],
        )
        .map_err(|error| error.to_string())?;
        db.execute(
            "INSERT INTO search_documents (book_id, spine_index, href, title, body, cfi)
             VALUES (?1, 0, ?2, ?3, ?4, NULL)",
            params!["b1", "c.xhtml", "Title", "你好"],
        )
        .map_err(|error| error.to_string())?;

        let report = collect_private_data_report(&root, &db)?;
        assert_eq!(report.schema_version, 1);
        assert_eq!(report.database_bytes, 5);
        assert_eq!(report.source_cache_bytes, 7);
        assert_eq!(report.cover_cache_bytes, 11);
        assert_eq!(report.other_bytes, 13);
        assert_eq!(report.total_bytes, 36);
        assert_eq!(report.search_index_text_bytes, 18);
        assert_eq!(report.search_document_count, 1);

        fs::remove_dir_all(root).map_err(|error| error.to_string())
    }
}
