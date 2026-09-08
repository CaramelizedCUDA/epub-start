import { create } from 'zustand';
import ePub from 'epubjs';
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
  captureFirstVisibleLine,
  clearFirstLineOffset,
  exitWindowFullscreen,
  injectReadingTheme,
  installContinuousScrollStabilizer,
  preserveAndReflow,
  readerViewportGeometry,
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

type ReaderLocationUpdate = Pick<
  ReaderState,
  'currentCfi' | 'currentPage' | 'totalPages' | 'currentChapterHref'
>;

function throttledSave(bookId: string, cfi: string, progression: number) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveReadingProgress({
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
      saveReadingProgress({
        bookId,
        locationCfi: currentCfi,
        progression: totalPages > 0 ? currentPage / totalPages : 0,
      }).catch((err: unknown) => {
        console.error(errorLabel, err);
      });
    }
  }
}

// ── EPUB.js request helpers ────────────────────────────────────

const BOOK_OPEN_TIMEOUT_MS = 30_000;

function normalizeEpubRequestUrl(url: string, epubRootUrl: string): string {
  const httpEpubOrigin = /^https?:\/\/epub\.localhost\//.test(epubRootUrl)
    ? epubRootUrl.match(/^https?:\/\/epub\.localhost/)?.[0] ?? null
    : null;

  if (httpEpubOrigin) {
    const nativeEpubPath = url.match(/^epub:\/{2,3}localhost(\/.*)$/);
    if (nativeEpubPath) {
      return `${httpEpubOrigin}${nativeEpubPath[1]}`;
    }
    if (url.startsWith('null/')) {
      return `${httpEpubOrigin}/${url.slice('null/'.length)}`;
    }
  }

  if (url.startsWith('epub://') || url.startsWith('http://epub.localhost/')) {
    return url;
  }
  if (url.startsWith('null/')) {
    const rootOrigin = epubRootUrl.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/)?.[0];
    if (rootOrigin) return `${rootOrigin}/${url.slice('null/'.length)}`;
  }

  return `${epubRootUrl}${url}`;
}

function loadTimeout(label: string): Promise<never> {
  return new Promise((_, reject) => {
    window.setTimeout(() => {
      reject(new Error(`BOOK_LOAD_TIMEOUT: ${label} exceeded 30 seconds`));
    }, BOOK_OPEN_TIMEOUT_MS);
  });
}

function parseEpubResponse(
  body: string,
  type: string,
  contentType: string,
): Document | string {
  if (type === 'xhtml') {
    return new DOMParser().parseFromString(body, 'application/xhtml+xml');
  }

  if (
    type === 'xml' ||
    type === 'opf' ||
    type === 'ncx' ||
    contentType.includes('xml')
  ) {
    return new DOMParser().parseFromString(body, 'application/xml');
  }

  if (type === 'html' || type === 'htm') {
    return new DOMParser().parseFromString(body, 'text/html');
  }

  return body;
}

function createRendition(book: Book, settings: ReadingSettings | null): Rendition {
  const scrolled = settings?.flow === 'scrolled';
  const geometry = readerViewportGeometry(settings);
  const rendition = book.renderTo('epub-reader-viewport', {
    width: geometry?.width ?? '100%',
    height: geometry?.height ?? '100%',
    manager: scrolled ? 'continuous' : 'default',
    flow: scrolled ? 'scrolled' : 'paginated',
    spread: scrolled ? 'none' : geometry?.spread ?? normalizeSpread(settings?.spread ?? 'auto'),
    gap: scrolled ? 0 : geometry?.gap,
  });
  if (settings) injectReadingTheme(rendition, settings);
  return rendition;
}

function createRelocatedHandler(
  bookId: string,
  readToc: () => TocItem[],
  update: (location: ReaderLocationUpdate) => void,
  isActive: () => boolean,
): (...args: unknown[]) => void {
  return (location: unknown) => {
    if (!isActive()) return;
    const loc = location as {
      start: { cfi: string; href: string; displayed: { page: number; total: number } };
    };
    const cfi = loc.start.cfi;
    const page = loc.start.displayed.page;
    const total = loc.start.displayed.total;
    const progression = total > 0 ? page / total : 0;

    update({
      currentCfi: cfi,
      currentPage: page,
      totalPages: total,
      currentChapterHref: resolveCurrentChapterHref(readToc(), loc.start.href),
    });
    if (!isActive()) return;
    throttledSave(bookId, cfi, progression);
  };
}

function normalizeSpread(spread: ReadingSettings['spread']): 'none' | 'auto' | 'both' {
  return spread === 'always' ? 'both' : spread;
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
  ) => Promise<void>;
  close: () => void;
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
  ) => {
    const sessionId = ++readerSession;
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
    if (prev.rendition) prev.rendition.destroy();
    if (prev.book) prev.book.destroy();
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
      rendition?.destroy();
      if (destroyBook) book?.destroy();
      if (relocatedHandler === sessionRelocatedHandler) {
        relocatedHandler = null;
      }
      sessionRelocatedHandler = null;
    };

    try {
      book = ePub({
        requestMethod: async (url: string, type: string) => {
          // EPUB.js can lose the origin for non-standard schemes and hand
          // back `null/...`, `epub://localhost/...`, or
          // `epub:///localhost/...`. On Android/Windows Tauri maps this
          // protocol through the HTTP localhost origin, so normalize those
          // forms before Fetch sees them.
          const finalUrl = normalizeEpubRequestUrl(url, epubRootUrl);

          const response = await fetch(finalUrl);
          const mime = response.headers.get('content-type') ?? '';

          if (!response.ok) {
            throw new Error(
              `BOOK_RESOURCE_FAILED: url=${finalUrl}; status=${response.status}; mime=${mime}`,
            );
          }

          if (type === 'binary' || type === 'blob') {
            return response.arrayBuffer();
          }

          const body = await response.text();
          return parseEpubResponse(body, type, mime);
        },
      });

      await Promise.race([
        book.open(epubRootUrl),
        loadTimeout(`Opening ${epubRootUrl}`),
      ]);

      if (sessionId !== readerSession) {
        disposeSessionResources(shouldDestroyBook());
        return;
      }

      await Promise.race([
        book.ready,
        loadTimeout(`Parsing ${epubRootUrl}`),
      ]);

      if (sessionId !== readerSession) {
        disposeSessionResources(shouldDestroyBook());
        return;
      }

      rendition = createRendition(book, settings);

      sessionRelocatedHandler = createRelocatedHandler(
        bookId,
        () => get().toc,
        (location) => set(location),
        isCurrentSession,
      );
      relocatedHandler = sessionRelocatedHandler;

      rendition.on('relocated', sessionRelocatedHandler);

      set({ book, rendition });
      set({ toc: book.navigation?.toc ?? [] });

      // Always display content first, then restore saved position if available
      const saved = await getReadingProgress({ bookId }).catch(() => null);
      if (!isCurrentSession()) {
        disposeSessionResources(shouldDestroyBook());
        return;
      }

      try {
        if (saved?.location_cfi) {
          await rendition.display(saved.location_cfi);
          if (!isCurrentSession()) {
            disposeSessionResources(shouldDestroyBook());
            return;
          }
          set({ currentCfi: saved.location_cfi });
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
    }
  },

  close: () => {
    ++readerSession;
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

    if (rendition) rendition.destroy();
    if (book) book.destroy();

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
      isLoading: false,
      error: null,
      readingSettings: null,
      notes: [],
      pendingSelection: null,
      clickedNote: null,
    });
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
    const { book } = get();
    const needle = query.trim();
    if (!book || needle.length < 2) {
      set({ searchResults: [] });
      return;
    }

    type SearchSection = {
      href: string;
      load: () => Promise<{ textContent?: string } | null>;
    };
    const spine = (book as Book & {
      spine?: { each: (callback: (section: SearchSection) => void) => void };
    }).spine;
    const sections: SearchSection[] = [];
    spine?.each((section) => sections.push(section));

    const lowerNeedle = needle.toLocaleLowerCase();
    const results = await Promise.all(
      sections.map(async (section) => {
        try {
          const contents = await section.load();
          const text = contents?.textContent ?? '';
          const index = text.toLocaleLowerCase().indexOf(lowerNeedle);
          if (index < 0) return null;
          return {
            href: section.href,
            excerpt: text.slice(Math.max(0, index - 60), index + needle.length + 120),
          };
        } catch (error) {
          console.warn('Failed to load section for search:', section.href, error);
          return null;
        }
      }),
    );

    set({
      searchResults: results.filter((result): result is { href: string; excerpt: string } => result !== null).slice(0, 50),
    });
  },

  applyReadingSettings: (settings: ReadingSettings) => {
    const sessionId = readerSession;
    const run = settingsApplyQueue
      .catch(() => undefined)
      .then(async () => {
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
          await saveReadingProgress({
            bookId,
            locationCfi: currentCfi,
            progression: totalPages > 0 ? currentPage / totalPages : 0,
          });
          if (!isCurrentTarget()) return;
        }

        const previousFlow = readingSettings?.flow ?? 'paginated';
        if (book && previousFlow !== settings.flow) {
          if (!isCurrentTarget()) return;
          const firstVisibleLine = captureFirstVisibleLine(rendition);
          clearFirstLineOffset(rendition);
          continuousScrollCleanup?.();
          continuousScrollCleanup = null;
          if (relocatedHandler) rendition.off('relocated', relocatedHandler);
          relocatedHandler = null;
          rendition.destroy();

          const replacement = createRendition(book, settings);
          let replacementHandler: ((...args: unknown[]) => void) | null = null;
          const isCurrentReplacement = () => (
            sessionId === readerSession
            && get().bookId === bookId
            && get().rendition === replacement
          );
          const disposeReplacement = () => {
            if (replacementHandler) replacement.off('relocated', replacementHandler);
            replacement.destroy();
            if (relocatedHandler === replacementHandler) relocatedHandler = null;
            replacementHandler = null;
          };
          replacementHandler = createRelocatedHandler(
            bookId ?? '',
            () => get().toc,
            (location) => set(location),
            isCurrentReplacement,
          );
          relocatedHandler = replacementHandler;
          replacement.on('relocated', replacementHandler);
          set({ rendition: replacement });
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
          renderNotesIn(replacement, get().notes, settings.theme, (click) => set({ clickedNote: click }));
          set({ isLoading: false });
          return;
        }

        await preserveAndReflow(
          rendition,
          () => resizeToViewport(rendition, settings),
          {
            restoreTheme: true,
            settings,
            preserveTextAnchor: settings.flow === 'paginated',
          },
        );
        if (!isCurrentTarget()) return;
        renderNotesIn(rendition, get().notes, settings.theme, (click) => set({ clickedNote: click }));
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
        preserveTextAnchor: readingSettings?.flow === 'paginated',
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
    const sessionId = readerSession;
    const { bookId, rendition } = get();
    if (!bookId) return;
    let notes: Note[];
    try {
      notes = await listNotes({ bookId });
    } catch (err) {
      if (
        sessionId !== readerSession
        || get().bookId !== bookId
        || get().rendition !== rendition
      ) {
        return;
      }
      throw err;
    }
    if (
      sessionId !== readerSession
      || get().bookId !== bookId
      || get().rendition !== rendition
    ) {
      return;
    }
    set({ notes });
    const theme = get().readingSettings?.theme ?? null;
    if (
      rendition
      && sessionId === readerSession
      && get().bookId === bookId
      && get().rendition === rendition
    ) {
      renderNotesIn(rendition, notes, theme, (click) => set({ clickedNote: click }));
    }
  },

  setPendingSelection: (selection) => set({ pendingSelection: selection }),

  setClickedNote: (click) => set({ clickedNote: click }),

  addNote: async (input) => {
    const note = await createNoteIpc({ note: input });
    set((state) => ({ notes: [...state.notes, note] }));
    const rendition = get().rendition;
    if (rendition) {
      renderHighlight(
        rendition,
        note,
        get().readingSettings?.theme ?? null,
        (click) => set({ clickedNote: click }),
      );
    }
    return note;
  },

  editNote: async (input) => {
    const note = await updateNoteIpc({ note: input });
    set((state) => ({
      notes: state.notes.map((existing) => (existing.id === note.id ? note : existing)),
    }));
    const rendition = get().rendition;
    if (rendition) {
      renderHighlight(
        rendition,
        note,
        get().readingSettings?.theme ?? null,
        (click) => set({ clickedNote: click }),
      );
    }
    return note;
  },

  removeNote: async (noteId) => {
    const existing = get().notes.find((note) => note.id === noteId);
    await deleteNoteIpc(noteId);
    if (existing?.cfi_range && get().rendition) {
      removeHighlight(get().rendition as Rendition, existing.cfi_range);
    }
    set((state) => ({ notes: state.notes.filter((note) => note.id !== noteId) }));
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

function normalizeHref(href: string): string {
  const withoutFragment = href.split('#', 1)[0];
  try {
    return decodeURIComponent(withoutFragment).replace(/^\.\//, '');
  } catch {
    return withoutFragment.replace(/^\.\//, '');
  }
}

function waitForReaderLayout(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function flattenToc(items: TocItem[]): TocItem[] {
  return items.flatMap((item) => [item, ...flattenToc(item.subitems ?? [])]);
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

function resolveCurrentChapterHref(toc: TocItem[], locationHref: string): string | null {
  const locationPath = normalizeHref(locationHref);
  const matches = flattenToc(toc).filter((item) => {
    const itemPath = normalizeHref(item.href);
    return itemPath === locationPath
      || locationPath.endsWith(`/${itemPath}`)
      || itemPath.endsWith(`/${locationPath}`);
  });
  return matches.length > 0 ? matches[matches.length - 1].href : null;
}
