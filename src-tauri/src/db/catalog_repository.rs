use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};

use super::models::{BookSeries, BookTag, Series, SeriesBookPosition, Tag, TagGroup};

pub fn list_series(conn: &Connection) -> SqliteResult<Vec<Series>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at, updated_at FROM series ORDER BY name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], row_to_series)?;
    rows.collect()
}

pub fn find_series(conn: &Connection, series_id: &str) -> SqliteResult<Option<Series>> {
    conn.query_row(
        "SELECT id, name, created_at, updated_at FROM series WHERE id=?1",
        params![series_id],
        row_to_series,
    )
    .optional()
}

pub fn insert_series(conn: &Connection, series: &Series) -> SqliteResult<()> {
    conn.execute(
        "INSERT INTO series (id, name, created_at, updated_at) VALUES (?1,?2,?3,?4)",
        params![series.id, series.name, series.created_at, series.updated_at],
    )?;
    Ok(())
}

pub fn update_series(conn: &Connection, series: &Series) -> SqliteResult<()> {
    conn.execute(
        "UPDATE series SET name=?1, updated_at=?2 WHERE id=?3",
        params![series.name, series.updated_at, series.id],
    )?;
    Ok(())
}

pub fn delete_series(conn: &Connection, series_id: &str) -> SqliteResult<()> {
    conn.execute("DELETE FROM series WHERE id=?1", params![series_id])?;
    Ok(())
}

pub fn set_book_series(conn: &Connection, assignment: &BookSeries) -> SqliteResult<()> {
    conn.execute(
        "INSERT INTO book_series (book_id, series_id, volume_label, sort_order) VALUES (?1,?2,?3,?4) ON CONFLICT(book_id) DO UPDATE SET series_id=excluded.series_id, volume_label=excluded.volume_label, sort_order=excluded.sort_order",
        params![assignment.book_id, assignment.series_id, assignment.volume_label, assignment.sort_order],
    )?;
    Ok(())
}

pub fn clear_book_series(conn: &Connection, book_id: &str) -> SqliteResult<()> {
    conn.execute("DELETE FROM book_series WHERE book_id=?1", params![book_id])?;
    Ok(())
}

pub fn reorder_series_books(
    conn: &Connection,
    series_id: &str,
    positions: &[SeriesBookPosition],
) -> SqliteResult<()> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> SqliteResult<()> {
        for position in positions {
            conn.execute(
                "UPDATE book_series SET sort_order=?1 WHERE series_id=?2 AND book_id=?3",
                params![position.sort_order, series_id, position.book_id],
            )?;
        }
        Ok(())
    })();
    finish_transaction(conn, result)
}

pub fn list_book_series(conn: &Connection, series_id: &str) -> SqliteResult<Vec<BookSeries>> {
    let mut stmt = conn.prepare("SELECT book_id, series_id, volume_label, sort_order FROM book_series WHERE series_id=?1 ORDER BY sort_order, book_id")?;
    let rows = stmt.query_map(params![series_id], row_to_book_series)?;
    rows.collect()
}

pub fn list_tag_groups(conn: &Connection) -> SqliteResult<Vec<TagGroup>> {
    let mut stmt = conn.prepare("SELECT id, name, sort_order, created_at, updated_at FROM tag_groups ORDER BY sort_order, name COLLATE NOCASE")?;
    let rows = stmt.query_map([], row_to_tag_group)?;
    rows.collect()
}

pub fn find_tag_group(conn: &Connection, group_id: &str) -> SqliteResult<Option<TagGroup>> {
    conn.query_row(
        "SELECT id, name, sort_order, created_at, updated_at FROM tag_groups WHERE id=?1",
        params![group_id],
        row_to_tag_group,
    )
    .optional()
}

pub fn insert_tag_group(conn: &Connection, group: &TagGroup) -> SqliteResult<()> {
    conn.execute("INSERT INTO tag_groups (id, name, sort_order, created_at, updated_at) VALUES (?1,?2,?3,?4,?5)", params![group.id, group.name, group.sort_order, group.created_at, group.updated_at])?;
    Ok(())
}

pub fn update_tag_group(conn: &Connection, group: &TagGroup) -> SqliteResult<()> {
    conn.execute(
        "UPDATE tag_groups SET name=?1, sort_order=?2, updated_at=?3 WHERE id=?4",
        params![group.name, group.sort_order, group.updated_at, group.id],
    )?;
    Ok(())
}

pub fn delete_tag_group(conn: &Connection, group_id: &str) -> SqliteResult<()> {
    conn.execute("DELETE FROM tag_groups WHERE id=?1", params![group_id])?;
    Ok(())
}

pub fn list_tags(conn: &Connection) -> SqliteResult<Vec<Tag>> {
    let mut stmt = conn.prepare("SELECT id, group_id, name, color, created_at, updated_at FROM tags ORDER BY name COLLATE NOCASE")?;
    let rows = stmt.query_map([], row_to_tag)?;
    rows.collect()
}

pub fn find_tag(conn: &Connection, tag_id: &str) -> SqliteResult<Option<Tag>> {
    conn.query_row(
        "SELECT id, group_id, name, color, created_at, updated_at FROM tags WHERE id=?1",
        params![tag_id],
        row_to_tag,
    )
    .optional()
}

pub fn insert_tag(conn: &Connection, tag: &Tag) -> SqliteResult<()> {
    conn.execute("INSERT INTO tags (id, group_id, name, color, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6)", params![tag.id, tag.group_id, tag.name, tag.color, tag.created_at, tag.updated_at])?;
    Ok(())
}

pub fn update_tag(conn: &Connection, tag: &Tag) -> SqliteResult<()> {
    conn.execute(
        "UPDATE tags SET group_id=?1, name=?2, color=?3, updated_at=?4 WHERE id=?5",
        params![tag.group_id, tag.name, tag.color, tag.updated_at, tag.id],
    )?;
    Ok(())
}

pub fn delete_tag(conn: &Connection, tag_id: &str) -> SqliteResult<()> {
    conn.execute("DELETE FROM tags WHERE id=?1", params![tag_id])?;
    Ok(())
}

pub fn replace_book_tags(conn: &Connection, book_id: &str, tag_ids: &[String]) -> SqliteResult<()> {
    replace_tags(conn, "book_tags", "book_id", book_id, tag_ids)
}

pub fn replace_series_tags(
    conn: &Connection,
    series_id: &str,
    tag_ids: &[String],
) -> SqliteResult<()> {
    replace_tags(conn, "series_tags", "series_id", series_id, tag_ids)
}

pub fn list_book_tags(conn: &Connection, book_id: &str) -> SqliteResult<Vec<BookTag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.group_id, t.name, t.color, t.created_at, t.updated_at, inherited FROM (
           SELECT tag_id, 0 AS inherited FROM book_tags WHERE book_id=?1
           UNION
           SELECT st.tag_id, 1 AS inherited
             FROM series_tags st
             JOIN book_series bs ON bs.series_id=st.series_id
            WHERE bs.book_id=?1
              AND NOT EXISTS (
                SELECT 1 FROM book_tags bt WHERE bt.book_id=?1 AND bt.tag_id=st.tag_id
              )
         ) relations JOIN tags t ON t.id=relations.tag_id ORDER BY t.name COLLATE NOCASE, inherited",
    )?;
    let rows = stmt.query_map(params![book_id], |row| {
        Ok(BookTag {
            tag: Tag {
                id: row.get(0)?,
                group_id: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            },
            inherited_from_series: row.get::<_, i64>(6)? != 0,
        })
    })?;
    rows.collect()
}

pub fn entity_exists(conn: &Connection, table: &str, id: &str) -> SqliteResult<bool> {
    let sql = match table {
        "books" => "SELECT 1 FROM books WHERE id=?1",
        "series" => "SELECT 1 FROM series WHERE id=?1",
        "tags" => "SELECT 1 FROM tags WHERE id=?1",
        "tag_groups" => "SELECT 1 FROM tag_groups WHERE id=?1",
        _ => return Ok(false),
    };
    conn.query_row(sql, params![id], |_| Ok(()))
        .optional()
        .map(|value| value.is_some())
}

fn replace_tags(
    conn: &Connection,
    table: &str,
    owner_column: &str,
    owner_id: &str,
    tag_ids: &[String],
) -> SqliteResult<()> {
    let (delete_sql, insert_sql) = match (table, owner_column) {
        ("book_tags", "book_id") => (
            "DELETE FROM book_tags WHERE book_id=?1",
            "INSERT INTO book_tags (book_id, tag_id) VALUES (?1,?2)",
        ),
        ("series_tags", "series_id") => (
            "DELETE FROM series_tags WHERE series_id=?1",
            "INSERT INTO series_tags (series_id, tag_id) VALUES (?1,?2)",
        ),
        _ => return Ok(()),
    };
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> SqliteResult<()> {
        conn.execute(delete_sql, params![owner_id])?;
        for tag_id in tag_ids {
            conn.execute(insert_sql, params![owner_id, tag_id])?;
        }
        Ok(())
    })();
    finish_transaction(conn, result)
}

fn finish_transaction(conn: &Connection, result: SqliteResult<()>) -> SqliteResult<()> {
    match result {
        Ok(()) => match conn.execute_batch("COMMIT;") {
            Ok(()) => Ok(()),
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK;");
                Err(error)
            }
        },
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

fn row_to_series(row: &rusqlite::Row) -> SqliteResult<Series> {
    Ok(Series {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

fn row_to_book_series(row: &rusqlite::Row) -> SqliteResult<BookSeries> {
    Ok(BookSeries {
        book_id: row.get(0)?,
        series_id: row.get(1)?,
        volume_label: row.get(2)?,
        sort_order: row.get(3)?,
    })
}

fn row_to_tag_group(row: &rusqlite::Row) -> SqliteResult<TagGroup> {
    Ok(TagGroup {
        id: row.get(0)?,
        name: row.get(1)?,
        sort_order: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn row_to_tag(row: &rusqlite::Row) -> SqliteResult<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        group_id: row.get(1)?,
        name: row.get(2)?,
        color: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::db::models::{Book, BookFormat, BookStatus, SourceKind};
    use crate::db::repository;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run_migrations(&conn).unwrap();
        conn
    }

    fn insert_book(conn: &Connection) {
        repository::insert_book(
            conn,
            &Book {
                id: "book".into(),
                title: "Book".into(),
                authors: Vec::new(),
                format: BookFormat::Epub,
                cover_cache_path: None,
                source_locator: "/book.epub".into(),
                source_kind: SourceKind::DesktopPath,
                file_size_bytes: 1,
                last_modified_ts: 1,
                package_identifier: None,
                status: BookStatus::Available,
                status_detail: None,
                added_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
    }

    #[test]
    fn inherited_and_direct_tags_remain_distinguishable() {
        let conn = database();
        insert_book(&conn);
        insert_series(
            &conn,
            &Series {
                id: "series".into(),
                name: "Series".into(),
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
        set_book_series(
            &conn,
            &BookSeries {
                book_id: "book".into(),
                series_id: "series".into(),
                volume_label: "1".into(),
                sort_order: 1,
            },
        )
        .unwrap();
        for id in ["direct", "inherited"] {
            insert_tag(
                &conn,
                &Tag {
                    id: id.into(),
                    group_id: None,
                    name: id.into(),
                    color: "#112233".into(),
                    created_at: 1,
                    updated_at: 1,
                },
            )
            .unwrap();
        }
        replace_book_tags(&conn, "book", &["direct".into()]).unwrap();
        replace_series_tags(&conn, "series", &["inherited".into()]).unwrap();
        let tags = list_book_tags(&conn, "book").unwrap();
        assert_eq!(tags.len(), 2);
        assert!(tags
            .iter()
            .any(|value| value.tag.id == "direct" && !value.inherited_from_series));
        assert!(tags
            .iter()
            .any(|value| value.tag.id == "inherited" && value.inherited_from_series));
    }

    #[test]
    fn deleting_group_ungroups_tags_without_deleting_books() {
        let conn = database();
        insert_book(&conn);
        insert_tag_group(
            &conn,
            &TagGroup {
                id: "group".into(),
                name: "Group".into(),
                sort_order: 0,
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
        insert_tag(
            &conn,
            &Tag {
                id: "tag".into(),
                group_id: Some("group".into()),
                name: "Tag".into(),
                color: "#112233".into(),
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
        replace_book_tags(&conn, "book", &["tag".into()]).unwrap();
        delete_tag_group(&conn, "group").unwrap();
        assert_eq!(list_tags(&conn).unwrap()[0].group_id, None);
        assert!(repository::find_book_by_id(&conn, "book")
            .unwrap()
            .is_some());
    }

    #[test]
    fn failed_relationship_replace_rolls_back() {
        let conn = database();
        insert_book(&conn);
        insert_tag(
            &conn,
            &Tag {
                id: "valid".into(),
                group_id: None,
                name: "Valid".into(),
                color: "#112233".into(),
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
        replace_book_tags(&conn, "book", &["valid".into()]).unwrap();
        assert!(replace_book_tags(&conn, "book", &["missing".into()]).is_err());
        let tags = list_book_tags(&conn, "book").unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].tag.id, "valid");
    }

    #[test]
    fn assigning_another_series_replaces_previous_ownership() {
        let conn = database();
        insert_book(&conn);
        for id in ["first", "second"] {
            insert_series(
                &conn,
                &Series {
                    id: id.into(),
                    name: id.into(),
                    created_at: 1,
                    updated_at: 1,
                },
            )
            .unwrap();
        }
        for series_id in ["first", "second"] {
            set_book_series(
                &conn,
                &BookSeries {
                    book_id: "book".into(),
                    series_id: series_id.into(),
                    volume_label: String::new(),
                    sort_order: 0,
                },
            )
            .unwrap();
        }
        assert!(list_book_series(&conn, "first").unwrap().is_empty());
        assert_eq!(list_book_series(&conn, "second").unwrap().len(), 1);
    }

    #[test]
    fn finish_transaction_rolls_back_and_releases_on_error() {
        let conn = database();
        conn.execute_batch("BEGIN IMMEDIATE;").unwrap();
        // 事务内先做一次成功写入。
        insert_series(
            &conn,
            &Series {
                id: "doomed".into(),
                name: "Doomed".into(),
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();

        // 模拟中途失败：错误分支必须回滚并结束事务。
        let outcome = finish_transaction(&conn, Err(rusqlite::Error::ExecuteReturnedResults));
        assert!(outcome.is_err());

        // 事务已结束（回滚）：能立即开启新事务。若实现漏掉 ROLLBACK，
        // 这里会报 "cannot start a transaction within a transaction"。
        conn.execute_batch("BEGIN IMMEDIATE;").unwrap();
        conn.execute_batch("ROLLBACK;").unwrap();
        // 回滚后 "doomed" 行不存在。
        assert!(find_series(&conn, "doomed").unwrap().is_none());
    }

    #[test]
    fn finish_transaction_rolls_back_and_releases_when_commit_fails() {
        let conn = database();
        conn.execute_batch(
            "CREATE TABLE deferred_parent (id INTEGER PRIMARY KEY);
             CREATE TABLE deferred_child (
               parent_id INTEGER REFERENCES deferred_parent(id) DEFERRABLE INITIALLY DEFERRED
             );
             BEGIN IMMEDIATE;
             INSERT INTO deferred_child (parent_id) VALUES (1);",
        )
        .unwrap();

        let outcome = finish_transaction(&conn, Ok(()));
        assert!(outcome.is_err());

        conn.execute_batch("BEGIN IMMEDIATE; ROLLBACK;").unwrap();
        let child_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM deferred_child", [], |row| row.get(0))
            .unwrap();
        assert_eq!(child_count, 0);
    }

    #[test]
    fn reorder_updates_requested_positions() {
        let conn = database();
        for (id, locator) in [("book", "/book.epub"), ("book-2", "/book-2.epub")] {
            repository::insert_book(
                &conn,
                &Book {
                    id: id.into(),
                    title: id.into(),
                    authors: Vec::new(),
                    format: BookFormat::Epub,
                    cover_cache_path: None,
                    source_locator: locator.into(),
                    source_kind: SourceKind::DesktopPath,
                    file_size_bytes: 1,
                    last_modified_ts: 1,
                    package_identifier: None,
                    status: BookStatus::Available,
                    status_detail: None,
                    added_at: 1,
                    updated_at: 1,
                },
            )
            .unwrap();
        }
        insert_series(
            &conn,
            &Series {
                id: "series".into(),
                name: "Series".into(),
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
        for (book_id, sort_order) in [("book", 1), ("book-2", 2)] {
            set_book_series(
                &conn,
                &BookSeries {
                    book_id: book_id.into(),
                    series_id: "series".into(),
                    volume_label: String::new(),
                    sort_order,
                },
            )
            .unwrap();
        }
        reorder_series_books(
            &conn,
            "series",
            &[
                SeriesBookPosition {
                    book_id: "book".into(),
                    sort_order: 2,
                },
                SeriesBookPosition {
                    book_id: "book-2".into(),
                    sort_order: 1,
                },
            ],
        )
        .unwrap();
        assert_eq!(
            list_book_series(&conn, "series").unwrap()[0].book_id,
            "book-2"
        );
    }

    #[test]
    fn deleting_series_or_tag_keeps_book_and_cleans_relationships() {
        let conn = database();
        insert_book(&conn);
        insert_series(
            &conn,
            &Series {
                id: "series".into(),
                name: "Series".into(),
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
        set_book_series(
            &conn,
            &BookSeries {
                book_id: "book".into(),
                series_id: "series".into(),
                volume_label: String::new(),
                sort_order: 0,
            },
        )
        .unwrap();
        insert_tag(
            &conn,
            &Tag {
                id: "tag".into(),
                group_id: None,
                name: "Tag".into(),
                color: "#112233".into(),
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
        replace_book_tags(&conn, "book", &["tag".into()]).unwrap();
        delete_series(&conn, "series").unwrap();
        delete_tag(&conn, "tag").unwrap();
        assert!(repository::find_book_by_id(&conn, "book")
            .unwrap()
            .is_some());
        assert!(list_book_tags(&conn, "book").unwrap().is_empty());
    }

    #[test]
    fn duplicate_direct_and_inherited_tag_prefers_direct_relation() {
        let conn = database();
        insert_book(&conn);
        insert_series(
            &conn,
            &Series {
                id: "series".into(),
                name: "Series".into(),
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
        set_book_series(
            &conn,
            &BookSeries {
                book_id: "book".into(),
                series_id: "series".into(),
                volume_label: String::new(),
                sort_order: 0,
            },
        )
        .unwrap();
        insert_tag(
            &conn,
            &Tag {
                id: "tag".into(),
                group_id: None,
                name: "Tag".into(),
                color: "#112233".into(),
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
        replace_book_tags(&conn, "book", &["tag".into()]).unwrap();
        replace_series_tags(&conn, "series", &["tag".into()]).unwrap();
        let tags = list_book_tags(&conn, "book").unwrap();
        assert_eq!(tags.len(), 1);
        assert!(!tags[0].inherited_from_series);
    }
}
