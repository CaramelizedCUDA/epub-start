// TypeScript mirrors of Rust serde models.
// All field names use snake_case to match Rust #[serde(rename_all = "snake_case")].

export type BookFormat = 'epub' | 'txt' | 'pdf' | 'cbz' | 'cbr';
export type SourceKind = 'desktop_path' | 'android_content_uri';
export type BookStatus = 'available' | 'missing' | 'error';

export interface Book {
  id: string;
  title: string;
  authors: string[];
  format: BookFormat;
  cover_cache_path: string | null;
  source_locator: string;
  source_kind: SourceKind;
  file_size_bytes: number;
  last_modified_ts: number;
  package_identifier: string | null;
  status: BookStatus;
  status_detail: string | null;
  added_at: number;
  updated_at: number;
}

/** Public shelf view — same as Book but without source_locator / source_kind. */
export interface BookSummary {
  id: string;
  title: string;
  authors: string[];
  format: BookFormat;
  cover_cache_path: string | null;
  file_size_bytes: number;
  last_modified_ts: number;
  package_identifier: string | null;
  status: BookStatus;
  status_detail: string | null;
  added_at: number;
  updated_at: number;
}

export interface ReadingProgress {
  book_id: string;
  location_cfi: string | null;
  progression: number | null;
  updated_at: number;
}

export interface Note {
  id: string;
  book_id: string;
  cfi_start: string;
  cfi_end: string;
  cfi_range: string | null;
  selected_text: string;
  content: string;
  color: string;
  created_at: number;
  updated_at: number;
}

export type CreateNoteInput = Omit<Note, 'id' | 'created_at' | 'updated_at'>;
export type UpdateNoteInput = Omit<Note, 'book_id' | 'created_at' | 'updated_at'>;

export type ReadingTheme = 'light' | 'sepia' | 'dark';
export type ReadingFont = 'publisher' | 'serif' | 'sans' | 'system';
export type ReadingFlow = 'paginated' | 'scrolled';
export type ReadingSpread = 'auto' | 'none' | 'always';

export interface ReadingSettings {
  theme: ReadingTheme;
  font_family: ReadingFont;
  font_size_px: number;
  line_height_multiplier: number;
  paragraph_spacing_multiplier: number;
  text_indent_em: number;
  margin_top_px: number;
  margin_bottom_px: number;
  margin_left_percent: number;
  margin_right_percent: number;
  max_column_width_px: number;
  flow: ReadingFlow;
  spread: ReadingSpread;
  updated_at: number;
}

export interface BookReadingSettings extends Partial<Omit<ReadingSettings, 'updated_at'>> {
  book_id: string;
  updated_at: number;
}

export interface ReadingSettingsResult {
  effective: ReadingSettings;
  global: ReadingSettings;
  book_override: BookReadingSettings | null;
}

export type ReadingSettingsInput = Omit<ReadingSettings, 'updated_at'>;
export type BookReadingSettingsInput = Omit<BookReadingSettings, 'updated_at'>;

export interface Series {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export type CreateSeriesInput = Pick<Series, 'name'>;
export type UpdateSeriesInput = Pick<Series, 'id' | 'name'>;

export interface BookSeries {
  book_id: string;
  series_id: string;
  volume_label: string;
  sort_order: number;
}

export interface SeriesBookPosition {
  book_id: string;
  sort_order: number;
}

export interface TagGroup {
  id: string;
  name: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export type CreateTagGroupInput = Pick<TagGroup, 'name' | 'sort_order'>;
export type UpdateTagGroupInput = Pick<TagGroup, 'id' | 'name' | 'sort_order'>;

export interface Tag {
  id: string;
  group_id: string | null;
  name: string;
  color: string;
  created_at: number;
  updated_at: number;
}

export type CreateTagInput = Pick<Tag, 'group_id' | 'name' | 'color'>;
export type UpdateTagInput = Pick<Tag, 'id' | 'group_id' | 'name' | 'color'>;

export interface BookTag {
  tag: Tag;
  inherited_from_series: boolean;
}

export interface SearchTaskStatus {
  task_id: string;
  series_id: string;
  status: string;
  indexed_documents: number;
  total_documents: number;
  error_detail: string | null;
  updated_at: number;
}

export interface SearchIndexStatus {
  series_id: string;
  status: string;
  indexed_documents: number;
  total_documents: number;
  error_detail: string | null;
  updated_at: number;
}

export interface SearchResult {
  book_id: string;
  spine_index: number;
  href: string;
  title: string;
  snippet: string;
  cfi: string | null; // B2 always null; EPUB.js resolves an exact CFI after opening href.
}

export type ReadingActivityState = 'visible' | 'paused' | 'ended';

export interface ReadingActivityReceipt {
  session_id: string;
  sequence: number;
  state: ReadingActivityState;
  accepted_at: number;
}

export type ReadingOverviewPeriod = 'day' | 'week' | 'month' | 'quarter';
export type ReadingTimeBucketKind = 'hour' | 'day' | 'week';

export interface ReadingDurationBucket {
  kind: ReadingTimeBucketKind;
  start_local_date: string;
  end_local_date: string;
  hour: number | null;
  reading_ms: number;
}

export interface ReadingDurationSummary {
  period: ReadingOverviewPeriod;
  range_start_local_date: string;
  range_end_local_date: string;
  total_reading_ms: number;
  buckets: ReadingDurationBucket[];
}

export interface ContinueReadingItem {
  book: BookSummary;
  progress: ReadingProgress | null;
  last_read_at: number;
}

export type ReadingRecommendationReason =
  | {
      kind: 'next_in_series';
      series_id: string;
      series_name: string;
      previous_book_title: string;
    }
  | {
      kind: 'unfinished_return';
      days_since_last_read: number;
    }
  | {
      kind: 'unstarted_in_library';
    };

export interface ReadingRecommendation {
  book: BookSummary;
  reason: ReadingRecommendationReason;
}

export interface LibraryReadingOverview {
  duration: ReadingDurationSummary;
  continue_reading: ContinueReadingItem | null;
  recommendations: ReadingRecommendation[];
}

export type ReadingFootprintScope = { kind: 'year'; year: number } | { kind: 'all' };

export interface ReadingFootprintDay {
  local_date: string;
  reading_ms: number;
  distinct_books: number;
  distinct_series: number;
}

export interface ReadingFootprintTotals {
  reading_ms: number;
  active_days: number;
  distinct_books: number;
  distinct_series: number;
}

export interface ReadingFootprintYear {
  year: number;
  totals: ReadingFootprintTotals;
  days: ReadingFootprintDay[];
}

export interface ReadingFootprint {
  scope: ReadingFootprintScope;
  totals: ReadingFootprintTotals;
  first_local_date: string | null;
  last_local_date: string | null;
  years: ReadingFootprintYear[];
}

export type ReadingHistoryScope =
  | { kind: 'session'; session_id: string }
  | { kind: 'date'; local_date: string }
  | { kind: 'book'; recorded_book_id: string }
  | { kind: 'all' };

export interface DeleteReadingHistoryResult {
  deleted_sessions: number;
  deleted_segments: number;
}

/** Returned only by the feature-gated B3 release-like diagnostic build. */
export interface B3PrivateDataReport {
  schema_version: number;
  book_count: number;
  total_bytes: number;
  database_bytes: number;
  source_cache_bytes: number;
  cover_cache_bytes: number;
  other_bytes: number;
  search_index_text_bytes: number;
  search_document_count: number;
}
