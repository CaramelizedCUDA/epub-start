use std::sync::Mutex;

use rusqlite::Connection;

use crate::db::models::{
    BookReadingSettings, BookReadingSettingsInput, ReadingSettings, ReadingSettingsInput,
    ReadingSettingsResult,
};
use crate::db::repository;

pub fn get_global_reading_settings(db: &Mutex<Connection>) -> Result<ReadingSettings, String> {
    let conn = lock_db(db)?;
    repository::get_global_reading_settings(&conn)
        .map_err(|_| "INTERNAL_ERROR: settings query failed".to_string())
}

pub fn get_reading_settings(
    db: &Mutex<Connection>,
    book_id: &str,
) -> Result<ReadingSettingsResult, String> {
    let conn = lock_db(db)?;
    require_book(&conn, book_id)?;
    let global = repository::get_global_reading_settings(&conn)
        .map_err(|_| "INTERNAL_ERROR: settings query failed".to_string())?;
    let book_override = repository::get_book_reading_settings(&conn, book_id)
        .map_err(|_| "INTERNAL_ERROR: settings query failed".to_string())?;
    let effective = resolve_settings(&global, book_override.as_ref());
    Ok(ReadingSettingsResult {
        effective,
        global,
        book_override,
    })
}

pub fn save_global_reading_settings(
    db: &Mutex<Connection>,
    input: ReadingSettingsInput,
) -> Result<ReadingSettings, String> {
    let settings = ReadingSettings {
        theme: input.theme,
        font_family: input.font_family,
        font_size_px: input.font_size_px,
        line_height_multiplier: input.line_height_multiplier,
        paragraph_spacing_multiplier: input.paragraph_spacing_multiplier,
        text_indent_em: input.text_indent_em,
        margin_top_px: input.margin_top_px,
        margin_bottom_px: input.margin_bottom_px,
        margin_left_percent: input.margin_left_percent,
        margin_right_percent: input.margin_right_percent,
        max_column_width_px: input.max_column_width_px,
        flow: input.flow,
        spread: input.spread,
        updated_at: super::now_ms(),
    };
    validate_effective_settings(&settings)?;
    let conn = lock_db(db)?;
    repository::save_global_reading_settings(&conn, &settings)
        .map_err(|_| "INTERNAL_ERROR: settings update failed".to_string())?;
    Ok(settings)
}

pub fn save_book_reading_settings(
    db: &Mutex<Connection>,
    input: BookReadingSettingsInput,
) -> Result<BookReadingSettings, String> {
    let settings = BookReadingSettings {
        book_id: input.book_id,
        theme: input.theme,
        font_family: input.font_family,
        font_size_px: input.font_size_px,
        line_height_multiplier: input.line_height_multiplier,
        paragraph_spacing_multiplier: input.paragraph_spacing_multiplier,
        text_indent_em: input.text_indent_em,
        margin_top_px: input.margin_top_px,
        margin_bottom_px: input.margin_bottom_px,
        margin_left_percent: input.margin_left_percent,
        margin_right_percent: input.margin_right_percent,
        max_column_width_px: input.max_column_width_px,
        flow: input.flow,
        spread: input.spread,
        updated_at: super::now_ms(),
    };
    validate_book_settings(&settings)?;
    let conn = lock_db(db)?;
    if repository::find_book_by_id(&conn, &settings.book_id)
        .map_err(|_| "INTERNAL_ERROR: db query failed".to_string())?
        .is_none()
    {
        return Err(format!(
            "BOOK_NOT_FOUND: no book with id {}",
            settings.book_id
        ));
    }
    repository::save_book_reading_settings(&conn, &settings)
        .map_err(|_| "INTERNAL_ERROR: settings update failed".to_string())?;
    Ok(settings)
}

pub fn clear_book_reading_settings(db: &Mutex<Connection>, book_id: &str) -> Result<(), String> {
    let conn = lock_db(db)?;
    require_book(&conn, book_id)?;
    repository::clear_book_reading_settings(&conn, book_id)
        .map_err(|_| "INTERNAL_ERROR: settings delete failed".to_string())
}

fn require_book(conn: &Connection, book_id: &str) -> Result<(), String> {
    if repository::find_book_by_id(conn, book_id)
        .map_err(|_| "INTERNAL_ERROR: db query failed".to_string())?
        .is_none()
    {
        return Err(format!("BOOK_NOT_FOUND: no book with id {book_id}"));
    }
    Ok(())
}

fn resolve_settings(
    global: &ReadingSettings,
    book: Option<&BookReadingSettings>,
) -> ReadingSettings {
    ReadingSettings {
        theme: book
            .and_then(|value| value.theme.clone())
            .unwrap_or_else(|| global.theme.clone()),
        font_family: book
            .and_then(|value| value.font_family.clone())
            .unwrap_or_else(|| global.font_family.clone()),
        font_size_px: book
            .and_then(|value| value.font_size_px)
            .unwrap_or(global.font_size_px),
        line_height_multiplier: book
            .and_then(|value| value.line_height_multiplier)
            .unwrap_or(global.line_height_multiplier),
        paragraph_spacing_multiplier: book
            .and_then(|value| value.paragraph_spacing_multiplier)
            .unwrap_or(global.paragraph_spacing_multiplier),
        text_indent_em: book
            .and_then(|value| value.text_indent_em)
            .unwrap_or(global.text_indent_em),
        margin_top_px: book
            .and_then(|value| value.margin_top_px)
            .unwrap_or(global.margin_top_px),
        margin_bottom_px: book
            .and_then(|value| value.margin_bottom_px)
            .unwrap_or(global.margin_bottom_px),
        margin_left_percent: book
            .and_then(|value| value.margin_left_percent)
            .unwrap_or(global.margin_left_percent),
        margin_right_percent: book
            .and_then(|value| value.margin_right_percent)
            .unwrap_or(global.margin_right_percent),
        max_column_width_px: book
            .and_then(|value| value.max_column_width_px)
            .unwrap_or(global.max_column_width_px),
        flow: book
            .and_then(|value| value.flow.clone())
            .unwrap_or_else(|| global.flow.clone()),
        spread: book
            .and_then(|value| value.spread.clone())
            .unwrap_or_else(|| global.spread.clone()),
        updated_at: book
            .map(|value| value.updated_at)
            .unwrap_or(global.updated_at),
    }
}

fn validate_effective_settings(settings: &ReadingSettings) -> Result<(), String> {
    if !matches!(settings.theme.as_str(), "light" | "sepia" | "dark")
        || !matches!(
            settings.font_family.as_str(),
            "publisher" | "serif" | "sans" | "system"
        )
        || !(12..=32).contains(&settings.font_size_px)
        || !(1.0..=3.0).contains(&settings.line_height_multiplier)
        || !(0.0..=2.0).contains(&settings.paragraph_spacing_multiplier)
        || !(0.0..=4.0).contains(&settings.text_indent_em)
        || !(0..=100).contains(&settings.margin_top_px)
        || !(0..=100).contains(&settings.margin_bottom_px)
        || !(0..=20).contains(&settings.margin_left_percent)
        || !(0..=20).contains(&settings.margin_right_percent)
        || !(300..=1200).contains(&settings.max_column_width_px)
        || !matches!(settings.flow.as_str(), "paginated" | "scrolled")
        || !matches!(settings.spread.as_str(), "auto" | "none" | "always")
    {
        return Err("VALIDATION_ERROR: invalid reading settings".into());
    }
    Ok(())
}

fn validate_book_settings(settings: &BookReadingSettings) -> Result<(), String> {
    if settings
        .theme
        .as_deref()
        .is_some_and(|value| !matches!(value, "light" | "sepia" | "dark"))
        || settings
            .font_family
            .as_deref()
            .is_some_and(|value| !matches!(value, "publisher" | "serif" | "sans" | "system"))
        || settings
            .font_size_px
            .is_some_and(|value| !(12..=32).contains(&value))
        || settings
            .line_height_multiplier
            .is_some_and(|value| !(1.0..=3.0).contains(&value))
        || settings
            .paragraph_spacing_multiplier
            .is_some_and(|value| !(0.0..=2.0).contains(&value))
        || settings
            .text_indent_em
            .is_some_and(|value| !(0.0..=4.0).contains(&value))
        || settings
            .margin_top_px
            .is_some_and(|value| !(0..=100).contains(&value))
        || settings
            .margin_bottom_px
            .is_some_and(|value| !(0..=100).contains(&value))
        || settings
            .margin_left_percent
            .is_some_and(|value| !(0..=20).contains(&value))
        || settings
            .margin_right_percent
            .is_some_and(|value| !(0..=20).contains(&value))
        || settings
            .max_column_width_px
            .is_some_and(|value| !(300..=1200).contains(&value))
        || settings
            .flow
            .as_deref()
            .is_some_and(|value| !matches!(value, "paginated" | "scrolled"))
        || settings
            .spread
            .as_deref()
            .is_some_and(|value| !matches!(value, "auto" | "none" | "always"))
    {
        return Err("VALIDATION_ERROR: invalid book reading settings".into());
    }
    Ok(())
}

fn lock_db(db: &Mutex<Connection>) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.lock()
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Mutex<Connection> {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrations::run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO books VALUES ('b','Title','[]','epub',NULL,'/book.epub','desktop_path',1,2,NULL,'available',NULL,3,4)",
            [],
        )
        .unwrap();
        Mutex::new(conn)
    }

    fn valid_input(theme: &str) -> ReadingSettingsInput {
        ReadingSettingsInput {
            theme: theme.into(),
            font_family: "serif".into(),
            font_size_px: 16,
            line_height_multiplier: 1.5,
            paragraph_spacing_multiplier: 0.5,
            text_indent_em: 2.0,
            margin_top_px: 48,
            margin_bottom_px: 48,
            margin_left_percent: 3,
            margin_right_percent: 3,
            max_column_width_px: 720,
            flow: "paginated".into(),
            spread: "auto".into(),
        }
    }

    #[test]
    fn failed_global_save_keeps_previous_settings() {
        let db = test_db();
        save_global_reading_settings(&db, valid_input("sepia")).unwrap();
        let mut bad = valid_input("dark");
        bad.font_size_px = 999;
        let err = save_global_reading_settings(&db, bad).unwrap_err();
        assert!(err.starts_with("VALIDATION_ERROR:"));
        let current = get_global_reading_settings(&db).unwrap();
        assert_eq!(current.theme, "sepia");
        assert_eq!(current.font_size_px, 16);
    }

    #[test]
    fn concurrent_global_saves_do_not_corrupt() {
        let db = std::sync::Arc::new(test_db());
        let handles: Vec<_> = ["light", "sepia", "dark"]
            .into_iter()
            .cycle()
            .take(9)
            .map(|theme| {
                let db = db.clone();
                std::thread::spawn(move || {
                    save_global_reading_settings(&db, valid_input(theme)).unwrap();
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
        let current = get_global_reading_settings(&db).unwrap();
        assert!(matches!(current.theme.as_str(), "light" | "sepia" | "dark"));
        assert_eq!(current.font_size_px, 16);
    }

    #[test]
    fn book_settings_reject_unknown_book() {
        let db = test_db();
        let input = BookReadingSettingsInput {
            book_id: "ghost".into(),
            theme: Some("sepia".into()),
            font_family: None,
            font_size_px: None,
            line_height_multiplier: None,
            paragraph_spacing_multiplier: None,
            text_indent_em: None,
            margin_top_px: None,
            margin_bottom_px: None,
            margin_left_percent: None,
            margin_right_percent: None,
            max_column_width_px: None,
            flow: None,
            spread: None,
        };
        let err = save_book_reading_settings(&db, input).unwrap_err();
        assert!(
            err.starts_with("BOOK_NOT_FOUND:"),
            "unexpected error: {err}"
        );
    }

    fn global() -> ReadingSettings {
        ReadingSettings {
            theme: "dark".into(),
            font_family: "serif".into(),
            font_size_px: 16,
            line_height_multiplier: 1.5,
            paragraph_spacing_multiplier: 0.5,
            text_indent_em: 2.0,
            margin_top_px: 48,
            margin_bottom_px: 48,
            margin_left_percent: 3,
            margin_right_percent: 3,
            max_column_width_px: 720,
            flow: "paginated".into(),
            spread: "auto".into(),
            updated_at: 1,
        }
    }

    #[test]
    fn book_override_resolves_only_present_fields() {
        let book = BookReadingSettings {
            book_id: "book".into(),
            theme: Some("sepia".into()),
            font_family: None,
            font_size_px: Some(20),
            line_height_multiplier: None,
            paragraph_spacing_multiplier: None,
            text_indent_em: None,
            margin_top_px: None,
            margin_bottom_px: None,
            margin_left_percent: None,
            margin_right_percent: None,
            max_column_width_px: Some(800),
            flow: None,
            spread: None,
            updated_at: 2,
        };
        let resolved = resolve_settings(&global(), Some(&book));
        assert_eq!(resolved.theme, "sepia");
        assert_eq!(resolved.font_family, "serif");
        assert_eq!(resolved.font_size_px, 20);
        assert_eq!(resolved.max_column_width_px, 800);
        assert_eq!(resolved.updated_at, 2);
    }
}
