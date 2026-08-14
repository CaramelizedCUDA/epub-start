use std::collections::HashSet;
use std::sync::Mutex;

use rusqlite::Connection;

use crate::db::catalog_repository;
use crate::db::models::{
    BookSeries, BookTag, CreateSeriesInput, CreateTagGroupInput, CreateTagInput, Series,
    SeriesBookPosition, Tag, TagGroup, UpdateSeriesInput, UpdateTagGroupInput, UpdateTagInput,
};

pub fn list_series(db: &Mutex<Connection>) -> Result<Vec<Series>, String> {
    let conn = lock_db(db)?;
    catalog_repository::list_series(&conn)
        .map_err(|error| format!("INTERNAL_ERROR: series query failed: {error}"))
}

pub fn create_series(db: &Mutex<Connection>, input: CreateSeriesInput) -> Result<Series, String> {
    let now = super::now_ms();
    let series = Series {
        id: uuid::Uuid::new_v4().to_string(),
        name: validate_name(&input.name, "series name")?,
        created_at: now,
        updated_at: now,
    };
    let conn = lock_db(db)?;
    catalog_repository::insert_series(&conn, &series)
        .map_err(|error| format!("INTERNAL_ERROR: series insert failed: {error}"))?;
    Ok(series)
}

pub fn update_series(db: &Mutex<Connection>, input: UpdateSeriesInput) -> Result<Series, String> {
    let series = Series {
        id: input.id,
        name: validate_name(&input.name, "series name")?,
        created_at: 0,
        updated_at: super::now_ms(),
    };
    let conn = lock_db(db)?;
    require_entity(&conn, "series", &series.id, "series")?;
    catalog_repository::update_series(&conn, &series)
        .map_err(|_| "INTERNAL_ERROR: series update failed".to_string())?;
    catalog_repository::find_series(&conn, &series.id)
        .map_err(|_| "INTERNAL_ERROR: series query failed".to_string())?
        .ok_or_else(|| "INTERNAL_ERROR: updated series disappeared".to_string())
}

pub fn delete_series(db: &Mutex<Connection>, series_id: &str) -> Result<(), String> {
    let conn = lock_db(db)?;
    require_entity(&conn, "series", series_id, "series")?;
    catalog_repository::delete_series(&conn, series_id)
        .map_err(|error| format!("INTERNAL_ERROR: series delete failed: {error}"))
}

pub fn set_book_series(
    db: &Mutex<Connection>,
    assignment: BookSeries,
) -> Result<BookSeries, String> {
    if assignment.volume_label.chars().count() > 200 {
        return Err("VALIDATION_ERROR: volume label is too long".into());
    }
    let conn = lock_db(db)?;
    require_entity(&conn, "books", &assignment.book_id, "book")?;
    require_entity(&conn, "series", &assignment.series_id, "series")?;
    catalog_repository::set_book_series(&conn, &assignment)
        .map_err(|error| format!("INTERNAL_ERROR: series assignment failed: {error}"))?;
    Ok(assignment)
}

pub fn clear_book_series(db: &Mutex<Connection>, book_id: &str) -> Result<(), String> {
    let conn = lock_db(db)?;
    require_entity(&conn, "books", book_id, "book")?;
    catalog_repository::clear_book_series(&conn, book_id)
        .map_err(|error| format!("INTERNAL_ERROR: series assignment delete failed: {error}"))
}

pub fn reorder_series_books(
    db: &Mutex<Connection>,
    series_id: &str,
    positions: Vec<SeriesBookPosition>,
) -> Result<Vec<BookSeries>, String> {
    ensure_unique_ids(positions.iter().map(|position| position.book_id.as_str()))?;
    let conn = lock_db(db)?;
    require_entity(&conn, "series", series_id, "series")?;
    let assigned = catalog_repository::list_book_series(&conn, series_id)
        .map_err(|_| "INTERNAL_ERROR: series query failed".to_string())?;
    let assigned_ids: HashSet<&str> = assigned.iter().map(|item| item.book_id.as_str()).collect();
    if positions
        .iter()
        .any(|position| !assigned_ids.contains(position.book_id.as_str()))
    {
        return Err("VALIDATION_ERROR: reorder contains a book outside the series".into());
    }
    catalog_repository::reorder_series_books(&conn, series_id, &positions)
        .map_err(|error| format!("INTERNAL_ERROR: series reorder failed: {error}"))?;
    catalog_repository::list_book_series(&conn, series_id)
        .map_err(|error| format!("INTERNAL_ERROR: series query failed: {error}"))
}

pub fn list_tag_groups(db: &Mutex<Connection>) -> Result<Vec<TagGroup>, String> {
    let conn = lock_db(db)?;
    catalog_repository::list_tag_groups(&conn)
        .map_err(|error| format!("INTERNAL_ERROR: tag group query failed: {error}"))
}

pub fn create_tag_group(
    db: &Mutex<Connection>,
    input: CreateTagGroupInput,
) -> Result<TagGroup, String> {
    let now = super::now_ms();
    let group = TagGroup {
        id: uuid::Uuid::new_v4().to_string(),
        name: validate_name(&input.name, "tag group name")?,
        sort_order: input.sort_order,
        created_at: now,
        updated_at: now,
    };
    let conn = lock_db(db)?;
    catalog_repository::insert_tag_group(&conn, &group)
        .map_err(|error| format!("INTERNAL_ERROR: tag group insert failed: {error}"))?;
    Ok(group)
}

pub fn update_tag_group(
    db: &Mutex<Connection>,
    input: UpdateTagGroupInput,
) -> Result<TagGroup, String> {
    let group = TagGroup {
        id: input.id,
        name: validate_name(&input.name, "tag group name")?,
        sort_order: input.sort_order,
        created_at: 0,
        updated_at: super::now_ms(),
    };
    let conn = lock_db(db)?;
    require_entity(&conn, "tag_groups", &group.id, "tag group")?;
    catalog_repository::update_tag_group(&conn, &group)
        .map_err(|_| "INTERNAL_ERROR: tag group update failed".to_string())?;
    catalog_repository::find_tag_group(&conn, &group.id)
        .map_err(|_| "INTERNAL_ERROR: tag group query failed".to_string())?
        .ok_or_else(|| "INTERNAL_ERROR: updated tag group disappeared".to_string())
}

pub fn delete_tag_group(db: &Mutex<Connection>, group_id: &str) -> Result<(), String> {
    let conn = lock_db(db)?;
    require_entity(&conn, "tag_groups", group_id, "tag group")?;
    catalog_repository::delete_tag_group(&conn, group_id)
        .map_err(|error| format!("INTERNAL_ERROR: tag group delete failed: {error}"))
}

pub fn list_tags(db: &Mutex<Connection>) -> Result<Vec<Tag>, String> {
    let conn = lock_db(db)?;
    catalog_repository::list_tags(&conn)
        .map_err(|error| format!("INTERNAL_ERROR: tag query failed: {error}"))
}

pub fn create_tag(db: &Mutex<Connection>, input: CreateTagInput) -> Result<Tag, String> {
    let now = super::now_ms();
    let mut tag = Tag {
        id: uuid::Uuid::new_v4().to_string(),
        group_id: input.group_id,
        name: input.name,
        color: input.color,
        created_at: now,
        updated_at: now,
    };
    validate_tag(&mut tag)?;
    let conn = lock_db(db)?;
    if let Some(group_id) = tag.group_id.as_deref() {
        require_entity(&conn, "tag_groups", group_id, "tag group")?;
    }
    catalog_repository::insert_tag(&conn, &tag)
        .map_err(|error| format!("INTERNAL_ERROR: tag insert failed: {error}"))?;
    Ok(tag)
}

pub fn update_tag(db: &Mutex<Connection>, input: UpdateTagInput) -> Result<Tag, String> {
    let mut tag = Tag {
        id: input.id,
        group_id: input.group_id,
        name: input.name,
        color: input.color,
        created_at: 0,
        updated_at: super::now_ms(),
    };
    validate_tag(&mut tag)?;
    let conn = lock_db(db)?;
    require_entity(&conn, "tags", &tag.id, "tag")?;
    if let Some(group_id) = tag.group_id.as_deref() {
        require_entity(&conn, "tag_groups", group_id, "tag group")?;
    }
    catalog_repository::update_tag(&conn, &tag)
        .map_err(|_| "INTERNAL_ERROR: tag update failed".to_string())?;
    catalog_repository::find_tag(&conn, &tag.id)
        .map_err(|_| "INTERNAL_ERROR: tag query failed".to_string())?
        .ok_or_else(|| "INTERNAL_ERROR: updated tag disappeared".to_string())
}

pub fn delete_tag(db: &Mutex<Connection>, tag_id: &str) -> Result<(), String> {
    let conn = lock_db(db)?;
    require_entity(&conn, "tags", tag_id, "tag")?;
    catalog_repository::delete_tag(&conn, tag_id)
        .map_err(|error| format!("INTERNAL_ERROR: tag delete failed: {error}"))
}

pub fn set_book_tags(
    db: &Mutex<Connection>,
    book_id: &str,
    tag_ids: Vec<String>,
) -> Result<Vec<BookTag>, String> {
    set_tags(db, "books", book_id, tag_ids, |conn, owner_id, ids| {
        catalog_repository::replace_book_tags(conn, owner_id, ids)
    })?;
    list_book_tags(db, book_id)
}

pub fn set_series_tags(
    db: &Mutex<Connection>,
    series_id: &str,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    set_tags(db, "series", series_id, tag_ids, |conn, owner_id, ids| {
        catalog_repository::replace_series_tags(conn, owner_id, ids)
    })
}

pub fn list_book_tags(db: &Mutex<Connection>, book_id: &str) -> Result<Vec<BookTag>, String> {
    let conn = lock_db(db)?;
    require_entity(&conn, "books", book_id, "book")?;
    catalog_repository::list_book_tags(&conn, book_id)
        .map_err(|error| format!("INTERNAL_ERROR: book tags query failed: {error}"))
}

fn set_tags(
    db: &Mutex<Connection>,
    owner_table: &str,
    owner_id: &str,
    tag_ids: Vec<String>,
    replace: impl FnOnce(&Connection, &str, &[String]) -> rusqlite::Result<()>,
) -> Result<(), String> {
    ensure_unique_ids(tag_ids.iter().map(String::as_str))?;
    let conn = lock_db(db)?;
    require_entity(
        &conn,
        owner_table,
        owner_id,
        owner_table.trim_end_matches('s'),
    )?;
    for tag_id in &tag_ids {
        require_entity(&conn, "tags", tag_id, "tag")?;
    }
    replace(&conn, owner_id, &tag_ids)
        .map_err(|error| format!("INTERNAL_ERROR: tag relationship update failed: {error}"))
}

fn validate_tag(tag: &mut Tag) -> Result<(), String> {
    tag.name = validate_name(&tag.name, "tag name")?;
    let color = tag.color.trim();
    if color.len() != 7
        || !color.starts_with('#')
        || !color[1..].bytes().all(|value| value.is_ascii_hexdigit())
    {
        return Err("VALIDATION_ERROR: tag color must be #RRGGBB".into());
    }
    tag.color = color.to_ascii_lowercase();
    Ok(())
}

fn validate_name(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 200 {
        return Err(format!(
            "VALIDATION_ERROR: {label} must contain 1-200 characters"
        ));
    }
    Ok(value.to_string())
}

fn ensure_unique_ids<'a>(ids: impl Iterator<Item = &'a str>) -> Result<(), String> {
    let mut seen = HashSet::new();
    if ids.into_iter().any(|id| id.is_empty() || !seen.insert(id)) {
        return Err("VALIDATION_ERROR: relationship ids must be non-empty and unique".into());
    }
    Ok(())
}

fn require_entity(conn: &Connection, table: &str, id: &str, label: &str) -> Result<(), String> {
    if catalog_repository::entity_exists(conn, table, id)
        .map_err(|error| format!("INTERNAL_ERROR: entity query failed: {error}"))?
    {
        Ok(())
    } else {
        let prefix = match table {
            "books" => "BOOK_NOT_FOUND",
            "series" => "SERIES_NOT_FOUND",
            "tags" => "TAG_NOT_FOUND",
            "tag_groups" => "TAG_GROUP_NOT_FOUND",
            _ => "INTERNAL_ERROR",
        };
        Err(format!("{prefix}: {label} {id} does not exist"))
    }
}

fn lock_db(db: &Mutex<Connection>) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.lock()
        .map_err(|error| format!("INTERNAL_ERROR: db lock poisoned: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_validation_normalizes_color_and_name() {
        let mut tag = Tag {
            id: "tag".into(),
            group_id: None,
            name: "  Fantasy  ".into(),
            color: "#AABBCC".into(),
            created_at: 0,
            updated_at: 0,
        };
        validate_tag(&mut tag).unwrap();
        assert_eq!(tag.name, "Fantasy");
        assert_eq!(tag.color, "#aabbcc");
    }
}
