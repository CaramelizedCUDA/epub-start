import { createRelocatedHandler } from '../features/reader/engine/navigation';
import { searchBookChapters } from '../features/reader/engine/search';
import {
  createEpubBook,
  createRendition,
  destroyEpubBook,
  destroyRendition,
  withBookTimeout,
  installProgressLifecycle,
} from '../features/reader/engine/lifecycle';
import { create } from 'zustand';
import type { Book, Rendition, TocItem } from 'epubjs';
import {
  createNote as createNoteIpc,
  deleteNote as deleteNoteIpc,
  getReadingProgress,
  listNotes,
  saveReadingProgress,
  updateNote as updateNoteIpc,
} from '../lib/tauri';
import type {
  CreateNoteInput,
  Note,
  ReadingSettings,
  UpdateNoteInput,
} from '../types/models';
import {
  renderHighlight,
  removeHighlight,
  type HighlightMarkClick,
  type SelectionInfo,
} from '../features/reader/engine/highlights';
import {
  captureReflowAnchor,
  rememberReflowAnchor,
  clearFirstLineOffset,
  exitWindowFullscreen,
  installContinuousScrollStabilizer,
  preserveAndReflow,
  resizeToViewport,
  restoreFirstVisibleLine,
  settleInitialPagination,
  waitForRenditionReady,
  toggleWindowFullscreen,
} from '../features/reader/engine/reflow';

// ── Module-level timer state ────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_THROTTLE_MS = 3000;

/// Saved reference to the `relocated` handler so we can call `off()` on close.
let relocatedHandler: ((...args: unknown[]) => void) | null = null;
let continuousScrollCleanup: (() => void) | null = null;
let readerSession = 0;
let settingsApplyQueue: Promise<void> = Promise.resolve();
let initialDisplay: { sessionId: number; ready: Promise<void>; finish: () => void; retire: () => void } | null = null;
let searchRequest = 0;
let notesRequest = 0;
let notesRevision = 0;
let progressLifecycleCleanup: (() => void) | null = null;
const progressWrites = new Map<string, Promise<void>>();

function queuedSaveReadingProgress(args: Parameters<typeof saveReadingProgress>[0]): Promise<void> {
  const previous = progressWrites.get(args.bookId);
  // Start an idle book's write immediately. Only writes to that book are serialized.
  const write = previous
    ? previous.catch(() => undefined).then(() => saveReadingProgress(args))
    : saveReadingProgress(args);
  const pending = write.then(() => undefined);
  progressWrites.set(args.bookId, pending);
  const release = () => {
    if (progressWrites.get(args.bookId) === pending) progressWrites.delete(args.bookId);
  };
  void pending.then(release, release);
  return pending;
}

function throttledSave(bookId: string, cfi: string, progression: number) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    queuedSaveReadingProgress({
      bookId,
      locationCfi: cfi,
      progression,
    }).catch((err: unknown) => {
      console.error('Failed to save reading progress:', err);
    });
    saveTimer = null;
  }, SAVE_THROTTLE_MS);
}

function flushPendingProgress(
  bookId: string | null,
  currentCfi: string | null,
  currentPage: number,
  totalPages: number,
  errorLabel: string,
): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (bookId && currentCfi) {
      queuedSaveReadingProgress({
        bookId,
        locationCfi: currentCfi,
        progression: totalPages > 0 ? currentPage / totalPages : 0,
      }).catch((err: unknown) => {
        console.error(errorLabel, err);
      });
    }
  }
}

// ── Store ──────────────────────────────────────────────────────

interface ReaderState {
  bookId: string | null;
  epubRootUrl: string | null;
  book: Book | null;
  rendition: Rendition | null;
  currentCfi: string | null;
  currentPage: number;
  totalPages: number;
  toc: TocItem[];
  currentChapterHref: string | null;
  searchResults: Array<{ href: string; excerpt: string }>;
  isSearching: boolean;
  hasSearched: boolean;
  searchError: string | null;
  searchLimited: boolean;
  isLoading: boolean;
  error: string | null;
  readingSettings: ReadingSettings | null;
  notes: Note[];
  pendingSelection: SelectionInfo | null;
  clickedNote: HighlightMarkClick | null;

  open: (
    bookId: string,
    epubRootUrl: string,
    settings: ReadingSettings,
    initialHref?: string,
  ) => Promise<void>;
  close: () => void;
  flushProgress: () => Promise<void>;
  nextPage: () => void;
  prevPage: () => void;
  goToCfi: (cfi: string) => void;
  goToHref: (href: string) => void;
  searchCurrentBook: (query: string) => Promise<void>;
  applyReadingSettings: (settings: ReadingSettings) => Promise<void>;
  reflowViewport: () => Promise<void>;
  toggleFullscreen: () => Promise<boolean>;
  exitFullscreen: () => Promise<boolean>;
  loadNotes: () => Promise<void>;
  setPendingSelection: (selection: SelectionInfo | null) => void;
  setClickedNote: (click: HighlightMarkClick | null) => void;
  addNote: (input: CreateNoteInput) => Promise<Note>;
  editNote: (input: UpdateNoteInput) => Promise<Note>;
  removeNote: (noteId: string) => Promise<void>;
  jumpToNote: (noteId: string) => void;
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  bookId: null,
  epubRootUrl: null,
  book: null,
  rendition: null,
  currentCfi: null,
  currentPage: 0,
  totalPages: 0,
  toc: [],
  currentChapterHref: null,
  searchResults: [],
  isSearching: false,
  hasSearched: false,
  searchError: null,
  searchLimited: false,
  isLoading: false,
  error: null,
  readingSettings: null,
  notes: [],
  pendingSelection: null,
  clickedNote: null,

  open: async (
    bookId: string,
    epubRootUrl: string,
    settings: ReadingSettings,
    initialHref?: string,
  ) => {
    const sessionId = ++readerSession;
    initialDisplay?.retire();
    initialDisplay?.finish();
    let finishInitialDisplay = () => {};
    const opening = {
      sessionId,
      ready: new Promise<void>((resolve) => { finishInitialDisplay = resolve; }),
      finish: () => finishInitialDisplay(),
      retire: () => {},
    };
    initialDisplay = opening;
    ++searchRequest;
    ++notesRequest;
    ++notesRevision;
    progressLifecycleCleanup?.();
    progressLifecycleCleanup = null;
    const prev = get();
    flushPendingProgress(
      prev.bookId,
      prev.currentCfi,
      prev.currentPage,
      prev.totalPages,
      'Failed to flush reading progress before opening a new book:',
    );
    if (prev.rendition && relocatedHandler) {
      prev.rendition.off('relocated', relocatedHandler);
    }
    continuousScrollCleanup?.();
    continuousScrollCleanup = null;
    relocatedHandler = null;
    destroyRendition(prev.rendition);
    destroyEpubBook(prev.book);
    settingsApplyQueue = Promise.resolve();

    set({
      isLoading: true,
      error: null,
      bookId,
      epubRootUrl,
      book: null,
      rendition: null,
      currentCfi: null,
      currentPage: 0,
      totalPages: 0,
      toc: [],
      currentChapterHref: null,
      searchResults: [],
      isSearching: false,
      hasSearched: false,
      searchError: null,
      searchLimited: false,
      readingSettings: settings,
      notes: [],
      pendingSelection: null,
      clickedNote: null,
    });

    let book: Book | null = null;
    let rendition: Rendition | null = null;
    let sessionRelocatedHandler: ((...args: unknown[]) => void) | null = null;
    const isCurrentSession = () => (
      sessionId === readerSession
      && get().bookId === bookId
      && (rendition === null || get().rendition === rendition)
    );
    const shouldDestroyBook = () => (
      sessionId !== readerSession
      || get().bookId !== bookId
      || get().book !== book
    );
    const disposeSessionResources = (destroyBook = true) => {
      if (rendition && sessionRelocatedHandler) {
        rendition.off('relocated', sessionRelocatedHandler);
      }
      destroyRendition(rendition);
      if (destroyBook) destroyEpubBook(book);
      if (relocatedHandler === sessionRelocatedHandler) {
        relocatedHandler = null;
      }
      sessionRelocatedHandler = null;
    };

    try {
      book = createEpubBook(epubRootUrl);
      opening.retire = () => destroyEpubBook(book);

      await withBookTimeout(book.open(epubRootUrl), `Opening ${epubRootUrl}`);

      if (sessionId !== readerSession) {
        disposeSessionResources(shouldDestroyBook());
        return;
      }

      await withBookTimeout(book.ready, `Parsing ${epubRootUrl}`);

      if (sessionId !== readerSession) {
        disposeSessionResources(shouldDestroyBook());
        return;
      }

      rendition = createRendition(book, settings);

      sessionRelocatedHandler = createRelocatedHandler(
        () => get().toc,
        (location) => set(location),
        isCurrentSession,
        (cfi, progression) => throttledSave(bookId, cfi, progression),
      );
      relocatedHandler = sessionRelocatedHandler;

      rendition.on('relocated', sessionRelocatedHandler);

      set({ book, rendition });
      set({ toc: book.navigation?.toc ?? [] });

      // A -> B -> A must not read SQLite before A's exit write finishes.
      // A failed read is not "no saved progress": do not display/save a default page.
      await withBookTimeout(
        progressWrites.get(bookId) ?? Promise.resolve(),
        'Saving prior reading progress',
      );
      if (!isCurrentSession()) {
        disposeSessionResources(shouldDestroyBook());
        return;
      }
      const saved = await withBookTimeout(getReadingProgress({ bookId }), 'Reading saved progress');
      if (!isCurrentSession()) {
        disposeSessionResources(shouldDestroyBook());
        return;
      }

      try {
        if (initialHref || saved?.location_cfi) {
          await rendition.display(initialHref || saved?.location_cfi || undefined);
          if (!isCurrentSession()) {
            disposeSessionResources(shouldDestroyBook());
            return;
          }
        } else {
          await rendition.display();
          if (!isCurrentSession()) {
            disposeSessionResources(shouldDestroyBook());
            return;
          }
        }
      } catch (err) {
        throw new Error(
          `BOOK_DISPLAY_FAILED: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      await settleInitialPagination(rendition, settings);

      if (!isCurrentSession()) {
        disposeSessionResources(shouldDestroyBook());
        return;
      }

      if (settings.flow === 'scrolled') {
        continuousScrollCleanup = installContinuousScrollStabilizer(rendition);
      }
      progressLifecycleCleanup = installProgressLifecycle(
        () => get().flushProgress(),
        () => sessionId === readerSession && get().bookId === bookId,
      );
      set({ isLoading: false });
    } catch (err) {
      if (!isCurrentSession()) {
        disposeSessionResources(shouldDestroyBook());
        return;
      }
      disposeSessionResources();

      if (get().book === book || get().rendition === rendition) {
        set({ book: null, rendition: null });
      }

      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      opening.finish();
      if (initialDisplay === opening) initialDisplay = null;
    }
  },

  close: () => {
    ++readerSession;
    initialDisplay?.retire();
    initialDisplay?.finish();
    initialDisplay = null;
    ++searchRequest;
    ++notesRequest;
    ++notesRevision;
    progressLifecycleCleanup?.();
    progressLifecycleCleanup = null;
    const { rendition, book, bookId, currentCfi } = get();
    const { currentPage, totalPages } = get();
    settingsApplyQueue = Promise.resolve();

    // Flush pending progress save
    flushPendingProgress(
      bookId,
      currentCfi,
      currentPage,
      totalPages,
      'Failed to flush reading progress on close:',
    );

    // Remove event listener with saved reference
    if (rendition && relocatedHandler) {
      rendition.off('relocated', relocatedHandler);
    }
    continuousScrollCleanup?.();
    continuousScrollCleanup = null;
    relocatedHandler = null;

    destroyRendition(rendition);
    destroyEpubBook(book);

    set({
      bookId: null,
      epubRootUrl: null,
      book: null,
      rendition: null,
      currentCfi: null,
      currentPage: 0,
      totalPages: 0,
      toc: [],
      currentChapterHref: null,
      searchResults: [],
      isSearching: false,
      hasSearched: false,
      searchError: null,
      searchLimited: false,
      isLoading: false,
      error: null,
      readingSettings: null,
      notes: [],
      pendingSelection: null,
      clickedNote: null,
    });
  },

  flushProgress: async () => {
    const state = get();
    flushPendingProgress(
      state.bookId,
      state.currentCfi,
      state.currentPage,
      state.totalPages,
      'Failed to flush reading progress on suspend:',
    );
    if (state.bookId) await progressWrites.get(state.bookId);
  },

  nextPage: () => {
    const { rendition } = get();
    if (rendition) {
      clearFirstLineOffset(rendition);
      rendition.next();
    }
  },

  prevPage: () => {
    const { rendition } = get();
    if (rendition) {
      clearFirstLineOffset(rendition);
      rendition.prev();
    }
  },

  goToCfi: (cfi: string) => {
    const { rendition } = get();
    if (rendition) {
      clearFirstLineOffset(rendition);
      rendition.display(cfi).catch((err: unknown) => {
        console.error('Failed to navigate to CFI:', cfi, err);
      });
    }
  },

  goToHref: (href: string) => {
    const { rendition } = get();
    if (rendition) {
      clearFirstLineOffset(rendition);
      rendition.display(href).catch((err: unknown) => console.error('Failed to navigate to href:', err));
    }
  },

  searchCurrentBook: async (query: string) => {
    const requestId = ++searchRequest;
    const sessionId = readerSession;
    const { book, bookId } = get();
    const needle = query.trim();
    const isActive = () => (
      requestId === searchRequest
      && sessionId === readerSession
      && get().bookId === bookId
      && get().book === book
    );
    set({ searchResults: [], searchError: null, searchLimited: false, isSearching: false, hasSearched: false });
    if (!book || needle.length < 2) return;
    set({ isSearching: true, hasSearched: true });
    try {
      const result = await searchBookChapters(book, needle, isActive);
      if (!isActive()) return;
      set({
        searchResults: result.hits,
        searchLimited: result.limited,
        searchError: result.failedChapters > 0
          ? `${result.failedChapters} 个章节读取失败；仅显示已读取章节的结果，可重试。`
          : null,
      });
    } catch (err) {
      if (isActive()) set({ searchError: err instanceof Error ? err.message : String(err) });
    } finally {
      if (isActive()) set({ isSearching: false });
    }
  },

  applyReadingSettings: (settings: ReadingSettings) => {
    const sessionId = readerSession;
    const run = settingsApplyQueue
      .catch(() => undefined)
      .then(async () => {
        if (sessionId !== readerSession) return;
        // Rebuilding while the saved CFI is still loading would retire the
        // only rendition the opening operation can restore into.
        if (initialDisplay?.sessionId === sessionId) await initialDisplay.ready;
        if (sessionId !== readerSession) return;
        const {
          rendition,
          book,
          bookId,
          currentCfi,
          currentPage,
          totalPages,
          readingSettings,
        } = get();
        if (!rendition || sessionId !== readerSession) return;
        const isCurrentTarget = () => (
          sessionId === readerSession
          && get().bookId === bookId
          && get().rendition === rendition
        );
        if (!isCurrentTarget()) return;
        set({ readingSettings: settings });

        if (bookId && currentCfi) {
          await queuedSaveReadingProgress({
            bookId,
            locationCfi: currentCfi,
            progression: totalPages > 0 ? currentPage / totalPages : 0,
          });
          if (!isCurrentTarget()) return;
        }

        const previousFlow = readingSettings?.flow ?? 'paginated';
        if (book && previousFlow !== settings.flow) {
          if (!isCurrentTarget()) return;
          const firstVisibleLine = await captureReflowAnchor(rendition);
          if (!isCurrentTarget()) return;
          clearFirstLineOffset(rendition);
          continuousScrollCleanup?.();
          continuousScrollCleanup = null;
          if (relocatedHandler) rendition.off('relocated', relocatedHandler);
          relocatedHandler = null;
          destroyRendition(rendition);

          const replacement = createRendition(book, settings);
          let replacementHandler: ((...args: unknown[]) => void) | null = null;
          const isCurrentReplacement = () => (
            sessionId === readerSession
            && get().bookId === bookId
            && get().rendition === replacement
          );
          const disposeReplacement = () => {
            if (replacementHandler) replacement.off('relocated', replacementHandler);
            destroyRendition(replacement);
            if (relocatedHandler === replacementHandler) relocatedHandler = null;
            replacementHandler = null;
          };
          replacementHandler = createRelocatedHandler(
            () => get().toc,
            (location) => set(location),
            isCurrentReplacement,
            (cfi, progression) => throttledSave(bookId ?? '', cfi, progression),
          );
          relocatedHandler = replacementHandler;
          replacement.on('relocated', replacementHandler);
          // React must not attach ready-only interactions while EPUB.js is
          // still creating the replacement manager and its first iframe.
          set({ rendition: replacement, isLoading: true });
          try {
            await replacement.display(firstVisibleLine?.cfi ?? currentCfi ?? undefined);
            if (!isCurrentReplacement()) {
              disposeReplacement();
              return;
            }
            await waitForRenditionReady(replacement);
            if (!isCurrentReplacement()) {
              disposeReplacement();
              return;
            }
            if (firstVisibleLine) {
              await waitForReaderLayout();
              if (!isCurrentReplacement()) {
                disposeReplacement();
                return;
              }
              restoreFirstVisibleLine(replacement, firstVisibleLine);
              await rememberReflowAnchor(replacement, firstVisibleLine);
            }
            if (settings.flow === 'scrolled') {
              if (!isCurrentReplacement()) {
                disposeReplacement();
                return;
              }
              continuousScrollCleanup = installContinuousScrollStabilizer(replacement);
            }
            if (!isCurrentReplacement()) {
              disposeReplacement();
              return;
            }
            renderNotesIn(replacement, get().notes, settings.theme, (click) => {
              if (isCurrentReplacement()) set({ clickedNote: click });
            });
          } catch (err) {
            if (isCurrentReplacement()) set({ error: err instanceof Error ? err.message : String(err) });
            throw err;
          } finally {
            if (isCurrentReplacement()) set({ isLoading: false });
          }
          return;
        }

        await preserveAndReflow(
          rendition,
          () => resizeToViewport(rendition, settings),
          {
            restoreTheme: true,
            settings,
            preserveTextAnchor: true,
          },
        );
        if (!isCurrentTarget()) return;
        renderNotesIn(rendition, get().notes, settings.theme, (click) => {
          if (isCurrentTarget()) set({ clickedNote: click });
        });
      });
    settingsApplyQueue = run;
    return run;
  },

  reflowViewport: async () => {
    const { rendition, readingSettings } = get();
    if (!rendition) return;
    await preserveAndReflow(
      rendition,
      () => resizeToViewport(rendition, readingSettings),
      {
        restoreTheme: true,
        settings: readingSettings,
        preserveTextAnchor: true,
      },
    );
  },

  toggleFullscreen: async () => {
    const { rendition, readingSettings } = get();
    if (!rendition) return false;
    return toggleWindowFullscreen(rendition, readingSettings);
  },

  exitFullscreen: async () => {
    const { rendition, readingSettings } = get();
    if (!rendition) return false;
    return exitWindowFullscreen(rendition, readingSettings);
  },

  loadNotes: async () => {
    const requestId = ++notesRequest;
    const revision = notesRevision;
    const sessionId = readerSession;
    const { bookId } = get();
    if (!bookId) return;
    let notes: Note[];
    try {
      notes = await listNotes({ bookId });
    } catch (err) {
      if (
        sessionId !== readerSession
        || requestId !== notesRequest
        || revision !== notesRevision
        || get().bookId !== bookId
      ) {
        return;
      }
      throw err;
    }
    if (
      sessionId !== readerSession
      || requestId !== notesRequest
      || revision !== notesRevision
      || get().bookId !== bookId
    ) {
      return;
    }
    set({ notes });
    const rendition = get().rendition;
    const theme = get().readingSettings?.theme ?? null;
    if (
      rendition
      && sessionId === readerSession
      && get().bookId === bookId
      && get().rendition === rendition
    ) {
      renderNotesIn(rendition, notes, theme, (click) => {
        if (sessionId === readerSession && get().rendition === rendition) set({ clickedNote: click });
      });
    }
  },

  setPendingSelection: (selection) => set({ pendingSelection: selection }),

  setClickedNote: (click) => set({ clickedNote: click }),

  addNote: async (input) => {
    const sessionId = readerSession;
    const note = await createNoteIpc({ note: input });
    if (sessionId !== readerSession || get().bookId !== note.book_id) return note;
    ++notesRevision;
    set((state) => ({ notes: [...state.notes.filter((item) => item.id !== note.id), note] }));
    const rendition = get().rendition;
    if (rendition) {
      renderHighlight(rendition, note, get().readingSettings?.theme ?? null, (click) => {
        if (sessionId === readerSession && get().rendition === rendition) set({ clickedNote: click });
      });
    }
    return note;
  },

  editNote: async (input) => {
    const sessionId = readerSession;
    const previous = get().notes.find((note) => note.id === input.id);
    const note = await updateNoteIpc({ note: input });
    if (sessionId !== readerSession || get().bookId !== note.book_id) return note;
    ++notesRevision;
    set((state) => ({
      notes: state.notes.map((existing) => (existing.id === note.id ? note : existing)),
    }));
    const rendition = get().rendition;
    if (rendition) {
      if (previous?.cfi_range && previous.cfi_range !== note.cfi_range) {
        removeHighlight(rendition, previous.cfi_range);
      }
      renderHighlight(rendition, note, get().readingSettings?.theme ?? null, (click) => {
        if (sessionId === readerSession && get().rendition === rendition) set({ clickedNote: click });
      });
    }
    return note;
  },

  removeNote: async (noteId) => {
    const sessionId = readerSession;
    const { bookId, notes } = get();
    const existing = notes.find((note) => note.id === noteId);
    await deleteNoteIpc(noteId);
    if (sessionId !== readerSession || get().bookId !== bookId) return;
    ++notesRevision;
    const rendition = get().rendition;
    if (existing?.cfi_range && rendition) removeHighlight(rendition, existing.cfi_range);
    set((state) => ({
      notes: state.notes.filter((note) => note.id !== noteId),
      clickedNote: state.clickedNote?.noteId === noteId ? null : state.clickedNote,
    }));
  },

  jumpToNote: (noteId) => {
    const { rendition, notes } = get();
    const note = notes.find((item) => item.id === noteId);
    if (!rendition || !note) return;
    clearFirstLineOffset(rendition);
    rendition.display(note.cfi_start).catch((err: unknown) => {
      console.error('Failed to jump to note:', noteId, err);
    });
  },
}));

function waitForReaderLayout(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

/** 把当前批注列表渲染到指定 Rendition；单个标记失败不影响其余批注。 */
function renderNotesIn(
  rendition: Rendition,
  notes: Note[],
  theme: ReadingSettings['theme'] | null,
  onMarkClick: (click: HighlightMarkClick) => void,
): void {
  for (const note of notes) {
    try {
      renderHighlight(rendition, note, theme, onMarkClick);
    } catch (err) {
      console.error('Failed to render highlight for note:', note.id, err);
    }
  }
}
