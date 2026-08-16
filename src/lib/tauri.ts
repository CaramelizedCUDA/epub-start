// Typed invoke wrappers for all Tauri commands.
// Every command result is Result<T, string> — rejections become typed errors.

import { invoke } from '@tauri-apps/api/core';
import type {
  Book,
  BookReadingSettings,
  BookSeries,
  BookSummary,
  BookTag,
  Note,
  ReadingProgress,
  ReadingSettings,
  ReadingSettingsInput,
  ReadingSettingsResult,
  Series,
  Tag,
  TagGroup,
  SearchIndexStatus,
  SearchResult,
  SearchTaskStatus,
} from '../types/models';
import type {
  SelectedSource,
  OpenBookResult,
  ImportBookArgs,
  OpenBookArgs,
  RelocateBookArgs,
  GetReadingProgressArgs,
  SaveReadingProgressArgs,
  SaveBookImageArgs,
  DeleteBookArgs,
  BookIdArgs,
  CreateNoteArgs,
  UpdateNoteArgs,
  GlobalSettingsArgs,
  BookSettingsArgs,
  BookSeriesArgs,
  ReorderSeriesArgs,
  CreateSeriesArgs,
  UpdateSeriesArgs,
  SeriesIdArgs,
  SetBookTagsArgs,
  SetSeriesTagsArgs,
  CreateTagArgs,
  UpdateTagArgs,
  CreateTagGroupArgs,
  UpdateTagGroupArgs,
  TagGroupIdArgs,
  TagIdArgs,
  SearchSeriesArgs,
  SearchIndexSeriesArgs,
  CancelSearchArgs,
} from '../types/ipc';

function mapError(err: unknown): never {
  const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
  const knownPrefixes = [
    'BOOK_SOURCE_UNAVAILABLE:',
    'SAF_PERMISSION_DENIED:',
    'BOOK_RELOCATION_MISMATCH:',
    'BOOK_PARSE_FAILED:',
    'BOOK_NOT_FOUND:',
    'NOTE_NOT_FOUND:',
    'SERIES_NOT_FOUND:',
    'TAG_NOT_FOUND:',
    'TAG_GROUP_NOT_FOUND:',
    'VALIDATION_ERROR:',
    'BOOK_RESOURCE_LIMIT_EXCEEDED:',
    'BOOK_RESOURCE_NOT_FOUND:',
    'FORMAT_NOT_SUPPORTED:',
    'SEARCH_INDEX_UNAVAILABLE:',
    'INTERNAL_ERROR:',
  ];
  if (knownPrefixes.some((prefix) => msg.startsWith(prefix))) {
    throw new Error(msg);
  }
  throw new Error('INTERNAL_ERROR: 操作失败，请重试。');
}

// Phase 1 commands:

export async function selectEpubSources(): Promise<SelectedSource[]> {
  return invoke<SelectedSource[]>('select_epub_sources').catch(mapError);
}

export async function importBook(args: ImportBookArgs): Promise<Book> {
  return invoke<Book>('import_book', args).catch(mapError);
}

export async function listBooks(): Promise<BookSummary[]> {
  return invoke<BookSummary[]>('list_books').catch(mapError);
}

export async function openBook(args: OpenBookArgs): Promise<OpenBookResult> {
  return invoke<OpenBookResult>('open_book', args).catch(mapError);
}

export async function relocateBook(args: RelocateBookArgs): Promise<Book> {
  return invoke<Book>('relocate_book', args).catch(mapError);
}

export async function getReadingProgress(
  args: GetReadingProgressArgs,
): Promise<ReadingProgress | null> {
  return invoke<ReadingProgress | null>('get_reading_progress', args).catch(mapError);
}

export async function saveReadingProgress(
  args: SaveReadingProgressArgs,
): Promise<ReadingProgress> {
  return invoke<ReadingProgress>('save_reading_progress', args).catch(mapError);
}

export async function deleteBook(args: DeleteBookArgs): Promise<string> {
  return invoke<string>('delete_book', args).catch(mapError);
}

export async function saveBookImage(args: SaveBookImageArgs): Promise<boolean> {
  return invoke<boolean>('save_book_image', args).catch(mapError);
}

export async function listNotes(args: BookIdArgs): Promise<Note[]> {
  return invoke<Note[]>('list_notes', args).catch(mapError);
}

export async function createNote(args: CreateNoteArgs): Promise<Note> {
  return invoke<Note>('create_note', args).catch(mapError);
}

export async function updateNote(args: UpdateNoteArgs): Promise<Note> {
  return invoke<Note>('update_note', args).catch(mapError);
}

export async function deleteNote(noteId: string): Promise<void> {
  return invoke<void>('delete_note', { noteId }).catch(mapError);
}

export async function getReadingSettings(args: BookIdArgs): Promise<ReadingSettingsResult> {
  return invoke<ReadingSettingsResult>('get_reading_settings', args).catch(mapError);
}

export async function getGlobalReadingSettings(): Promise<ReadingSettings> {
  return invoke<ReadingSettings>('get_global_reading_settings').catch(mapError);
}

export async function saveBookReadingSettings(args: BookSettingsArgs): Promise<BookReadingSettings> {
  return invoke<BookReadingSettings>('save_book_reading_settings', args).catch(mapError);
}

export async function clearBookReadingSettings(args: BookIdArgs): Promise<void> {
  return invoke<void>('clear_book_reading_settings', args).catch(mapError);
}

export async function listSeries(): Promise<Series[]> {
  return invoke<Series[]>('list_series').catch(mapError);
}

export async function createSeries(args: CreateSeriesArgs): Promise<Series> {
  return invoke<Series>('create_series', args).catch(mapError);
}

export async function updateSeries(args: UpdateSeriesArgs): Promise<Series> {
  return invoke<Series>('update_series', args).catch(mapError);
}

export async function deleteSeries(args: SeriesIdArgs): Promise<void> {
  return invoke<void>('delete_series', args).catch(mapError);
}

export async function setBookSeries(args: BookSeriesArgs): Promise<BookSeries> {
  return invoke<BookSeries>('set_book_series', args).catch(mapError);
}

export async function clearBookSeries(args: BookIdArgs): Promise<void> {
  return invoke<void>('clear_book_series', args).catch(mapError);
}

export async function reorderSeriesBooks(args: ReorderSeriesArgs): Promise<BookSeries[]> {
  return invoke<BookSeries[]>('reorder_series_books', args).catch(mapError);
}

export async function listTagGroups(): Promise<TagGroup[]> {
  return invoke<TagGroup[]>('list_tag_groups').catch(mapError);
}

export async function createTagGroup(args: CreateTagGroupArgs): Promise<TagGroup> {
  return invoke<TagGroup>('create_tag_group', args).catch(mapError);
}

export async function updateTagGroup(args: UpdateTagGroupArgs): Promise<TagGroup> {
  return invoke<TagGroup>('update_tag_group', args).catch(mapError);
}

export async function deleteTagGroup(args: TagGroupIdArgs): Promise<void> {
  return invoke<void>('delete_tag_group', args).catch(mapError);
}

export async function listTags(): Promise<Tag[]> {
  return invoke<Tag[]>('list_tags').catch(mapError);
}

export async function createTag(args: CreateTagArgs): Promise<Tag> {
  return invoke<Tag>('create_tag', args).catch(mapError);
}

export async function updateTag(args: UpdateTagArgs): Promise<Tag> {
  return invoke<Tag>('update_tag', args).catch(mapError);
}

export async function deleteTag(args: TagIdArgs): Promise<void> {
  return invoke<void>('delete_tag', args).catch(mapError);
}

export async function setBookTags(args: SetBookTagsArgs): Promise<BookTag[]> {
  return invoke<BookTag[]>('set_book_tags', args).catch(mapError);
}

export async function setSeriesTags(args: SetSeriesTagsArgs): Promise<void> {
  return invoke<void>('set_series_tags', args).catch(mapError);
}

export async function listBookTags(args: BookIdArgs): Promise<BookTag[]> {
  return invoke<BookTag[]>('list_book_tags', args).catch(mapError);
}

export async function ensureSeriesSearchIndex(
  args: SearchIndexSeriesArgs,
): Promise<SearchTaskStatus> {
  return invoke<SearchTaskStatus>('ensure_series_search_index', args).catch(mapError);
}

export async function getSearchIndexStatus(
  args: SearchIndexSeriesArgs,
): Promise<SearchIndexStatus> {
  return invoke<SearchIndexStatus>('get_search_index_status', args).catch(mapError);
}

export async function cancelSearchIndex(args: CancelSearchArgs): Promise<void> {
  return invoke<void>('cancel_search_index', args).catch(mapError);
}

export async function searchSeries(args: SearchSeriesArgs): Promise<SearchResult[]> {
  return invoke<SearchResult[]>('search_series', args).catch(mapError);
}

export async function rebuildSearchIndex(
  args: SearchIndexSeriesArgs,
): Promise<SearchTaskStatus> {
  return invoke<SearchTaskStatus>('rebuild_search_index', args).catch(mapError);
}

export async function saveGlobalReadingSettings(
  settings: ReadingSettingsInput,
): Promise<ReadingSettings> {
  const args: GlobalSettingsArgs = { settings };
  return invoke<ReadingSettings>('save_global_reading_settings', args).catch(mapError);
}

export { mapError };
