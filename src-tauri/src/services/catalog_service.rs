use std::collections::HashSet;
use std::sync::Mutex;

use rusqlite::{Connection, Error as SqlError};

use crate::db::catalog_repository;
use crate::db::models::{
    BookSeries, BookTag, CreateSeriesInput, CreateTagGroupInput, CreateTagInput, Series,
    SeriesBookPosition, Tag, TagGroup, UpdateSeriesInput, UpdateTagGroupInput, UpdateTagInput,
};

pub fn list_series(db: &Mutex<Connection>) -> Result<Vec<Series>, String> {
    let conn = lock_db(db)?;
    catalog_repository::list_series(&conn)
        .map_err(|_| "INTERNAL_ERROR: series query failed".to_string())
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
        .map_err(|error| map_series_write_error("insert", error))?;
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
        .map_err(|error| map_series_write_error("update", error))?;
    catalog_repository::find_series(&conn, &series.id)
        .map_err(|_| "INTERNAL_ERROR: series query failed".to_string())?
        .ok_or_else(|| "INTERNAL_ERROR: updated series disappeared".to_string())
}

pub fn delete_series(db: &Mutex<Connection>, series_id: &str) -> Result<(), String> {
    let conn = lock_db(db)?;
    require_entity(&conn, "series", series_id, "series")?;
    catalog_repository::delete_series(&conn, series_id)
        .map_err(|_| "INTERNAL_ERROR: series delete failed".to_string())
}

pub fn set_book_series(
    db: &Mutex<Connection>,
    mut assignment: BookSeries,
) -> Result<BookSeries, String> {
    assignment.volume_label = assignment.volume_label.trim().to_string();
    if assignment.volume_label.chars().count() > 200 {
        return Err("VALIDATION_ERROR: volume label is too long".into());
    }
    let conn = lock_db(db)?;
    require_entity(&conn, "books", &assignment.book_id, "book")?;
    require_entity(&conn, "series", &assignment.series_id, "series")?;
    catalog_repository::set_book_series(&conn, &assignment)
        .map_err(|_| "INTERNAL_ERROR: series assignment failed".to_string())?;
    Ok(assignment)
}

pub fn clear_book_series(db: &Mutex<Connection>, book_id: &str) -> Result<(), String> {
    let conn = lock_db(db)?;
    require_entity(&conn, "books", book_id, "book")?;
    catalog_repository::clear_book_series(&conn, book_id)
        .map_err(|_| "INTERNAL_ERROR: series assignment delete failed".to_string())
}

pub fn list_series_books(
    db: &Mutex<Connection>,
    series_id: &str,
) -> Result<Vec<BookSeries>, String> {
    let conn = lock_db(db)?;
    require_entity(&conn, "series", series_id, "series")?;
    catalog_repository::list_book_series(&conn, series_id)
        .map_err(|_| "INTERNAL_ERROR: series query failed".to_string())
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
        .map_err(|_| "INTERNAL_ERROR: series reorder failed".to_string())?;
    catalog_repository::list_book_series(&conn, series_id)
        .map_err(|_| "INTERNAL_ERROR: series query failed".to_string())
}

pub fn list_tag_groups(db: &Mutex<Connection>) -> Result<Vec<TagGroup>, String> {
    let conn = lock_db(db)?;
    catalog_repository::list_tag_groups(&conn)
        .map_err(|_| "INTERNAL_ERROR: tag group query failed".to_string())
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
        .map_err(|_| "INTERNAL_ERROR: tag group insert failed".to_string())?;
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
        .map_err(|_| "INTERNAL_ERROR: tag group delete failed".to_string())
}

pub fn list_tags(db: &Mutex<Connection>) -> Result<Vec<Tag>, String> {
    let conn = lock_db(db)?;
    catalog_repository::list_tags(&conn).map_err(|_| "INTERNAL_ERROR: tag query failed".to_string())
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
        .map_err(|_| "INTERNAL_ERROR: tag insert failed".to_string())?;
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
        .map_err(|_| "INTERNAL_ERROR: tag delete failed".to_string())
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
        .map_err(|_| "INTERNAL_ERROR: book tags query failed".to_string())
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
        .map_err(|_| "INTERNAL_ERROR: tag relationship update failed".to_string())
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

fn map_series_write_error(operation: &str, error: SqlError) -> String {
    if matches!(
        error,
        SqlError::SqliteFailure(ref failure, _)
            if failure.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
    ) {
        return "VALIDATION_ERROR: series name already exists".to_string();
    }
    format!("INTERNAL_ERROR: series {operation} failed")
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
        .map_err(|_| "INTERNAL_ERROR: entity query failed".to_string())?
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
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{BookSeries, CreateSeriesInput, UpdateSeriesInput};
    use std::sync::Arc;

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

    fn insert_test_book(db: &Mutex<Connection>, id: &str) {
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO books VALUES (?1,?2,'[]','epub',NULL,?3,'desktop_path',1,2,NULL,'available',NULL,3,4)",
            rusqlite::params![id, id, format!("/{id}.epub")],
        )
        .unwrap();
    }

    #[test]
    fn list_series_books_reports_order_and_single_ownership() {
        let db = test_db();
        insert_test_book(&db, "b2");
        let first = create_series(
            &db,
            CreateSeriesInput {
                name: "First".into(),
            },
        )
        .unwrap();
        let second = create_series(
            &db,
            CreateSeriesInput {
                name: "Second".into(),
            },
        )
        .unwrap();

        for (book_id, volume_label, sort_order) in [("b", "II", 2), ("b2", "I", 1)] {
            set_book_series(
                &db,
                BookSeries {
                    book_id: book_id.into(),
                    series_id: first.id.clone(),
                    volume_label: volume_label.into(),
                    sort_order,
                },
            )
            .unwrap();
        }

        let assigned = list_series_books(&db, &first.id).unwrap();
        assert_eq!(assigned.len(), 2);
        assert_eq!(assigned[0].book_id, "b2");
        assert_eq!(assigned[0].volume_label, "I");
        assert_eq!(assigned[1].book_id, "b");

        set_book_series(
            &db,
            BookSeries {
                book_id: "b".into(),
                series_id: second.id.clone(),
                volume_label: "Moved".into(),
                sort_order: 3,
            },
        )
        .unwrap();

        assert_eq!(list_series_books(&db, &first.id).unwrap().len(), 1);
        let moved = list_series_books(&db, &second.id).unwrap();
        assert_eq!(moved.len(), 1);
        assert_eq!(moved[0].book_id, "b");
        assert_eq!(moved[0].volume_label, "Moved");

        let error = list_series_books(&db, "missing").unwrap_err();
        assert!(error.starts_with("SERIES_NOT_FOUND:"));
    }

    #[test]
    fn concurrent_series_creates_do_not_lose_rows() {
        let db = Arc::new(test_db());
        let handles: Vec<_> = (0..8)
            .map(|thread_index| {
                let db = db.clone();
                std::thread::spawn(move || {
                    for i in 0..25 {
                        create_series(
                            &db,
                            CreateSeriesInput {
                                name: format!("s-{thread_index}-{i}"),
                            },
                        )
                        .unwrap();
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
        assert_eq!(list_series(&db).unwrap().len(), 200);
    }

    #[test]
    fn failed_update_keeps_previous_series_name() {
        let db = test_db();
        let created = create_series(
            &db,
            CreateSeriesInput {
                name: "Original".into(),
            },
        )
        .unwrap();
        let err = update_series(
            &db,
            UpdateSeriesInput {
                id: created.id.clone(),
                name: "   ".into(),
            },
        )
        .unwrap_err();
        assert!(err.starts_with("VALIDATION_ERROR:"));
        assert_eq!(list_series(&db).unwrap()[0].name, "Original");
    }

    #[test]
    fn duplicate_series_names_are_validation_errors_and_preserve_rows() {
        let db = test_db();
        create_series(
            &db,
            CreateSeriesInput {
                name: "Alpha".into(),
            },
        )
        .unwrap();

        let create_error = create_series(
            &db,
            CreateSeriesInput {
                name: " alpha ".into(),
            },
        )
        .unwrap_err();
        assert!(
            create_error.starts_with("VALIDATION_ERROR:"),
            "unexpected error: {create_error}"
        );

        let beta = create_series(
            &db,
            CreateSeriesInput {
                name: "Beta".into(),
            },
        )
        .unwrap();
        let update_error = update_series(
            &db,
            UpdateSeriesInput {
                id: beta.id,
                name: "ALPHA".into(),
            },
        )
        .unwrap_err();
        assert!(
            update_error.starts_with("VALIDATION_ERROR:"),
            "unexpected error: {update_error}"
        );

        let names: Vec<_> = list_series(&db)
            .unwrap()
            .into_iter()
            .map(|series| series.name)
            .collect();
        assert_eq!(names, ["Alpha", "Beta"]);
    }

    #[test]
    fn series_crud_preserves_created_at_and_delete_keeps_book() {
        let db = test_db();
        let created = create_series(
            &db,
            CreateSeriesInput {
                name: "  Original  ".into(),
            },
        )
        .unwrap();
        assert_eq!(created.name, "Original");

        std::thread::sleep(std::time::Duration::from_millis(2));
        let updated = update_series(
            &db,
            UpdateSeriesInput {
                id: created.id.clone(),
                name: "  Renamed  ".into(),
            },
        )
        .unwrap();
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.created_at, created.created_at);
        assert!(updated.updated_at >= created.updated_at);

        set_book_series(
            &db,
            BookSeries {
                book_id: "b".into(),
                series_id: updated.id.clone(),
                volume_label: "1".into(),
                sort_order: 1,
            },
        )
        .unwrap();
        delete_series(&db, &updated.id).unwrap();
        assert!(list_series(&db).unwrap().is_empty());

        let conn = db.lock().unwrap();
        let book_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM books WHERE id='b'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let assignment_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM book_series", [], |row| row.get(0))
            .unwrap();
        assert_eq!(book_count, 1);
        assert_eq!(assignment_count, 0);
    }

    #[test]
    fn volume_label_limit_preserves_existing_assignment() {
        let db = test_db();
        let series = create_series(&db, CreateSeriesInput { name: "S".into() }).unwrap();
        let accepted_label = "v".repeat(200);
        set_book_series(
            &db,
            BookSeries {
                book_id: "b".into(),
                series_id: series.id.clone(),
                volume_label: format!("  {accepted_label}  "),
                sort_order: 1,
            },
        )
        .unwrap();

        let error = set_book_series(
            &db,
            BookSeries {
                book_id: "b".into(),
                series_id: series.id.clone(),
                volume_label: "v".repeat(201),
                sort_order: 2,
            },
        )
        .unwrap_err();
        assert!(error.starts_with("VALIDATION_ERROR:"));

        let assignment = list_series_books(&db, &series.id).unwrap().remove(0);
        assert_eq!(assignment.volume_label, accepted_label);
        assert_eq!(assignment.sort_order, 1);
    }

    #[test]
    fn reorder_rolls_back_when_a_late_update_fails() {
        let db = test_db();
        insert_test_book(&db, "b2");
        let series = create_series(&db, CreateSeriesInput { name: "S".into() }).unwrap();
        for (book_id, sort_order) in [("b", 1), ("b2", 2)] {
            set_book_series(
                &db,
                BookSeries {
                    book_id: book_id.into(),
                    series_id: series.id.clone(),
                    volume_label: book_id.into(),
                    sort_order,
                },
            )
            .unwrap();
        }
        {
            let conn = db.lock().unwrap();
            conn.execute_batch(
                "CREATE TRIGGER fail_second_reorder
                 BEFORE UPDATE OF sort_order ON book_series
                 WHEN OLD.book_id = 'b2' AND NEW.sort_order = 10
                 BEGIN
                   SELECT RAISE(ABORT, 'forced late reorder failure');
                 END;",
            )
            .unwrap();
        }

        let error = reorder_series_books(
            &db,
            &series.id,
            vec![
                SeriesBookPosition {
                    book_id: "b".into(),
                    sort_order: 20,
                },
                SeriesBookPosition {
                    book_id: "b2".into(),
                    sort_order: 10,
                },
            ],
        )
        .unwrap_err();
        assert!(error.starts_with("INTERNAL_ERROR:"));

        let positions: Vec<_> = list_series_books(&db, &series.id)
            .unwrap()
            .into_iter()
            .map(|assignment| (assignment.book_id, assignment.sort_order))
            .collect();
        assert_eq!(positions, [("b".into(), 1), ("b2".into(), 2)]);
    }

    #[test]
    fn reorder_rejects_duplicate_and_outside_ids_without_changes() {
        let db = test_db();
        insert_test_book(&db, "b2");
        let series = create_series(&db, CreateSeriesInput { name: "S".into() }).unwrap();
        set_book_series(
            &db,
            BookSeries {
                book_id: "b".into(),
                series_id: series.id.clone(),
                volume_label: "I".into(),
                sort_order: 1,
            },
        )
        .unwrap();

        let duplicate_error = reorder_series_books(
            &db,
            &series.id,
            vec![
                SeriesBookPosition {
                    book_id: "b".into(),
                    sort_order: 2,
                },
                SeriesBookPosition {
                    book_id: "b".into(),
                    sort_order: 3,
                },
            ],
        )
        .unwrap_err();
        assert!(duplicate_error.starts_with("VALIDATION_ERROR:"));

        let outside_error = reorder_series_books(
            &db,
            &series.id,
            vec![SeriesBookPosition {
                book_id: "b2".into(),
                sort_order: 4,
            }],
        )
        .unwrap_err();
        assert!(outside_error.starts_with("VALIDATION_ERROR:"));

        let assignment = list_series_books(&db, &series.id).unwrap().remove(0);
        assert_eq!(assignment.book_id, "b");
        assert_eq!(assignment.sort_order, 1);
    }

    #[test]
    fn delete_missing_series_returns_stable_not_found() {
        let db = test_db();
        let err = delete_series(&db, "nope").unwrap_err();
        assert!(
            err.starts_with("SERIES_NOT_FOUND:"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn set_book_series_rejects_unknown_entities() {
        let db = test_db();
        let series = create_series(&db, CreateSeriesInput { name: "S".into() }).unwrap();
        let err = set_book_series(
            &db,
            BookSeries {
                book_id: "ghost".into(),
                series_id: series.id.clone(),
                volume_label: String::new(),
                sort_order: 0,
            },
        )
        .unwrap_err();
        assert!(err.starts_with("BOOK_NOT_FOUND:"));
        let err = set_book_series(
            &db,
            BookSeries {
                book_id: "b".into(),
                series_id: "ghost".into(),
                volume_label: String::new(),
                sort_order: 0,
            },
        )
        .unwrap_err();
        assert!(err.starts_with("SERIES_NOT_FOUND:"));
    }

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
