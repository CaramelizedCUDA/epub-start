import ePub from 'epubjs';
import type { Book, Rendition } from 'epubjs';
import type { ReadingSettings } from '../../../types/models';
import { injectReadingTheme, readerViewportGeometry } from './reflow';

// EPUB-only construction and disposal. IPC and persisted state remain in the store.
const BOOK_OPEN_TIMEOUT_MS = 30_000;

// Private fields below match the pinned EPUB.js 0.3.93 implementation.
type Deferred = { resolve: () => void };
type RenderQueue = {
  stop: () => void;
  enqueue: (...args: unknown[]) => Promise<unknown>;
  _q: { deferred?: Deferred }[];
};
type RenditionInternals = {
  q?: RenderQueue;
  manager?: { q?: RenderQueue; rendered?: boolean; stage?: unknown };
  starting?: Deferred;
  displaying?: Deferred;
};
type BookInternals = {
  opened?: Promise<unknown>;
  loadNavigation?: (...args: unknown[]) => Promise<unknown>;
};
type BookWork = {
  pending: number;
  controllers: Set<AbortController>;
  dispose?: () => void;
};
const bookWork = new WeakMap<Book, BookWork>();
const cancelDisplays = new WeakMap<Rendition, Set<() => void>>();
const retiredRenditions = new WeakSet<Rendition>();
const retiredBooks = new WeakSet<Book>();
const retiredError = () => new Error('BOOK_RETIRED: reader session closed');

function retireQueue(queue: RenderQueue | undefined): void {
  if (!queue) return;
  const queued = queue._q.slice();
  queue.stop();
  // In-flight callbacks may still try to enqueue reports or continuous fill.
  queue.enqueue = () => Promise.resolve();
  queued.forEach((item) => item.deferred?.resolve());
}

function finishBookWork(work: BookWork): void {
  work.pending -= 1;
  // Let downstream EPUB.js promise callbacks finish before clearing their fields.
  if (work.pending === 0 && work.dispose) setTimeout(() => {
    if (work.pending === 0) work.dispose?.();
  }, 0);
}

export function normalizeEpubRequestUrl(url: string, epubRootUrl: string): string {
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

/** A successful load must not leave the 30-second timer alive. */
export async function withBookTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          `BOOK_LOAD_TIMEOUT: ${label} exceeded 30 seconds`,
        )), BOOK_OPEN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function parseEpubResponse(
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

export function createRendition(book: Book, settings: ReadingSettings | null): Rendition {
  if (retiredBooks.has(book)) throw retiredError();
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
  const pendingDisplays = new Set<() => void>();
  cancelDisplays.set(rendition, pendingDisplays);
  const display = rendition.display.bind(rendition);
  const managedDisplay = async (target?: string) => {
    if (retiredRenditions.has(rendition)) throw retiredError();
    let cancel = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(retiredError());
      pendingDisplays.add(cancel);
    });
    try {
      const result = await Promise.race([display(target), cancelled]);
      if (retiredRenditions.has(rendition)) throw retiredError();
      return result;
    } finally {
      pendingDisplays.delete(cancel);
    }
  };
  rendition.display = (target?: string) => {
    const result = managedDisplay(target);
    // EPUB.js links and resize callbacks discard this promise. Observe its
    // rejection without replacing it: awaited callers still receive errors.
    void result.catch(() => undefined);
    return result;
  };
  if (settings) injectReadingTheme(rendition, settings);
  return rendition;
}

function normalizeSpread(spread: ReadingSettings['spread']): 'none' | 'auto' | 'both' {
  return spread === 'always' ? 'both' : spread;
}

export function createEpubBook(epubRootUrl: string): Book {
  const work: BookWork = { pending: 0, controllers: new Set() };
  const book = ePub({
    requestMethod: async (url: string, type: string) => {
      if (retiredBooks.has(book)) throw retiredError();
      const controller = new AbortController();
      work.controllers.add(controller);
      work.pending += 1;
      try {
        // EPUB.js can lose the origin for non-standard schemes and hand
        // back `null/...`, `epub://localhost/...`, or
        // `epub:///localhost/...`. On Android/Windows Tauri maps this
        // protocol through the HTTP localhost origin, so normalize those
        // forms before Fetch sees them.
        const finalUrl = normalizeEpubRequestUrl(url, epubRootUrl);

        const response = await fetch(finalUrl, { signal: controller.signal });
        const mime = response.headers.get('content-type') ?? '';

        if (!response.ok) {
          throw new Error(
            `BOOK_RESOURCE_FAILED: url=${finalUrl}; status=${response.status}; mime=${mime}`,
          );
        }

        if (type === 'binary' || type === 'blob') {
          return await response.arrayBuffer();
        }

        const body = await response.text();
        return parseEpubResponse(body, type, mime);
      } finally {
        work.controllers.delete(controller);
        finishBookWork(work);
      }
    },
  });
  bookWork.set(book, work);
  const internals = book as unknown as BookInternals;
  let navigationFailure: { error: unknown } | undefined;
  const loadNavigation = internals.loadNavigation?.bind(book);
  if (loadNavigation) internals.loadNavigation = async (...args) => {
    try {
      return await loadNavigation(...args);
    } catch (error) {
      // unpack() has no rejection branch for this detached promise. Let its
      // completion run, then surface the original failure through managed open.
      navigationFailure = { error };
      return undefined;
    }
  };
  const open = book.open.bind(book);
  book.open = async (...args: Parameters<Book['open']>) => {
    if (retiredBooks.has(book)) throw retiredError();
    work.pending += 1;
    try {
      const result = await open(...args);
      // open() only starts unpack(); ready/opened own its detached callbacks.
      await Promise.all([book.ready, internals.opened]);
      if (retiredBooks.has(book)) throw retiredError();
      if (navigationFailure) throw navigationFailure.error;
      return result;
    } finally {
      finishBookWork(work);
    }
  };
  return book;
}

// A close, a failed open and a stale continuation may all retire the same object.
export function destroyRendition(rendition: Rendition | null): void {
  if (!rendition || retiredRenditions.has(rendition)) return;
  retiredRenditions.add(rendition);
  cancelDisplays.get(rendition)?.forEach((cancel) => cancel());
  cancelDisplays.delete(rendition);
  const internals = rendition as unknown as RenditionInternals;
  retireQueue(internals.q);
  retireQueue(internals.manager?.q);
  if (internals.manager?.rendered === false && !internals.manager.stage) {
    // start() precedes attachTo(): no DOM exists for manager.destroy() yet.
    internals.manager = undefined;
  }
  internals.starting?.resolve();
  internals.displaying?.resolve();
  rendition.destroy();
}

export function destroyEpubBook(book: Book | null): void {
  if (!book || retiredBooks.has(book)) return;
  retiredBooks.add(book);
  // EPUB.js 0.3.93 Book.destroy() destroys its current rendition internally.
  // Do not send a second destroy into a manager already retired by the store.
  const owner = book as unknown as { rendition?: Rendition };
  destroyRendition(owner.rendition ?? null);
  owner.rendition = undefined;
  const work = bookWork.get(book);
  if (!work || work.pending === 0) {
    book.destroy();
    return;
  }
  work.dispose = () => {
    work.dispose = undefined;
    book.destroy();
  };
  work.controllers.forEach((controller) => controller.abort());
}

/** Best-effort early flush; browser suspension cannot guarantee an IPC completes. */
export function installProgressLifecycle(
  flush: () => Promise<void>,
  isActive: () => boolean,
): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const flushActive = () => {
    if (isActive()) void flush().catch((error: unknown) => {
      console.error('Failed to save reading progress before suspension:', error);
    });
  };
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') flushActive();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flushActive);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flushActive);
  };
}
