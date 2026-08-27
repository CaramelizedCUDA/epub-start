use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};

use super::repository::row_to_book;

pub struct ReadingBookSnapshot {
    pub recorded_book_id: String,
    pub book_title: String,
    pub book_authors_json: String,
    pub series_id: Option<String>,
    pub series_name: Option<String>,
    pub series_volume_label: Option<String>,
}

pub struct NewReadingActivity<'a> {
    pub session_id: &'a str,
    pub segment_id: &'a str,
    pub snapshot: &'a ReadingBookSnapshot,
    pub local_date: &'a str,
    pub utc_offset_minutes: i64,
    pub now: i64,
}

pub struct ReadingActivityRecord {
    pub state: String,
    pub last_observed_at: i64,
    pub last_sequence: i64,
}

pub struct OpenReadingSegment {
    pub id: String,
    pub local_date: String,
    pub utc_offset_minutes: i64,
    pub confirmed_until_at: i64,
}

pub struct ExistingSegmentUpdate {
    pub segment_id: String,
    pub confirmed_until_at: i64,
    pub close: bool,
}

pub struct NewPresenceSegment {
    pub id: String,
    pub local_date: String,
    pub utc_offset_minutes: i64,
    pub started_at: i64,
    pub confirmed_until_at: i64,
    pub close: bool,
}

pub struct ReadingObservationUpdate<'a> {
    pub session_id: &'a str,
    pub previous_sequence: i64,
    pub sequence: i64,
    pub state: &'a str,
    pub observed_at: i64,
    pub ended_at: Option<i64>,
    pub existing_segment: Option<ExistingSegmentUpdate>,
    pub new_segment: Option<NewPresenceSegment>,
}

pub struct ReadingInsightBook {
    pub book: super::models::Book,
    pub progress: Option<super::models::ReadingProgress>,
    pub last_read_at: Option<i64>,
    pub series_id: Option<String>,
    pub series_name: Option<String>,
    pub sort_order: Option<i64>,
}

pub struct ReadingInsightSegment {
    pub local_date: String,
    pub utc_offset_minutes: i64,
    pub started_at: i64,
    pub confirmed_until_at: i64,
    pub recorded_book_id: String,
    pub series_id_snapshot: Option<String>,
}

pub fn list_reading_insight_books(conn: &Connection) -> SqliteResult<Vec<ReadingInsightBook>> {
    let mut stmt = conn.prepare(
        "SELECT b.*,rp.book_id AS progress_book_id,rp.location_cfi,rp.progression,rp.updated_at AS progress_updated_at,
                brs.last_read_at,bs.series_id,s.name AS series_name,bs.sort_order
         FROM books b
         LEFT JOIN reading_progress rp ON rp.book_id=b.id
         LEFT JOIN book_reading_state brs ON brs.book_id=b.id
         LEFT JOIN book_series bs ON bs.book_id=b.id
         LEFT JOIN series s ON s.id=bs.series_id
         ORDER BY b.updated_at DESC,b.title COLLATE NOCASE,b.id",
    )?;
    let rows = stmt.query_map([], |row| {
        let book = row_to_book(row)?;
        let progress_book_id: Option<String> = row.get("progress_book_id")?;
        let progress = if let Some(book_id) = progress_book_id {
            Some(super::models::ReadingProgress {
                book_id,
                location_cfi: row.get("location_cfi")?,
                progression: row.get("progression")?,
                updated_at: row.get("progress_updated_at")?,
            })
        } else {
            None
        };
        Ok(ReadingInsightBook {
            book,
            progress,
            last_read_at: row.get("last_read_at")?,
            series_id: row.get("series_id")?,
            series_name: row.get("series_name")?,
            sort_order: row.get("sort_order")?,
        })
    })?;
    rows.collect()
}

pub fn list_reading_insight_segments(
    conn: &Connection,
    start_local_date: &str,
    end_local_date: &str,
) -> SqliteResult<Vec<ReadingInsightSegment>> {
    let mut stmt = conn.prepare(
        "SELECT p.local_date,p.utc_offset_minutes,p.started_at,p.confirmed_until_at,
                s.recorded_book_id,s.series_id_snapshot
         FROM reading_presence_segments p
         JOIN reading_activity_sessions s ON s.id=p.session_id
         WHERE p.local_date>=?1 AND p.local_date<=?2
           AND p.confirmed_until_at>p.started_at
         ORDER BY p.started_at,p.id",
    )?;
    let rows = stmt.query_map(params![start_local_date, end_local_date], |row| {
        Ok(ReadingInsightSegment {
            local_date: row.get(0)?,
            utc_offset_minutes: row.get(1)?,
            started_at: row.get(2)?,
            confirmed_until_at: row.get(3)?,
            recorded_book_id: row.get(4)?,
            series_id_snapshot: row.get(5)?,
        })
    })?;
    rows.collect()
}

#[derive(Clone, Copy)]
pub enum ReadingHistorySelector<'a> {
    Session(&'a str),
    Date(&'a str),
    Book(&'a str),
    All,
}

pub struct DeletedReadingHistory {
    pub sessions: i64,
    pub segments: i64,
}

pub fn delete_reading_history(
    conn: &Connection,
    selector: ReadingHistorySelector<'_>,
) -> SqliteResult<DeletedReadingHistory> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> SqliteResult<DeletedReadingHistory> {
        let (session_count, segment_count) = match selector {
            ReadingHistorySelector::Session(session_id) => (
                conn.query_row(
                    "SELECT COUNT(*) FROM reading_activity_sessions WHERE id=?1",
                    [session_id],
                    |row| row.get(0),
                )?,
                conn.query_row(
                    "SELECT COUNT(*) FROM reading_presence_segments WHERE session_id=?1",
                    [session_id],
                    |row| row.get(0),
                )?,
            ),
            ReadingHistorySelector::Date(local_date) => (
                0,
                conn.query_row(
                    "SELECT COUNT(*) FROM reading_presence_segments WHERE local_date=?1",
                    [local_date],
                    |row| row.get(0),
                )?,
            ),
            ReadingHistorySelector::Book(recorded_book_id) => (
                conn.query_row(
                    "SELECT COUNT(*) FROM reading_activity_sessions WHERE recorded_book_id=?1",
                    [recorded_book_id],
                    |row| row.get(0),
                )?,
                conn.query_row(
                    "SELECT COUNT(*) FROM reading_presence_segments p
                     JOIN reading_activity_sessions s ON s.id=p.session_id
                     WHERE s.recorded_book_id=?1",
                    [recorded_book_id],
                    |row| row.get(0),
                )?,
            ),
            ReadingHistorySelector::All => (
                conn.query_row(
                    "SELECT COUNT(*) FROM reading_activity_sessions",
                    [],
                    |row| row.get(0),
                )?,
                conn.query_row(
                    "SELECT COUNT(*) FROM reading_presence_segments",
                    [],
                    |row| row.get(0),
                )?,
            ),
        };

        match selector {
            ReadingHistorySelector::Session(session_id) => {
                conn.execute(
                    "DELETE FROM reading_activity_sessions WHERE id=?1",
                    [session_id],
                )?;
            }
            ReadingHistorySelector::Date(local_date) => {
                conn.execute(
                    "DELETE FROM reading_presence_segments WHERE local_date=?1",
                    [local_date],
                )?;
                conn.execute(
                    "DELETE FROM reading_activity_sessions
                     WHERE NOT EXISTS (
                       SELECT 1 FROM reading_presence_segments p WHERE p.session_id=reading_activity_sessions.id
                     )",
                    [],
                )?;
            }
            ReadingHistorySelector::Book(recorded_book_id) => {
                conn.execute(
                    "DELETE FROM reading_activity_sessions WHERE recorded_book_id=?1",
                    [recorded_book_id],
                )?;
            }
            ReadingHistorySelector::All => {
                conn.execute("DELETE FROM reading_activity_sessions", [])?;
            }
        }
        Ok(DeletedReadingHistory {
            sessions: match selector {
                ReadingHistorySelector::Date(_) => {
                    session_count
                        + conn.query_row("SELECT changes()", [], |row| row.get::<_, i64>(0))?
                }
                _ => session_count,
            },
            segments: segment_count,
        })
    })();
    match result {
        Ok(counts) => {
            conn.execute_batch("COMMIT;")?;
            Ok(counts)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

pub fn find_book_snapshot(
    conn: &Connection,
    book_id: &str,
) -> SqliteResult<Option<ReadingBookSnapshot>> {
    conn.query_row(
        "SELECT b.id,b.title,b.authors_json,bs.series_id,s.name,bs.volume_label
         FROM books b
         LEFT JOIN book_series bs ON bs.book_id=b.id
         LEFT JOIN series s ON s.id=bs.series_id
         WHERE b.id=?1",
        [book_id],
        |row| {
            Ok(ReadingBookSnapshot {
                recorded_book_id: row.get(0)?,
                book_title: row.get(1)?,
                book_authors_json: row.get(2)?,
                series_id: row.get(3)?,
                series_name: row.get(4)?,
                series_volume_label: row.get(5)?,
            })
        },
    )
    .optional()
}

pub fn insert_reading_activity(
    conn: &Connection,
    activity: &NewReadingActivity<'_>,
) -> SqliteResult<()> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> SqliteResult<()> {
        recover_interrupted_reading_activities_in_transaction(conn)?;
        conn.execute(
            "INSERT INTO reading_activity_sessions (
               id,recorded_book_id,book_id,book_title,book_authors_json,
               series_id_snapshot,series_name_snapshot,series_volume_label_snapshot,
               state,started_at,last_observed_at,last_sequence,ended_at
             ) VALUES (?1,?2,?2,?3,?4,?5,?6,?7,'visible',?8,?8,0,NULL)",
            params![
                activity.session_id,
                activity.snapshot.recorded_book_id,
                activity.snapshot.book_title,
                activity.snapshot.book_authors_json,
                activity.snapshot.series_id,
                activity.snapshot.series_name,
                activity.snapshot.series_volume_label,
                activity.now,
            ],
        )?;
        conn.execute(
            "INSERT INTO reading_presence_segments (
               id,session_id,local_date,utc_offset_minutes,started_at,confirmed_until_at,closed_at
             ) VALUES (?1,?2,?3,?4,?5,?5,NULL)",
            params![
                activity.segment_id,
                activity.session_id,
                activity.local_date,
                activity.utc_offset_minutes,
                activity.now,
            ],
        )?;
        conn.execute(
            "INSERT INTO book_reading_state (book_id,started_at,last_read_at)
             VALUES (?1,?2,?2)
             ON CONFLICT(book_id) DO UPDATE SET last_read_at=MAX(last_read_at,excluded.last_read_at)",
            params![activity.snapshot.recorded_book_id, activity.now],
        )?;
        Ok(())
    })();
    finish_transaction(conn, result)
}

pub fn find_reading_activity(
    conn: &Connection,
    session_id: &str,
) -> SqliteResult<Option<ReadingActivityRecord>> {
    conn.query_row(
        "SELECT state,last_observed_at,last_sequence
         FROM reading_activity_sessions WHERE id=?1",
        [session_id],
        |row| {
            Ok(ReadingActivityRecord {
                state: row.get(0)?,
                last_observed_at: row.get(1)?,
                last_sequence: row.get(2)?,
            })
        },
    )
    .optional()
}

pub fn find_open_reading_segment(
    conn: &Connection,
    session_id: &str,
) -> SqliteResult<Option<OpenReadingSegment>> {
    conn.query_row(
        "SELECT id,local_date,utc_offset_minutes,confirmed_until_at
         FROM reading_presence_segments
         WHERE session_id=?1 AND closed_at IS NULL",
        [session_id],
        |row| {
            Ok(OpenReadingSegment {
                id: row.get(0)?,
                local_date: row.get(1)?,
                utc_offset_minutes: row.get(2)?,
                confirmed_until_at: row.get(3)?,
            })
        },
    )
    .optional()
}

pub fn apply_reading_observation(
    conn: &Connection,
    update: ReadingObservationUpdate<'_>,
) -> SqliteResult<()> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> SqliteResult<()> {
        let changed = conn.execute(
            "UPDATE reading_activity_sessions
             SET state=?1,last_observed_at=?2,last_sequence=?3,ended_at=?4
             WHERE id=?5 AND last_sequence=?6 AND state!='ended'",
            params![
                update.state,
                update.observed_at,
                update.sequence,
                update.ended_at,
                update.session_id,
                update.previous_sequence,
            ],
        )?;
        if changed != 1 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        if let Some(existing) = update.existing_segment {
            conn.execute(
                "UPDATE reading_presence_segments
                 SET confirmed_until_at=?1,closed_at=CASE WHEN ?2 THEN ?1 ELSE NULL END
                 WHERE id=?3 AND session_id=?4 AND closed_at IS NULL",
                params![
                    existing.confirmed_until_at,
                    existing.close,
                    existing.segment_id,
                    update.session_id,
                ],
            )?;
        }
        if let Some(segment) = update.new_segment {
            conn.execute(
                "INSERT INTO reading_presence_segments (
                   id,session_id,local_date,utc_offset_minutes,started_at,confirmed_until_at,closed_at
                 ) VALUES (?1,?2,?3,?4,?5,?6,CASE WHEN ?7 THEN ?6 ELSE NULL END)",
                params![
                    segment.id,
                    update.session_id,
                    segment.local_date,
                    segment.utc_offset_minutes,
                    segment.started_at,
                    segment.confirmed_until_at,
                    segment.close,
                ],
            )?;
        }
        conn.execute(
            "INSERT INTO book_reading_state (book_id,started_at,last_read_at)
             SELECT book_id,?2,?2 FROM reading_activity_sessions
             WHERE id=?1 AND book_id IS NOT NULL
             ON CONFLICT(book_id) DO UPDATE SET last_read_at=MAX(last_read_at,excluded.last_read_at)",
            params![update.session_id, update.observed_at],
        )?;
        Ok(())
    })();
    finish_transaction(conn, result)
}

pub fn recover_interrupted_reading_activities(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = recover_interrupted_reading_activities_in_transaction(conn);
    finish_transaction(conn, result)
}

fn recover_interrupted_reading_activities_in_transaction(conn: &Connection) -> SqliteResult<()> {
    conn.execute(
        "UPDATE reading_presence_segments
         SET closed_at=confirmed_until_at
         WHERE closed_at IS NULL",
        [],
    )?;
    conn.execute(
        "UPDATE reading_activity_sessions
         SET state='ended',ended_at=last_observed_at
         WHERE state!='ended'",
        [],
    )?;
    Ok(())
}

fn finish_transaction(conn: &Connection, result: SqliteResult<()>) -> SqliteResult<()> {
    match result {
        Ok(()) => conn.execute_batch("COMMIT;"),
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}
