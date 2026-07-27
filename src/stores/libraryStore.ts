import { create } from 'zustand';
import type { BookSummary } from '../types/models';
import {
  selectEpubSources,
  importBook,
  listBooks,
  relocateBook,
  deleteBook,
} from '../lib/tauri';

interface LibraryState {
  books: BookSummary[];
  isLoading: boolean;
  error: string | null;

  loadBooks: () => Promise<void>;
  importFromDialog: () => Promise<void>;
  relocateSource: (bookId: string) => Promise<void>;
  removeBook: (bookId: string) => Promise<void>;
  clearError: () => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  isLoading: false,
  error: null,

  loadBooks: async () => {
    set({ isLoading: true, error: null });
    try {
      const books = await listBooks();
      set({ books, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: userFacingError(err),
      });
    }
  },

  importFromDialog: async () => {
    set({ isLoading: true, error: null });
    try {
      const sources = await selectEpubSources();
      if (sources.length === 0) {
        set({ isLoading: false });
        return; // user cancelled
      }
      for (const source of sources) {
        try {
          await importBook({ source });
        } catch (importErr) {
          const msg =
            importErr instanceof Error ? importErr.message : String(importErr);
          // If it's a controlled error (BOOK_PARSE_FAILED), still refresh shelf
          if (!msg.startsWith('BOOK_PARSE_FAILED:')) {
            set({ error: userFacingError(msg), isLoading: false });
            return;
          }
        }
      }
      // Refresh shelf after all imports
      await get().loadBooks();
    } catch (err) {
      set({
        isLoading: false,
        error: userFacingError(err),
      });
    }
  },

  relocateSource: async (bookId) => {
    set({ isLoading: true, error: null });
    try {
      const sources = await selectEpubSources();
      if (sources.length === 0) {
        set({ isLoading: false });
        return;
      }
      await relocateBook({ bookId, source: sources[0] });
      await get().loadBooks();
    } catch (err) {
      set({ isLoading: false, error: userFacingError(err) });
    }
  },

  clearError: () => set({ error: null }),

  removeBook: async (bookId) => {
    set({ isLoading: true, error: null });
    try {
      await deleteBook({ bookId });
      // Remove from local shelf immediately — no full reload needed.
      set((state) => ({
        books: state.books.filter((b) => b.id !== bookId),
        isLoading: false,
      }));
    } catch (err) {
      set({ isLoading: false, error: userFacingError(err) });
    }
  },
}));

function userFacingError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith('SAF_PERMISSION_DENIED:')) {
    return '无法保留 Android 文件读取权限，请重新选择 EPUB，并确认文件提供方允许持续访问。';
  }
  if (message.startsWith('BOOK_RELOCATION_MISMATCH:')) {
    return '所选 EPUB 与原书籍不匹配，请重新选择正确的文件。';
  }
  return message;
}
