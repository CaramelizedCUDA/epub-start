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

export const useLibraryStore = create<LibraryState>((set, get) => {
  // Each operation owns one slot until its complete async chain finishes. A
  // refresh started by import/relocate therefore cannot clear the loading
  // state belonging to the outer operation.
  let activeOperations = 0;
  let nextOperationId = 0;
  let latestOperationId = 0;
  let latestListRequestId = 0;
  let latestErrorOperationId = 0;

  const beginOperation = () => {
    const operationId = ++nextOperationId;
    latestOperationId = operationId;
    latestErrorOperationId = operationId;
    activeOperations += 1;
    set({ isLoading: true, error: null });
    return operationId;
  };

  const finishOperation = () => {
    activeOperations = Math.max(0, activeOperations - 1);
    set({ isLoading: activeOperations > 0 });
  };

  const setOperationError = (operationId: number, error: unknown) => {
    if (operationId !== latestOperationId || operationId < latestErrorOperationId) return;
    set({ error: userFacingError(error) });
  };

  return {
    books: [],
    isLoading: false,
    error: null,

    loadBooks: async () => {
      const operationId = beginOperation();
      const requestId = ++latestListRequestId;
      try {
        const books = await listBooks();
        // Only the newest list request may replace shelf data. Older requests
        // can finish after a retry or a mutation-triggered refresh.
        if (requestId === latestListRequestId) {
          set({ books });
        }
      } catch (err) {
        if (requestId === latestListRequestId) {
          setOperationError(operationId, err);
        }
      } finally {
        finishOperation();
      }
    },

    importFromDialog: async () => {
      const operationId = beginOperation();
      try {
        const sources = await selectEpubSources();
        if (sources.length === 0) return; // user cancelled

        for (const source of sources) {
          try {
            await importBook({ source });
          } catch (importErr) {
            const msg = importErr instanceof Error ? importErr.message : String(importErr);
            // A parse failure is persisted as an error-status book. Continue
            // through the selection so the shelf can show it and offer retry.
            if (msg.startsWith('BOOK_PARSE_FAILED:')) continue;
            throw importErr;
          }
        }
        // Refresh shelf after all imports. loadBooks owns its own request slot
        // and keeps the outer import operation active until it finishes.
        await get().loadBooks();
      } catch (err) {
        setOperationError(operationId, err);
      } finally {
        finishOperation();
      }
    },

    relocateSource: async (bookId) => {
      const operationId = beginOperation();
      try {
        const sources = await selectEpubSources();
        if (sources.length === 0) return;
        await relocateBook({ bookId, source: sources[0] });
        await get().loadBooks();
      } catch (err) {
        setOperationError(operationId, err);
      } finally {
        finishOperation();
      }
    },

    clearError: () => {
      // Prevent an already-running operation from resurfacing a dismissed
      // error; the next operation receives a newer generation.
      latestErrorOperationId = latestOperationId + 1;
      set({ error: null });
    },

    removeBook: async (bookId) => {
      const operationId = beginOperation();
      try {
        await deleteBook({ bookId });
        // Remove from local shelf immediately, then refresh so an older
        // in-flight list response cannot reintroduce the deleted card.
        set((state) => ({
          books: state.books.filter((b) => b.id !== bookId),
        }));
        await get().loadBooks();
      } catch (err) {
        setOperationError(operationId, err);
      } finally {
        finishOperation();
      }
    },
  };
});

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
