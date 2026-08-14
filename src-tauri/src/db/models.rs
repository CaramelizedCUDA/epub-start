use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BookFormat {
    Epub,
    Txt,
    Pdf,
    Cbz,
    Cbr,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    DesktopPath,
    AndroidContentUri,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BookStatus {
    Available,
    Missing,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub format: BookFormat,
    pub cover_cache_path: Option<String>,
    pub source_locator: String,
    pub source_kind: SourceKind,
    pub file_size_bytes: i64,
    pub last_modified_ts: i64,
    pub package_identifier: Option<String>,
    pub status: BookStatus,
    pub status_detail: Option<String>,
    pub added_at: i64,
    pub updated_at: i64,
}

/// Public-facing book summary without sensitive source-locator fields.
/// Used by `list_books` so the renderer never sees absolute paths or
/// `content://` URIs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookSummary {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub format: BookFormat,
    pub cover_cache_path: Option<String>,
    pub file_size_bytes: i64,
    pub last_modified_ts: i64,
    pub package_identifier: Option<String>,
    pub status: BookStatus,
    pub status_detail: Option<String>,
    pub added_at: i64,
    pub updated_at: i64,
}

impl From<Book> for BookSummary {
    fn from(b: Book) -> Self {
        BookSummary {
            id: b.id,
            title: b.title,
            authors: b.authors,
            format: b.format,
            cover_cache_path: b.cover_cache_path,
            file_size_bytes: b.file_size_bytes,
            last_modified_ts: b.last_modified_ts,
            package_identifier: b.package_identifier,
            status: b.status,
            status_detail: b.status_detail,
            added_at: b.added_at,
            updated_at: b.updated_at,
        }
    }
}

// IPC types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectedSource {
    pub source_locator: String,
    pub source_kind: SourceKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingProgress {
    pub book_id: String,
    pub location_cfi: Option<String>,
    pub progression: Option<f64>,
    pub updated_at: i64,
}

// Command return types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenBookResult {
    pub book: Book,
    pub epub_root_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub book_id: String,
    pub cfi_start: String,
    pub cfi_end: String,
    pub cfi_range: Option<String>,
    pub selected_text: String,
    pub content: String,
    pub color: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNoteInput {
    pub book_id: String,
    pub cfi_start: String,
    pub cfi_end: String,
    pub cfi_range: Option<String>,
    pub selected_text: String,
    pub content: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateNoteInput {
    pub id: String,
    pub cfi_start: String,
    pub cfi_end: String,
    pub cfi_range: Option<String>,
    pub selected_text: String,
    pub content: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingSettings {
    pub theme: String,
    pub font_family: String,
    pub font_size_px: i64,
    pub line_height_multiplier: f64,
    pub paragraph_spacing_multiplier: f64,
    pub text_indent_em: f64,
    pub margin_top_px: i64,
    pub margin_bottom_px: i64,
    pub margin_left_percent: i64,
    pub margin_right_percent: i64,
    pub max_column_width_px: i64,
    pub flow: String,
    pub spread: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookReadingSettings {
    pub book_id: String,
    pub theme: Option<String>,
    pub font_family: Option<String>,
    pub font_size_px: Option<i64>,
    pub line_height_multiplier: Option<f64>,
    pub paragraph_spacing_multiplier: Option<f64>,
    pub text_indent_em: Option<f64>,
    pub margin_top_px: Option<i64>,
    pub margin_bottom_px: Option<i64>,
    pub margin_left_percent: Option<i64>,
    pub margin_right_percent: Option<i64>,
    pub max_column_width_px: Option<i64>,
    pub flow: Option<String>,
    pub spread: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingSettingsResult {
    pub effective: ReadingSettings,
    pub global: ReadingSettings,
    pub book_override: Option<BookReadingSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingSettingsInput {
    pub theme: String,
    pub font_family: String,
    pub font_size_px: i64,
    pub line_height_multiplier: f64,
    pub paragraph_spacing_multiplier: f64,
    pub text_indent_em: f64,
    pub margin_top_px: i64,
    pub margin_bottom_px: i64,
    pub margin_left_percent: i64,
    pub margin_right_percent: i64,
    pub max_column_width_px: i64,
    pub flow: String,
    pub spread: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookReadingSettingsInput {
    pub book_id: String,
    pub theme: Option<String>,
    pub font_family: Option<String>,
    pub font_size_px: Option<i64>,
    pub line_height_multiplier: Option<f64>,
    pub paragraph_spacing_multiplier: Option<f64>,
    pub text_indent_em: Option<f64>,
    pub margin_top_px: Option<i64>,
    pub margin_bottom_px: Option<i64>,
    pub margin_left_percent: Option<i64>,
    pub margin_right_percent: Option<i64>,
    pub max_column_width_px: Option<i64>,
    pub flow: Option<String>,
    pub spread: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct Series {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSeriesInput {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSeriesInput {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookSeries {
    pub book_id: String,
    pub series_id: String,
    pub volume_label: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeriesBookPosition {
    pub book_id: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagGroup {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTagGroupInput {
    pub name: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTagGroupInput {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub group_id: Option<String>,
    pub name: String,
    pub color: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTagInput {
    pub group_id: Option<String>,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTagInput {
    pub id: String,
    pub group_id: Option<String>,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookTag {
    pub tag: Tag,
    pub inherited_from_series: bool,
}
