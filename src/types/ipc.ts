// IPC type mirrors: command argument and return types.
// Must stay in sync with IPC.md and Rust #[tauri::command] signatures.
//
// RULE: flat Tauri command params use camelCase (Tauri default conversion).
//       Nested struct params and return types use snake_case (serde rename_all).

import type {
  Book,
  BookReadingSettingsInput,
  BookSeries,
  CreateNoteInput,
  CreateSeriesInput,
  CreateTagGroupInput,
  CreateTagInput,
  ReadingSettingsInput,
  SeriesBookPosition,
  SourceKind,
  UpdateNoteInput,
  UpdateSeriesInput,
  UpdateTagGroupInput,
  UpdateTagInput,
} from './models';

export interface SelectedSource {
  source_locator: string;
  source_kind: SourceKind;
}

export interface OpenBookResult {
  book: Book;
  epub_root_url: string;
}

// Phase 1 command parameter types:

export type ImportBookArgs = {
  source: SelectedSource;
};

export type OpenBookArgs = {
  bookId: string;
};

export type RelocateBookArgs = {
  bookId: string;
  source: SelectedSource;
};

export type GetReadingProgressArgs = {
  bookId: string;
};

export type SaveReadingProgressArgs = {
  bookId: string;
  locationCfi: string;
  progression: number;
};

export type DeleteBookArgs = {
  bookId: string;
};

export type SaveBookImageArgs = {
  bookId: string;
  entryPath: string;
};

export type BookIdArgs = { bookId: string };
export type CreateNoteArgs = { note: CreateNoteInput };
export type UpdateNoteArgs = { note: UpdateNoteInput };
export type GlobalSettingsArgs = { settings: ReadingSettingsInput };
export type BookSettingsArgs = { settings: BookReadingSettingsInput };
export type CreateSeriesArgs = { series: CreateSeriesInput };
export type UpdateSeriesArgs = { series: UpdateSeriesInput };
export type SeriesIdArgs = { seriesId: string };
export type BookSeriesArgs = { assignment: BookSeries };
export type ReorderSeriesArgs = { seriesId: string; positions: SeriesBookPosition[] };
export type CreateTagGroupArgs = { group: CreateTagGroupInput };
export type UpdateTagGroupArgs = { group: UpdateTagGroupInput };
export type TagGroupIdArgs = { groupId: string };
export type CreateTagArgs = { tag: CreateTagInput };
export type UpdateTagArgs = { tag: UpdateTagInput };
export type TagIdArgs = { tagId: string };
export type SetBookTagsArgs = { bookId: string; tagIds: string[] };
export type SetSeriesTagsArgs = { seriesId: string; tagIds: string[] };
export type FilterBooksByTagsArgs = { tagIds: string[] };
export type SearchSeriesArgs = { seriesId: string; query: string; limit?: number };
export type SearchIndexSeriesArgs = { seriesId: string };
export type CancelSearchArgs = { taskId: string };
