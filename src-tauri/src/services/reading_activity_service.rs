use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use uuid::Uuid;

use crate::db::models::{
    BookSummary, ContinueReadingItem, LibraryReadingOverview, ReadingActivityReceipt,
    ReadingActivityState, ReadingDurationBucket, ReadingDurationSummary, ReadingFootprint,
    ReadingFootprintDay, ReadingFootprintScope, ReadingFootprintTotals, ReadingFootprintYear,
    ReadingHistoryScope, ReadingOverviewPeriod, ReadingRecommendation, ReadingRecommendationReason,
    ReadingTimeBucketKind,
};
use crate::db::reading_activity_repository::{
    self, ExistingSegmentUpdate, NewPresenceSegment, NewReadingActivity, ReadingObservationUpdate,
};

const MIN_UTC_OFFSET_MINUTES: i64 = -840;
const MAX_UTC_OFFSET_MINUTES: i64 = 840;
const MILLIS_PER_MINUTE: i64 = 60_000;
const MILLIS_PER_DAY: i64 = 86_400_000;
const MAX_CONFIRMATION_GAP_MS: i64 = 90_000;

pub fn begin_reading_activity(
    db: &Mutex<Connection>,
    book_id: &str,
    utc_offset_minutes: i64,
) -> Result<ReadingActivityReceipt, String> {
    let conn = lock_db(db)?;
    begin_reading_activity_at(&conn, book_id, utc_offset_minutes, super::now_ms())
}

fn begin_reading_activity_at(
    conn: &Connection,
    book_id: &str,
    utc_offset_minutes: i64,
    now: i64,
) -> Result<ReadingActivityReceipt, String> {
    validate_offset(utc_offset_minutes)?;
    if now < 0 {
        return Err("VALIDATION_ERROR: timestamp must not be negative".to_string());
    }
    let snapshot = reading_activity_repository::find_book_snapshot(conn, book_id)
        .map_err(|_| "INTERNAL_ERROR: reading activity book query failed".to_string())?
        .ok_or_else(|| format!("BOOK_NOT_FOUND: no book with id {book_id}"))?;
    let session_id = Uuid::new_v4().to_string();
    let segment_id = Uuid::new_v4().to_string();
    let local_date = local_date_from_timestamp(now, utc_offset_minutes);
    reading_activity_repository::insert_reading_activity(
        conn,
        &NewReadingActivity {
            session_id: &session_id,
            segment_id: &segment_id,
            snapshot: &snapshot,
            local_date: &local_date,
            utc_offset_minutes,
            now,
        },
    )
    .map_err(|_| "INTERNAL_ERROR: reading activity insert failed".to_string())?;

    Ok(ReadingActivityReceipt {
        session_id,
        sequence: 0,
        state: ReadingActivityState::Visible,
        accepted_at: now,
    })
}

pub fn observe_reading_activity(
    db: &Mutex<Connection>,
    session_id: &str,
    sequence: i64,
    activity_state: ReadingActivityState,
    utc_offset_minutes: i64,
) -> Result<ReadingActivityReceipt, String> {
    let conn = lock_db(db)?;
    observe_reading_activity_at(
        &conn,
        session_id,
        sequence,
        activity_state,
        utc_offset_minutes,
        super::now_ms(),
    )
}

fn observe_reading_activity_at(
    conn: &Connection,
    session_id: &str,
    sequence: i64,
    activity_state: ReadingActivityState,
    utc_offset_minutes: i64,
    now: i64,
) -> Result<ReadingActivityReceipt, String> {
    validate_offset(utc_offset_minutes)?;
    if sequence < 1 {
        return Err("VALIDATION_ERROR: sequence must start at 1".to_string());
    }
    if now < 0 {
        return Err("VALIDATION_ERROR: timestamp must not be negative".to_string());
    }
    let activity = reading_activity_repository::find_reading_activity(conn, session_id)
        .map_err(|_| "INTERNAL_ERROR: reading activity query failed".to_string())?
        .ok_or_else(|| {
            format!("READING_ACTIVITY_NOT_FOUND: no reading activity with id {session_id}")
        })?;
    let stored_state = activity_state_from_db(&activity.state)?;
    if sequence == activity.last_sequence {
        return Ok(ReadingActivityReceipt {
            session_id: session_id.to_string(),
            sequence,
            state: stored_state,
            accepted_at: activity.last_observed_at,
        });
    }
    if sequence != activity.last_sequence + 1 {
        return Err(format!(
            "READING_ACTIVITY_CONFLICT: expected sequence {}, got {sequence}",
            activity.last_sequence + 1
        ));
    }
    if stored_state == ReadingActivityState::Ended {
        return Err("READING_ACTIVITY_CONFLICT: reading activity has ended".to_string());
    }

    let accepted_at = now.max(activity.last_observed_at);
    let open_segment = reading_activity_repository::find_open_reading_segment(conn, session_id)
        .map_err(|_| "INTERNAL_ERROR: reading segment query failed".to_string())?;
    let mut existing_update = None;
    let mut new_segment = None;
    if let Some(segment) = open_segment {
        let gap = accepted_at - activity.last_observed_at;
        let confirmable =
            gap <= MAX_CONFIRMATION_GAP_MS && segment.utc_offset_minutes == utc_offset_minutes;
        if confirmable {
            let accepted_local_date = local_date_from_timestamp(accepted_at, utc_offset_minutes);
            if accepted_local_date == segment.local_date {
                existing_update = Some(ExistingSegmentUpdate {
                    segment_id: segment.id,
                    confirmed_until_at: accepted_at,
                    close: activity_state != ReadingActivityState::Visible,
                });
            } else {
                let midnight =
                    next_local_midnight_utc(segment.confirmed_until_at, utc_offset_minutes);
                if midnight <= accepted_at {
                    existing_update = Some(ExistingSegmentUpdate {
                        segment_id: segment.id,
                        confirmed_until_at: midnight,
                        close: true,
                    });
                    new_segment = Some(NewPresenceSegment {
                        id: Uuid::new_v4().to_string(),
                        local_date: accepted_local_date,
                        utc_offset_minutes,
                        started_at: midnight,
                        confirmed_until_at: accepted_at,
                        close: activity_state != ReadingActivityState::Visible,
                    });
                } else {
                    existing_update = Some(close_without_extension(segment));
                    if activity_state == ReadingActivityState::Visible {
                        new_segment = Some(zero_length_segment(accepted_at, utc_offset_minutes));
                    }
                }
            }
        } else {
            existing_update = Some(close_without_extension(segment));
            if activity_state == ReadingActivityState::Visible {
                new_segment = Some(zero_length_segment(accepted_at, utc_offset_minutes));
            }
        }
    } else if activity_state == ReadingActivityState::Visible {
        new_segment = Some(zero_length_segment(accepted_at, utc_offset_minutes));
    }

    reading_activity_repository::apply_reading_observation(
        conn,
        ReadingObservationUpdate {
            session_id,
            previous_sequence: activity.last_sequence,
            sequence,
            state: activity_state_to_db(&activity_state),
            observed_at: accepted_at,
            ended_at: (activity_state == ReadingActivityState::Ended).then_some(accepted_at),
            existing_segment: existing_update,
            new_segment,
        },
    )
    .map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => {
            "READING_ACTIVITY_CONFLICT: reading activity changed concurrently".to_string()
        }
        _ => "INTERNAL_ERROR: reading observation update failed".to_string(),
    })?;

    Ok(ReadingActivityReceipt {
        session_id: session_id.to_string(),
        sequence,
        state: activity_state,
        accepted_at,
    })
}

pub fn get_library_reading_overview(
    db: &Mutex<Connection>,
    period: ReadingOverviewPeriod,
    anchor_local_date: &str,
    utc_offset_minutes: i64,
) -> Result<LibraryReadingOverview, String> {
    let conn = lock_db(db)?;
    get_library_reading_overview_at(
        &conn,
        period,
        anchor_local_date,
        utc_offset_minutes,
        super::now_ms(),
    )
}

fn get_library_reading_overview_at(
    conn: &Connection,
    period: ReadingOverviewPeriod,
    anchor_local_date: &str,
    utc_offset_minutes: i64,
    now: i64,
) -> Result<LibraryReadingOverview, String> {
    validate_offset(utc_offset_minutes)?;
    if now < 0 {
        return Err("VALIDATION_ERROR: timestamp must not be negative".to_string());
    }
    let anchor = parse_local_date(anchor_local_date)?;
    let (range_start_days, range_end_days, bucket_definitions) = overview_buckets(&period, anchor)?;
    let start_local_date = format_date(range_start_days);
    let end_local_date = format_date(range_end_days);
    let segments = reading_activity_repository::list_reading_insight_segments(
        conn,
        &start_local_date,
        &end_local_date,
    )
    .map_err(|_| "INTERNAL_ERROR: reading overview query failed".to_string())?;
    let mut bucket_values = vec![0_i64; bucket_definitions.len()];
    for segment in segments {
        if matches!(period, ReadingOverviewPeriod::Day) {
            accumulate_day_bucket_values(&segment, range_start_days, &mut bucket_values)?;
        } else {
            let segment_day = parse_local_date(&segment.local_date)?;
            let segment_days = days_from_civil(segment_day.0, segment_day.1, segment_day.2);
            let index = match period {
                ReadingOverviewPeriod::Week | ReadingOverviewPeriod::Month => {
                    segment_days - range_start_days
                }
                ReadingOverviewPeriod::Quarter => (segment_days - range_start_days).div_euclid(7),
                ReadingOverviewPeriod::Day => unreachable!(),
            };
            if index >= 0 && (index as usize) < bucket_values.len() {
                let duration = segment
                    .confirmed_until_at
                    .checked_sub(segment.started_at)
                    .ok_or_else(|| "INTERNAL_ERROR: reading duration overflow".to_string())?;
                bucket_values[index as usize] = checked_add(
                    bucket_values[index as usize],
                    duration,
                    "reading duration overflow",
                )?;
            }
        }
    }
    let total_reading_ms = bucket_values.iter().try_fold(0_i64, |total, value| {
        checked_add(total, *value, "reading duration overflow")
    })?;
    let buckets = bucket_definitions
        .into_iter()
        .zip(bucket_values)
        .map(|(definition, reading_ms)| ReadingDurationBucket {
            kind: definition.kind,
            start_local_date: definition.start_local_date,
            end_local_date: definition.end_local_date,
            hour: definition.hour,
            reading_ms,
        })
        .collect();

    let books = reading_activity_repository::list_reading_insight_books(conn)
        .map_err(|_| "INTERNAL_ERROR: reading overview book query failed".to_string())?;
    let continue_reading = books
        .iter()
        .filter(|candidate| candidate.last_read_at.is_some())
        .max_by(|left, right| {
            left.last_read_at
                .cmp(&right.last_read_at)
                .then_with(|| right.book.id.cmp(&left.book.id))
        })
        .map(|candidate| ContinueReadingItem {
            book: BookSummary::from(candidate.book.clone()),
            progress: candidate.progress.clone(),
            last_read_at: candidate.last_read_at.unwrap_or(0),
        });
    let recommendation_date =
        parse_local_date(&local_date_from_timestamp(now, utc_offset_minutes))?;
    let recommendations = build_offline_recommendations(
        books,
        continue_reading.as_ref().map(|item| item.book.id.as_str()),
        days_from_civil(
            recommendation_date.0,
            recommendation_date.1,
            recommendation_date.2,
        ),
        utc_offset_minutes,
    );

    Ok(LibraryReadingOverview {
        duration: ReadingDurationSummary {
            period,
            range_start_local_date: start_local_date,
            range_end_local_date: end_local_date,
            total_reading_ms,
            buckets,
        },
        continue_reading,
        recommendations,
    })
}

struct OverviewBucketDefinition {
    kind: ReadingTimeBucketKind,
    start_local_date: String,
    end_local_date: String,
    hour: Option<i64>,
}

fn overview_buckets(
    period: &ReadingOverviewPeriod,
    anchor: (i64, i64, i64),
) -> Result<(i64, i64, Vec<OverviewBucketDefinition>), String> {
    let anchor_days = days_from_civil(anchor.0, anchor.1, anchor.2);
    match period {
        ReadingOverviewPeriod::Day => {
            let date = format_date(anchor_days);
            let buckets = (0..24)
                .map(|hour| OverviewBucketDefinition {
                    kind: ReadingTimeBucketKind::Hour,
                    start_local_date: date.clone(),
                    end_local_date: date.clone(),
                    hour: Some(hour),
                })
                .collect();
            Ok((anchor_days, anchor_days, buckets))
        }
        ReadingOverviewPeriod::Week => {
            let start = anchor_days - weekday_from_monday(anchor_days);
            let buckets = (0..7)
                .map(|index| {
                    let date = format_date(start + index);
                    OverviewBucketDefinition {
                        kind: ReadingTimeBucketKind::Day,
                        start_local_date: date.clone(),
                        end_local_date: date,
                        hour: None,
                    }
                })
                .collect();
            Ok((start, start + 6, buckets))
        }
        ReadingOverviewPeriod::Month => {
            let start = days_from_civil(anchor.0, anchor.1, 1);
            let end = days_from_civil(
                if anchor.1 == 12 {
                    anchor.0 + 1
                } else {
                    anchor.0
                },
                if anchor.1 == 12 { 1 } else { anchor.1 + 1 },
                1,
            ) - 1;
            let buckets = (start..=end)
                .map(|day| {
                    let date = format_date(day);
                    OverviewBucketDefinition {
                        kind: ReadingTimeBucketKind::Day,
                        start_local_date: date.clone(),
                        end_local_date: date,
                        hour: None,
                    }
                })
                .collect();
            Ok((start, end, buckets))
        }
        ReadingOverviewPeriod::Quarter => {
            let first_month = ((anchor.1 - 1) / 3) * 3 + 1;
            let start = days_from_civil(anchor.0, first_month, 1);
            let (end_year, end_month) = if first_month == 10 {
                (anchor.0 + 1, 1)
            } else {
                (anchor.0, first_month + 3)
            };
            let end = days_from_civil(end_year, end_month, 1) - 1;
            let mut buckets = Vec::new();
            let mut bucket_start = start;
            while bucket_start <= end {
                let bucket_end = (bucket_start + 6).min(end);
                buckets.push(OverviewBucketDefinition {
                    kind: ReadingTimeBucketKind::Week,
                    start_local_date: format_date(bucket_start),
                    end_local_date: format_date(bucket_end),
                    hour: None,
                });
                bucket_start += 7;
            }
            Ok((start, end, buckets))
        }
    }
}

fn accumulate_day_bucket_values(
    segment: &reading_activity_repository::ReadingInsightSegment,
    range_start_days: i64,
    bucket_values: &mut [i64],
) -> Result<(), String> {
    let offset_millis = segment
        .utc_offset_minutes
        .checked_mul(MILLIS_PER_MINUTE)
        .ok_or_else(|| "INTERNAL_ERROR: local time overflow".to_string())?;
    let local_start = segment
        .started_at
        .checked_add(offset_millis)
        .ok_or_else(|| "INTERNAL_ERROR: local time overflow".to_string())?;
    let local_end = segment
        .confirmed_until_at
        .checked_add(offset_millis)
        .ok_or_else(|| "INTERNAL_ERROR: local time overflow".to_string())?;
    let day_start = range_start_days
        .checked_mul(MILLIS_PER_DAY)
        .ok_or_else(|| "INTERNAL_ERROR: local time overflow".to_string())?;
    const MILLIS_PER_HOUR: i64 = 3_600_000;
    for hour in 0..24_i64 {
        let bucket_start = day_start + hour * MILLIS_PER_HOUR;
        let bucket_end = bucket_start + MILLIS_PER_HOUR;
        let overlap = local_end.min(bucket_end) - local_start.max(bucket_start);
        if overlap > 0 {
            let slot = bucket_values
                .get_mut(hour as usize)
                .ok_or_else(|| "INTERNAL_ERROR: invalid day bucket".to_string())?;
            *slot = checked_add(*slot, overlap, "reading duration overflow")?;
        }
    }
    Ok(())
}

fn weekday_from_monday(days_since_epoch: i64) -> i64 {
    (days_since_epoch + 3).rem_euclid(7)
}

fn build_offline_recommendations(
    books: Vec<reading_activity_repository::ReadingInsightBook>,
    continue_book_id: Option<&str>,
    anchor_days: i64,
    utc_offset_minutes: i64,
) -> Vec<ReadingRecommendation> {
    let mut recommendations = Vec::new();
    let mut selected_ids = HashSet::new();
    let most_recent = books
        .iter()
        .filter(|candidate| candidate.last_read_at.is_some())
        .max_by(|left, right| {
            left.last_read_at
                .cmp(&right.last_read_at)
                .then_with(|| right.book.id.cmp(&left.book.id))
        });

    if let Some(current) = most_recent {
        if let (Some(series_id), Some(series_name), Some(current_order)) = (
            current.series_id.as_ref(),
            current.series_name.as_ref(),
            current.sort_order,
        ) {
            if let Some(next) = books
                .iter()
                .filter(|candidate| {
                    candidate.last_read_at.is_none()
                        && candidate.series_id.as_ref() == Some(series_id)
                        && candidate
                            .sort_order
                            .is_some_and(|order| order > current_order)
                })
                .min_by(|left, right| {
                    left.sort_order
                        .cmp(&right.sort_order)
                        .then_with(|| left.book.id.cmp(&right.book.id))
                })
            {
                selected_ids.insert(next.book.id.clone());
                recommendations.push(ReadingRecommendation {
                    book: BookSummary::from(next.book.clone()),
                    reason: ReadingRecommendationReason::NextInSeries {
                        series_id: series_id.clone(),
                        series_name: series_name.clone(),
                        previous_book_title: current.book.title.clone(),
                    },
                });
            }
        }
    }

    if recommendations.len() < 3 {
        if let Some(candidate) = books
            .iter()
            .filter(|candidate| {
                candidate.last_read_at.is_some()
                    && Some(candidate.book.id.as_str()) != continue_book_id
                    && !selected_ids.contains(&candidate.book.id)
                    && candidate
                        .progress
                        .as_ref()
                        .and_then(|progress| progress.progression)
                        .is_none_or(|progression| progression < 0.98)
                    && candidate.last_read_at.is_some_and(|last_read_at| {
                        let last_date = local_date_from_timestamp(last_read_at, utc_offset_minutes);
                        parse_local_date(&last_date)
                            .map(|date| {
                                (anchor_days - days_from_civil(date.0, date.1, date.2)).max(0)
                            })
                            .unwrap_or(0)
                            >= 14
                    })
            })
            .min_by(|left, right| {
                left.last_read_at
                    .cmp(&right.last_read_at)
                    .then_with(|| left.book.id.cmp(&right.book.id))
            })
        {
            let days_since_last_read = candidate
                .last_read_at
                .map(|last_read_at| local_date_from_timestamp(last_read_at, utc_offset_minutes))
                .and_then(|date| parse_local_date(&date).ok())
                .map(|date| (anchor_days - days_from_civil(date.0, date.1, date.2)).max(0))
                .unwrap_or(0);
            selected_ids.insert(candidate.book.id.clone());
            recommendations.push(ReadingRecommendation {
                book: BookSummary::from(candidate.book.clone()),
                reason: ReadingRecommendationReason::UnfinishedReturn {
                    days_since_last_read,
                },
            });
        }
    }

    if recommendations.len() < 3 {
        if let Some(candidate) = books
            .iter()
            .filter(|candidate| {
                candidate.last_read_at.is_none() && !selected_ids.contains(&candidate.book.id)
            })
            .max_by(|left, right| {
                left.book
                    .added_at
                    .cmp(&right.book.added_at)
                    .then_with(|| right.book.id.cmp(&left.book.id))
            })
        {
            recommendations.push(ReadingRecommendation {
                book: BookSummary::from(candidate.book.clone()),
                reason: ReadingRecommendationReason::UnstartedInLibrary,
            });
        }
    }
    recommendations
}

pub fn get_reading_footprint(
    db: &Mutex<Connection>,
    scope: ReadingFootprintScope,
) -> Result<ReadingFootprint, String> {
    let conn = lock_db(db)?;
    get_reading_footprint_at(&conn, scope)
}

fn get_reading_footprint_at(
    conn: &Connection,
    scope: ReadingFootprintScope,
) -> Result<ReadingFootprint, String> {
    let scope_for_return = scope.clone();
    let (range_start_days, range_end_days, year_start, year_end) = match scope {
        ReadingFootprintScope::Year { year } => {
            validate_year(year)?;
            let start = days_from_civil(year, 1, 1);
            (start, days_from_civil(year + 1, 1, 1) - 1, year, year)
        }
        ReadingFootprintScope::All => {
            let segments = reading_activity_repository::list_reading_insight_segments(
                conn,
                "0001-01-01",
                "9999-12-31",
            )
            .map_err(|_| "INTERNAL_ERROR: reading footprint query failed".to_string())?;
            if segments.is_empty() {
                return Ok(ReadingFootprint {
                    scope: scope_for_return,
                    totals: ReadingFootprintTotals::default(),
                    first_local_date: None,
                    last_local_date: None,
                    years: Vec::new(),
                });
            }
            let first_local_date = segments
                .iter()
                .map(|segment| segment.local_date.as_str())
                .min()
                .ok_or_else(|| "INTERNAL_ERROR: reading footprint has no dates".to_string())?;
            let last_local_date = segments
                .iter()
                .map(|segment| segment.local_date.as_str())
                .max()
                .ok_or_else(|| "INTERNAL_ERROR: reading footprint has no dates".to_string())?;
            let first = parse_local_date(first_local_date)?;
            let last = parse_local_date(last_local_date)?;
            let first_year = first.0;
            let last_year = last.0;
            (
                days_from_civil(first_year, 1, 1),
                days_from_civil(last_year + 1, 1, 1) - 1,
                first_year,
                last_year,
            )
        }
    };
    let start_local_date = format_date(range_start_days);
    let end_local_date = format_date(range_end_days);
    let segments = reading_activity_repository::list_reading_insight_segments(
        conn,
        &start_local_date,
        &end_local_date,
    )
    .map_err(|_| "INTERNAL_ERROR: reading footprint query failed".to_string())?;
    let daily = accumulate_daily_segments(segments)?;

    let mut years = Vec::new();
    let mut overall_totals = ReadingFootprintTotals::default();
    let mut overall_books = HashSet::new();
    let mut overall_series = HashSet::new();
    for year in year_start..=year_end {
        let start = days_from_civil(year, 1, 1);
        let end = days_from_civil(year + 1, 1, 1);
        let mut days = Vec::new();
        let mut year_totals = ReadingFootprintTotals::default();
        let mut year_books = HashSet::new();
        let mut year_series = HashSet::new();
        for day in start..end {
            let date = format_date(day);
            let stats = daily.get(&date);
            let reading_ms = stats.map(|value| value.reading_ms).unwrap_or(0);
            let distinct_books = stats.map(|value| value.books.len() as i64).unwrap_or(0);
            let distinct_series = stats.map(|value| value.series.len() as i64).unwrap_or(0);
            let footprint_day = ReadingFootprintDay {
                local_date: date,
                reading_ms,
                distinct_books,
                distinct_series,
            };
            year_totals.reading_ms = checked_add(
                year_totals.reading_ms,
                footprint_day.reading_ms,
                "reading footprint total overflow",
            )?;
            if footprint_day.reading_ms > 0 {
                year_totals.active_days += 1;
                if let Some(stats) = stats {
                    year_books.extend(stats.books.iter().cloned());
                    year_series.extend(stats.series.iter().cloned());
                }
            }
            days.push(footprint_day);
        }
        year_totals.distinct_books = year_books.len() as i64;
        year_totals.distinct_series = year_series.len() as i64;
        overall_totals.reading_ms = checked_add(
            overall_totals.reading_ms,
            year_totals.reading_ms,
            "reading footprint total overflow",
        )?;
        overall_totals.active_days += year_totals.active_days;
        overall_books.extend(year_books);
        overall_series.extend(year_series);
        years.push(ReadingFootprintYear {
            year,
            totals: year_totals,
            days,
        });
    }
    overall_totals.distinct_books = overall_books.len() as i64;
    overall_totals.distinct_series = overall_series.len() as i64;

    let (first_local_date, last_local_date) = daily
        .iter()
        .filter(|(_, stats)| stats.reading_ms > 0)
        .map(|(date, _)| date.clone())
        .fold((None, None), |(first, last), date| {
            let first =
                Some(first.map_or_else(|| date.clone(), |value: String| value.min(date.clone())));
            let last =
                Some(last.map_or_else(|| date.clone(), |value: String| value.max(date.clone())));
            (first, last)
        });

    Ok(ReadingFootprint {
        scope: scope_for_return,
        totals: overall_totals,
        first_local_date,
        last_local_date,
        years,
    })
}

pub fn delete_reading_history(
    db: &Mutex<Connection>,
    scope: ReadingHistoryScope,
) -> Result<crate::db::models::DeleteReadingHistoryResult, String> {
    let conn = lock_db(db)?;
    delete_reading_history_at(&conn, scope)
}

fn delete_reading_history_at(
    conn: &Connection,
    scope: ReadingHistoryScope,
) -> Result<crate::db::models::DeleteReadingHistoryResult, String> {
    let selector = match &scope {
        ReadingHistoryScope::Session { session_id } => {
            if session_id.trim().is_empty() {
                return Err("VALIDATION_ERROR: session_id must not be empty".to_string());
            }
            reading_activity_repository::ReadingHistorySelector::Session(session_id)
        }
        ReadingHistoryScope::Date { local_date } => {
            parse_local_date(local_date)?;
            reading_activity_repository::ReadingHistorySelector::Date(local_date)
        }
        ReadingHistoryScope::Book { recorded_book_id } => {
            if recorded_book_id.trim().is_empty() {
                return Err("VALIDATION_ERROR: recorded_book_id must not be empty".to_string());
            }
            reading_activity_repository::ReadingHistorySelector::Book(recorded_book_id)
        }
        ReadingHistoryScope::All => reading_activity_repository::ReadingHistorySelector::All,
    };
    let deleted = reading_activity_repository::delete_reading_history(conn, selector)
        .map_err(|_| "INTERNAL_ERROR: reading history deletion failed".to_string())?;
    Ok(crate::db::models::DeleteReadingHistoryResult {
        deleted_sessions: deleted.sessions,
        deleted_segments: deleted.segments,
    })
}

pub fn recover_interrupted_reading_activities(db: &Mutex<Connection>) -> Result<(), String> {
    let conn = lock_db(db)?;
    reading_activity_repository::recover_interrupted_reading_activities(&conn)
        .map_err(|_| "INTERNAL_ERROR: reading activity recovery failed".to_string())
}

fn validate_offset(utc_offset_minutes: i64) -> Result<(), String> {
    if !(MIN_UTC_OFFSET_MINUTES..=MAX_UTC_OFFSET_MINUTES).contains(&utc_offset_minutes) {
        return Err(format!(
            "VALIDATION_ERROR: utc_offset_minutes must be between {MIN_UTC_OFFSET_MINUTES} and {MAX_UTC_OFFSET_MINUTES}"
        ));
    }
    Ok(())
}

fn activity_state_to_db(state: &ReadingActivityState) -> &'static str {
    match state {
        ReadingActivityState::Visible => "visible",
        ReadingActivityState::Paused => "paused",
        ReadingActivityState::Ended => "ended",
    }
}

fn activity_state_from_db(state: &str) -> Result<ReadingActivityState, String> {
    match state {
        "visible" => Ok(ReadingActivityState::Visible),
        "paused" => Ok(ReadingActivityState::Paused),
        "ended" => Ok(ReadingActivityState::Ended),
        _ => Err("INTERNAL_ERROR: invalid reading activity state".to_string()),
    }
}

fn close_without_extension(
    segment: reading_activity_repository::OpenReadingSegment,
) -> ExistingSegmentUpdate {
    ExistingSegmentUpdate {
        segment_id: segment.id,
        confirmed_until_at: segment.confirmed_until_at,
        close: true,
    }
}

fn zero_length_segment(timestamp: i64, utc_offset_minutes: i64) -> NewPresenceSegment {
    NewPresenceSegment {
        id: Uuid::new_v4().to_string(),
        local_date: local_date_from_timestamp(timestamp, utc_offset_minutes),
        utc_offset_minutes,
        started_at: timestamp,
        confirmed_until_at: timestamp,
        close: false,
    }
}

fn next_local_midnight_utc(timestamp: i64, utc_offset_minutes: i64) -> i64 {
    let offset_millis = utc_offset_minutes * MILLIS_PER_MINUTE;
    let local_millis = timestamp + offset_millis;
    (local_millis.div_euclid(MILLIS_PER_DAY) + 1) * MILLIS_PER_DAY - offset_millis
}

struct DailySegmentStats {
    reading_ms: i64,
    books: HashSet<String>,
    series: HashSet<String>,
}

fn accumulate_daily_segments(
    segments: Vec<reading_activity_repository::ReadingInsightSegment>,
) -> Result<HashMap<String, DailySegmentStats>, String> {
    let mut daily = HashMap::new();
    for segment in segments {
        let duration = segment
            .confirmed_until_at
            .checked_sub(segment.started_at)
            .ok_or_else(|| "INTERNAL_ERROR: reading duration overflow".to_string())?;
        if duration <= 0 {
            continue;
        }
        let entry = daily
            .entry(segment.local_date)
            .or_insert_with(|| DailySegmentStats {
                reading_ms: 0,
                books: HashSet::new(),
                series: HashSet::new(),
            });
        entry.reading_ms = checked_add(entry.reading_ms, duration, "reading duration overflow")?;
        entry.books.insert(segment.recorded_book_id);
        if let Some(series_id) = segment.series_id_snapshot {
            entry.series.insert(series_id);
        }
    }
    Ok(daily)
}

fn checked_add(left: i64, right: i64, message: &str) -> Result<i64, String> {
    left.checked_add(right)
        .ok_or_else(|| format!("INTERNAL_ERROR: {message}"))
}

fn validate_year(year: i64) -> Result<(), String> {
    if (1..=9_999).contains(&year) {
        Ok(())
    } else {
        Err("VALIDATION_ERROR: year must be between 1 and 9999".to_string())
    }
}

fn parse_local_date(value: &str) -> Result<(i64, i64, i64), String> {
    if !value.is_ascii()
        || value.len() != 10
        || value.as_bytes()[4] != b'-'
        || value.as_bytes()[7] != b'-'
    {
        return Err("VALIDATION_ERROR: date must use YYYY-MM-DD".to_string());
    }
    let year = value[0..4]
        .parse::<i64>()
        .map_err(|_| "VALIDATION_ERROR: date must use YYYY-MM-DD".to_string())?;
    let month = value[5..7]
        .parse::<i64>()
        .map_err(|_| "VALIDATION_ERROR: date must use YYYY-MM-DD".to_string())?;
    let day = value[8..10]
        .parse::<i64>()
        .map_err(|_| "VALIDATION_ERROR: date must use YYYY-MM-DD".to_string())?;
    validate_year(year)?;
    if !(1..=12).contains(&month) || !(1..=days_in_month(year, month)).contains(&day) {
        return Err("VALIDATION_ERROR: date is outside the Gregorian calendar".to_string());
    }
    if format!("{year:04}-{month:02}-{day:02}") != value {
        return Err("VALIDATION_ERROR: date must use YYYY-MM-DD".to_string());
    }
    Ok((year, month, day))
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if is_leap_year(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn is_leap_year(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let adjusted_year = year - if month <= 2 { 1 } else { 0 };
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let month_prime = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn format_date(days_since_epoch: i64) -> String {
    let (year, month, day) = civil_from_days(days_since_epoch);
    format!("{year:04}-{month:02}-{day:02}")
}

fn local_date_from_timestamp(timestamp: i64, utc_offset_minutes: i64) -> String {
    let local_millis = timestamp + utc_offset_minutes * MILLIS_PER_MINUTE;
    let days_since_epoch = local_millis.div_euclid(MILLIS_PER_DAY);
    let (year, month, day) = civil_from_days(days_since_epoch);
    format!("{year:04}-{month:02}-{day:02}")
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

fn lock_db(db: &Mutex<Connection>) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.lock()
        .map_err(|_| "INTERNAL_ERROR: db lock poisoned".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn connection_with_book() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO books VALUES ('book','A Book','[\"Author\"]','epub',NULL,'/book.epub','desktop_path',1,2,NULL,'available',NULL,3,4)",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn begin_activity_snapshots_book_and_opens_visible_segment() {
        let conn = connection_with_book();

        let receipt = begin_reading_activity_at(&conn, "book", 480, 1_000).unwrap();

        assert_eq!(receipt.sequence, 0);
        assert_eq!(receipt.accepted_at, 1_000);
        let stored: (String, String, String, i64) = conn
            .query_row(
                "SELECT recorded_book_id,book_title,state,last_observed_at FROM reading_activity_sessions WHERE id=?1",
                [&receipt.session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            stored,
            ("book".into(), "A Book".into(), "visible".into(), 1_000)
        );
        let open_segment: (String, i64, i64) = conn
            .query_row(
                "SELECT local_date,started_at,confirmed_until_at FROM reading_presence_segments WHERE session_id=?1 AND closed_at IS NULL",
                [&receipt.session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(open_segment, ("1970-01-01".into(), 1_000, 1_000));
        let state: (i64, i64) = conn
            .query_row(
                "SELECT started_at,last_read_at FROM book_reading_state WHERE book_id='book'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(state, (1_000, 1_000));
    }

    #[test]
    fn observations_are_idempotent_and_count_only_visible_intervals() {
        let conn = connection_with_book();
        let started = begin_reading_activity_at(&conn, "book", 0, 1_000).unwrap();

        let first = observe_reading_activity_at(
            &conn,
            &started.session_id,
            1,
            ReadingActivityState::Visible,
            0,
            31_000,
        )
        .unwrap();
        let duplicate = observe_reading_activity_at(
            &conn,
            &started.session_id,
            1,
            ReadingActivityState::Visible,
            0,
            32_000,
        )
        .unwrap();
        assert_eq!(duplicate, first);

        observe_reading_activity_at(
            &conn,
            &started.session_id,
            2,
            ReadingActivityState::Paused,
            0,
            61_000,
        )
        .unwrap();
        observe_reading_activity_at(
            &conn,
            &started.session_id,
            3,
            ReadingActivityState::Visible,
            0,
            91_000,
        )
        .unwrap();
        observe_reading_activity_at(
            &conn,
            &started.session_id,
            4,
            ReadingActivityState::Ended,
            0,
            121_000,
        )
        .unwrap();

        let total: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(confirmed_until_at-started_at),0) FROM reading_presence_segments WHERE session_id=?1",
                [&started.session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(total, 90_000);
        let open_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM reading_presence_segments WHERE session_id=?1 AND closed_at IS NULL",
                [&started.session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(open_count, 0);
    }

    #[test]
    fn long_unknown_gap_and_restart_do_not_extrapolate_reading_time() {
        let conn = connection_with_book();
        let started = begin_reading_activity_at(&conn, "book", 0, 1_000).unwrap();
        observe_reading_activity_at(
            &conn,
            &started.session_id,
            1,
            ReadingActivityState::Visible,
            0,
            31_000,
        )
        .unwrap();
        observe_reading_activity_at(
            &conn,
            &started.session_id,
            2,
            ReadingActivityState::Visible,
            0,
            200_000,
        )
        .unwrap();

        reading_activity_repository::recover_interrupted_reading_activities(&conn).unwrap();

        let total: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(confirmed_until_at-started_at),0) FROM reading_presence_segments WHERE session_id=?1",
                [&started.session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(total, 30_000);
        let ended: (String, i64) = conn
            .query_row(
                "SELECT state,ended_at FROM reading_activity_sessions WHERE id=?1",
                [&started.session_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(ended, ("ended".into(), 200_000));
    }

    #[test]
    fn visible_observation_splits_at_local_midnight() {
        let conn = connection_with_book();
        let started = begin_reading_activity_at(&conn, "book", 0, MILLIS_PER_DAY - 10_000).unwrap();
        observe_reading_activity_at(
            &conn,
            &started.session_id,
            1,
            ReadingActivityState::Visible,
            0,
            MILLIS_PER_DAY + 20_000,
        )
        .unwrap();

        let segments: Vec<(String, i64)> = conn
            .prepare(
                "SELECT local_date,confirmed_until_at-started_at FROM reading_presence_segments WHERE session_id=?1 ORDER BY started_at",
            )
            .unwrap()
            .query_map([&started.session_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            segments,
            vec![("1970-01-01".into(), 10_000), ("1970-01-02".into(), 20_000)]
        );
    }

    #[test]
    fn observation_rejects_sequence_gaps_and_events_after_end() {
        let conn = connection_with_book();
        let started = begin_reading_activity_at(&conn, "book", 0, 1_000).unwrap();

        let gap = observe_reading_activity_at(
            &conn,
            &started.session_id,
            2,
            ReadingActivityState::Visible,
            0,
            31_000,
        )
        .unwrap_err();
        assert!(gap.starts_with("READING_ACTIVITY_CONFLICT:"));
        observe_reading_activity_at(
            &conn,
            &started.session_id,
            1,
            ReadingActivityState::Ended,
            0,
            31_000,
        )
        .unwrap();
        let after_end = observe_reading_activity_at(
            &conn,
            &started.session_id,
            2,
            ReadingActivityState::Visible,
            0,
            61_000,
        )
        .unwrap_err();
        assert!(after_end.starts_with("READING_ACTIVITY_CONFLICT:"));
    }

    fn timestamp_for_date(date: &str, hour: i64) -> i64 {
        let days = days_from_civil_for_test(date);
        days * MILLIS_PER_DAY + hour * 3_600_000
    }

    fn days_from_civil_for_test(date: &str) -> i64 {
        let parts: Vec<i64> = date
            .split('-')
            .map(|part| part.parse::<i64>().unwrap())
            .collect();
        let (year, month, day) = (parts[0], parts[1], parts[2]);
        let adjusted_year = year - if month <= 2 { 1 } else { 0 };
        let era = adjusted_year.div_euclid(400);
        let year_of_era = adjusted_year - era * 400;
        let month_prime = month + if month > 2 { -3 } else { 9 };
        let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
        let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
        era * 146_097 + day_of_era - 719_468
    }

    fn finish_activity(conn: &Connection, book_id: &str, start: i64, duration: i64) {
        let started = begin_reading_activity_at(conn, book_id, 0, start).unwrap();
        if duration <= MAX_CONFIRMATION_GAP_MS {
            observe_reading_activity_at(
                conn,
                &started.session_id,
                1,
                ReadingActivityState::Ended,
                0,
                start + duration,
            )
            .unwrap();
        } else {
            observe_reading_activity_at(
                conn,
                &started.session_id,
                1,
                ReadingActivityState::Visible,
                0,
                start + 60_000,
            )
            .unwrap();
            observe_reading_activity_at(
                conn,
                &started.session_id,
                2,
                ReadingActivityState::Ended,
                0,
                start + duration,
            )
            .unwrap();
        }
    }

    #[test]
    fn footprint_returns_year_cells_and_aggregates_distinct_books_and_series() {
        let conn = connection_with_book();
        conn.execute(
            "INSERT INTO books VALUES ('book2','Second','[]','epub',NULL,'/book2.epub','desktop_path',1,2,NULL,'available',NULL,3,4)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO series VALUES ('series','Series',1,1)", [])
            .unwrap();
        conn.execute("INSERT INTO book_series VALUES ('book','series','1',1)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO book_series VALUES ('book2','series','2',2)",
            [],
        )
        .unwrap();
        let first = timestamp_for_date("2024-01-01", 12);
        let second = timestamp_for_date("2024-01-02", 12);
        finish_activity(&conn, "book", first, 60_000);
        finish_activity(&conn, "book2", second, 120_000);

        let footprint =
            get_reading_footprint_at(&conn, ReadingFootprintScope::Year { year: 2024 }).unwrap();
        assert_eq!(footprint.years.len(), 1);
        assert_eq!(footprint.years[0].days.len(), 366);
        assert_eq!(footprint.totals.reading_ms, 180_000);
        assert_eq!(footprint.totals.active_days, 2);
        assert_eq!(footprint.totals.distinct_books, 2);
        assert_eq!(footprint.totals.distinct_series, 1);
        assert_eq!(
            footprint.years[0].days[0],
            crate::db::models::ReadingFootprintDay {
                local_date: "2024-01-01".into(),
                reading_ms: 60_000,
                distinct_books: 1,
                distinct_series: 1,
            }
        );
    }

    #[test]
    fn deleting_history_keeps_book_progress_and_reading_state() {
        let conn = connection_with_book();
        finish_activity(&conn, "book", timestamp_for_date("2024-01-01", 12), 60_000);
        conn.execute(
            "INSERT INTO reading_progress VALUES ('book','epubcfi(/6/2)',0.4,1234)",
            [],
        )
        .unwrap();

        let deleted = delete_reading_history_at(
            &conn,
            ReadingHistoryScope::Book {
                recorded_book_id: "book".into(),
            },
        )
        .unwrap();
        assert_eq!(deleted.deleted_sessions, 1);
        assert_eq!(deleted.deleted_segments, 1);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM books WHERE id='book'", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM reading_progress WHERE book_id='book'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM book_reading_state WHERE book_id='book'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }

    #[test]
    fn deleting_book_keeps_history_snapshot_but_removes_live_links() {
        let conn = connection_with_book();
        conn.execute("INSERT INTO series VALUES ('series','Series',1,1)", [])
            .unwrap();
        conn.execute("INSERT INTO book_series VALUES ('book','series','1',1)", [])
            .unwrap();
        finish_activity(&conn, "book", timestamp_for_date("2024-01-01", 12), 60_000);

        crate::db::repository::delete_book(&conn, "book").unwrap();

        let snapshot: (
            String,
            Option<String>,
            String,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT recorded_book_id,book_id,book_title,series_id_snapshot,series_name_snapshot
                 FROM reading_activity_sessions",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            snapshot,
            (
                "book".into(),
                None,
                "A Book".into(),
                Some("series".into()),
                Some("Series".into())
            )
        );

        let footprint =
            get_reading_footprint_at(&conn, ReadingFootprintScope::Year { year: 2024 }).unwrap();
        assert_eq!(footprint.totals.reading_ms, 60_000);
        assert_eq!(footprint.totals.distinct_books, 1);
        assert_eq!(footprint.totals.distinct_series, 1);
        let overview = get_library_reading_overview_at(
            &conn,
            ReadingOverviewPeriod::Day,
            "2024-01-01",
            0,
            timestamp_for_date("2024-01-01", 12),
        )
        .unwrap();
        assert!(overview.continue_reading.is_none());
        assert!(overview.recommendations.is_empty());
    }

    #[test]
    fn deleting_history_by_date_session_and_all_preserves_partial_sessions() {
        let conn = connection_with_book();
        let start = timestamp_for_date("2024-01-01", 23) + 59 * MILLIS_PER_MINUTE;
        let activity = begin_reading_activity_at(&conn, "book", 0, start).unwrap();
        observe_reading_activity_at(
            &conn,
            &activity.session_id,
            1,
            ReadingActivityState::Ended,
            0,
            timestamp_for_date("2024-01-02", 0) + 30_000,
        )
        .unwrap();

        let first_date = delete_reading_history_at(
            &conn,
            ReadingHistoryScope::Date {
                local_date: "2024-01-01".into(),
            },
        )
        .unwrap();
        assert_eq!(first_date.deleted_sessions, 0);
        assert_eq!(first_date.deleted_segments, 1);
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM reading_activity_sessions WHERE id=?1",
                [&activity.session_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            1
        );

        let second_date = delete_reading_history_at(
            &conn,
            ReadingHistoryScope::Date {
                local_date: "2024-01-02".into(),
            },
        )
        .unwrap();
        assert_eq!(second_date.deleted_sessions, 1);
        assert_eq!(second_date.deleted_segments, 1);

        let session =
            begin_reading_activity_at(&conn, "book", 0, timestamp_for_date("2024-01-03", 12))
                .unwrap();
        observe_reading_activity_at(
            &conn,
            &session.session_id,
            1,
            ReadingActivityState::Ended,
            0,
            timestamp_for_date("2024-01-03", 12) + 60_000,
        )
        .unwrap();
        let deleted_session = delete_reading_history_at(
            &conn,
            ReadingHistoryScope::Session {
                session_id: session.session_id,
            },
        )
        .unwrap();
        assert_eq!(deleted_session.deleted_sessions, 1);
        assert_eq!(deleted_session.deleted_segments, 1);

        finish_activity(&conn, "book", timestamp_for_date("2024-01-04", 12), 60_000);
        let deleted_all = delete_reading_history_at(&conn, ReadingHistoryScope::All).unwrap();
        assert_eq!(deleted_all.deleted_sessions, 1);
        assert_eq!(deleted_all.deleted_segments, 1);
    }

    #[test]
    fn overview_returns_continue_item_and_offline_recommendation_reasons() {
        let conn = connection_with_book();
        conn.execute(
            "INSERT INTO books VALUES ('book2','Second','[]','epub',NULL,'/book2.epub','desktop_path',1,2,NULL,'available',NULL,3,5)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO books VALUES ('book3','Third','[]','epub',NULL,'/book3.epub','desktop_path',1,2,NULL,'available',NULL,3,6)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO books VALUES ('book4','Old unfinished','[]','epub',NULL,'/book4.epub','desktop_path',1,2,NULL,'available',NULL,3,7)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO series VALUES ('series','Series',1,1)", [])
            .unwrap();
        conn.execute("INSERT INTO book_series VALUES ('book','series','1',1)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO book_series VALUES ('book2','series','2',2)",
            [],
        )
        .unwrap();
        finish_activity(&conn, "book", timestamp_for_date("2024-01-01", 12), 60_000);
        conn.execute(
            "INSERT INTO reading_progress VALUES ('book','epubcfi(/6/2)',0.4,1000)",
            [],
        )
        .unwrap();
        finish_activity(&conn, "book4", timestamp_for_date("2023-12-01", 12), 60_000);
        conn.execute(
            "INSERT INTO reading_progress VALUES ('book4','epubcfi(/6/2)',0.4,1000)",
            [],
        )
        .unwrap();

        let overview = get_library_reading_overview_at(
            &conn,
            ReadingOverviewPeriod::Day,
            "2024-01-01",
            0,
            timestamp_for_date("2024-01-01", 12),
        )
        .unwrap();
        assert_eq!(overview.duration.buckets.len(), 24);
        assert_eq!(
            overview
                .continue_reading
                .as_ref()
                .map(|item| item.book.id.as_str()),
            Some("book")
        );
        assert!(overview.recommendations.iter().any(|item| {
            item.book.id == "book2"
                && matches!(
                    item.reason,
                    crate::db::models::ReadingRecommendationReason::NextInSeries { .. }
                )
        }));
        assert!(overview.recommendations.iter().any(|item| {
            item.book.id == "book3"
                && matches!(
                    item.reason,
                    crate::db::models::ReadingRecommendationReason::UnstartedInLibrary
                )
        }));
        assert!(overview.recommendations.iter().any(|item| {
            item.book.id == "book4"
                && matches!(
                    item.reason,
                    crate::db::models::ReadingRecommendationReason::UnfinishedReturn {
                        days_since_last_read: 31
                    }
                )
        }));
    }
}
