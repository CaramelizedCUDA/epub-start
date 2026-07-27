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
