use crate::commands::AppState;
use crate::db::models::ReadingProgress;
use crate::db::repository;

/// Persists the current reading position.
///
/// `location_cfi` must be a valid EPUB CFI string and `progression`
/// must be in the range [0.0, 1.0]. Uses upsert semantics so repeated
/// saves are idempotent.
#[tauri::command]
pub fn save_reading_progress(
    state: tauri::State<AppState>,
    book_id: String,
    location_cfi: String,
    progression: f64,
) -> Result<ReadingProgress, String> {
    // Validate progression range
    if !(0.0..=1.0).contains(&progression) {
        return Err(format!(
            "VALIDATION_ERROR: progression must be between 0.0 and 1.0, got {}",
            progression
        ));
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let progress = ReadingProgress {
        book_id,
        location_cfi: Some(location_cfi),
        progression: Some(progression),
        updated_at: now,
    };

    let db = state
        .db
        .lock()
        .map_err(|e| format!("internal error: db lock poisoned: {}", e))?;

    repository::upsert_reading_progress(&db, &progress)
        .map_err(|e| format!("internal error: db upsert failed: {}", e))?;

    // Return the saved record (re-query to get canonical values)
    repository::get_reading_progress(&db, &progress.book_id)
        .map_err(|e| format!("internal error: db query failed: {}", e))?
        .ok_or_else(|| "internal error: progress was just saved but not found".to_string())
}
