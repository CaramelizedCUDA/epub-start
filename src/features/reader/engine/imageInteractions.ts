import type { Content, Rendition } from 'epubjs';

export interface ReaderImageTarget {
  url: string;
  entryPath: string | null;
  alt: string;
}

export interface ReaderImageMenuRequest {
  target: ReaderImageTarget;
  point: { x: number; y: number };
}

interface ImageInteractionHandlers {
  onOpen: (target: ReaderImageTarget) => void;
  onContextMenu: (request: ReaderImageMenuRequest) => void;
  onError: (message: string) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  isPaginated: () => boolean;
}

interface RenderedSection {
  href?: string;
}

interface RenderedView {
  contents?: Content;
  section?: RenderedSection;
}

interface RenditionViews {
  all: () => RenderedView[];
}

const LONG_PRESS_MS = 550;
const MOVE_TOLERANCE_PX = 12;
const PAGE_TURN_EDGE_RATIO = 0.25;
const PAGE_TURN_LOCK_MS = 250;

export function installImageInteractions(
  rendition: Rendition,
  epubRootUrl: string,
  bookId: string,
  handlers: ImageInteractionHandlers,
): () => void {
  const cleanups = new Map<Document, () => void>();
  let pageTurnLockedUntil = 0;

  const turnPage = (direction: 'previous' | 'next') => {
    const now = Date.now();
    if (now < pageTurnLockedUntil || !handlers.isPaginated()) return;
    pageTurnLockedUntil = now + PAGE_TURN_LOCK_MS;
    if (direction === 'previous') handlers.onPreviousPage();
    else handlers.onNextPage();
  };
  const attach = (content: Content, sectionHref?: string) => {
    if (cleanups.has(content.document)) return;
    const href = sectionHref || sectionHrefFromDocument(content.document, epubRootUrl, bookId);
    cleanups.set(
      content.document,
      attachDocument(content, href, epubRootUrl, bookId, handlers, turnPage),
    );
  };
  const attachCurrentViews = () => {
    const views = rendition.views() as RenditionViews;
    for (const view of views.all()) {
      if (view.contents) attach(view.contents, view.section?.href);
    }
  };
  const rendered = (...args: unknown[]) => {
    const section = args[0] as RenderedSection | undefined;
    const view = args[1] as RenderedView | undefined;
    if (view?.contents) attach(view.contents, section?.href || view.section?.href);
  };

  rendition.on('rendered', rendered);
  attachCurrentViews();

  return () => {
    rendition.off('rendered', rendered);
    for (const cleanup of cleanups.values()) cleanup();
    cleanups.clear();
  };
}

function attachDocument(
  content: Content,
  sectionHref: string,
  epubRootUrl: string,
  bookId: string,
  handlers: ImageInteractionHandlers,
  turnPage: (direction: 'previous' | 'next') => void,
): () => void {
  const { document } = content;
  let longPressTimer: number | null = null;
  let pressStart: { x: number; y: number; target: ReaderImageTarget } | null = null;
  let suppressNextClick = false;

  for (const image of Array.from(document.images)) {
    image.style.cursor = 'zoom-in';
    image.setAttribute('title', image.getAttribute('title') || 'Click to enlarge; right-click for tools');
  }

  const clearLongPress = () => {
    if (longPressTimer !== null) content.window.clearTimeout(longPressTimer);
    longPressTimer = null;
    pressStart = null;
  };
  const pointInReader = (event: MouseEvent | PointerEvent) => {
    const frame = content.window.frameElement as HTMLElement | null;
    const rect = frame?.getBoundingClientRect();
    return { x: (rect?.left ?? 0) + event.clientX, y: (rect?.top ?? 0) + event.clientY };
  };
  const imageElementFromEvent = (event: Event) => {
    const candidate = event.target as { tagName?: string } | null;
    return candidate?.tagName?.toUpperCase() === 'IMG'
      ? event.target as HTMLImageElement
      : null;
  };
  const reportUnresolvedImage = () => handlers.onError(
    '\u65e0\u6cd5\u8bfb\u53d6\u8fd9\u5f20\u56fe\u7247\u7684\u663e\u793a\u5730\u5740\u3002',
  );
  const click = (event: MouseEvent) => {
    const image = imageElementFromEvent(event);
    if (image) {
      event.preventDefault();
      event.stopPropagation();
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      const target = resolveImageTarget(image, sectionHref, epubRootUrl, bookId);
      if (!target) {
        reportUnresolvedImage();
        return;
      }
      handlers.onOpen(target);
      return;
    }

    if (!handlers.isPaginated() || hasActiveSelection(document) || isInteractiveElement(event.target)) return;
    const viewport = window.document.getElementById('epub-reader-viewport');
    const viewportRect = viewport?.getBoundingClientRect();
    if (!viewportRect || viewportRect.width <= 0) return;
    const relativeX = pointInReader(event).x - viewportRect.left;
    if (relativeX < 0 || relativeX > viewportRect.width) return;
    if (relativeX <= viewportRect.width * PAGE_TURN_EDGE_RATIO) {
      event.preventDefault();
      event.stopPropagation();
      turnPage('previous');
    } else if (relativeX >= viewportRect.width * (1 - PAGE_TURN_EDGE_RATIO)) {
      event.preventDefault();
      event.stopPropagation();
      turnPage('next');
    }
  };
  const contextMenu = (event: MouseEvent) => {
    const image = imageElementFromEvent(event);
    if (!image) return;
    event.preventDefault();
    event.stopPropagation();
    const target = resolveImageTarget(image, sectionHref, epubRootUrl, bookId);
    if (!target) {
      reportUnresolvedImage();
      return;
    }
    handlers.onContextMenu({ target, point: pointInReader(event) });
  };
  const pointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    const image = imageElementFromEvent(event);
    if (!image) return;
    const target = resolveImageTarget(image, sectionHref, epubRootUrl, bookId);
    if (!target) {
      reportUnresolvedImage();
      return;
    }
    clearLongPress();
    pressStart = { x: event.clientX, y: event.clientY, target };
    longPressTimer = content.window.setTimeout(() => {
      if (!pressStart) return;
      handlers.onContextMenu({ target: pressStart.target, point: pointInReader(event) });
      suppressNextClick = true;
      clearLongPress();
    }, LONG_PRESS_MS);
  };
  const pointerMove = (event: PointerEvent) => {
    if (!pressStart) return;
    if (
      Math.abs(event.clientX - pressStart.x) > MOVE_TOLERANCE_PX
      || Math.abs(event.clientY - pressStart.y) > MOVE_TOLERANCE_PX
    ) {
      clearLongPress();
    }
  };

  document.addEventListener('click', click, true);
  document.addEventListener('contextmenu', contextMenu, true);
  document.addEventListener('pointerdown', pointerDown, true);
  document.addEventListener('pointermove', pointerMove, true);
  document.addEventListener('pointerup', clearLongPress, true);
  document.addEventListener('pointercancel', clearLongPress, true);

  return () => {
    clearLongPress();
    document.removeEventListener('click', click, true);
    document.removeEventListener('contextmenu', contextMenu, true);
    document.removeEventListener('pointerdown', pointerDown, true);
    document.removeEventListener('pointermove', pointerMove, true);
    document.removeEventListener('pointerup', clearLongPress, true);
    document.removeEventListener('pointercancel', clearLongPress, true);
  };
}

function resolveImageTarget(
  image: HTMLImageElement,
  sectionHref: string,
  epubRootUrl: string,
  bookId: string,
): ReaderImageTarget | null {
  const rawSource = image.getAttribute('src') || image.getAttribute('xlink:href') || '';
  const displayUrl = image.currentSrc || image.src || rawSource;
  if (!displayUrl || /^javascript:/i.test(displayUrl)) return null;

  const candidates = [rawSource, image.currentSrc, image.src].filter(Boolean);
  let entryPath: string | null = null;
  for (const candidate of candidates) {
    entryPath = entryPathFromProtocolUrl(candidate, epubRootUrl, bookId)
      || resolveRelativeEntryPath(sectionHref, candidate);
    if (entryPath) break;
  }

  return {
    url: displayUrl,
    entryPath,
    alt: image.alt || entryPath?.split('/').pop() || 'EPUB image',
  };
}

function entryPathFromProtocolUrl(rawSource: string, epubRootUrl: string, bookId: string): string | null {
  try {
    const sourceUrl = new URL(rawSource, epubRootUrl);
    const root = new URL(epubRootUrl);
    const expectedPrefix = `/book/${encodeURIComponent(bookId)}/`;
    if (sourceUrl.protocol !== root.protocol || sourceUrl.host !== root.host) return null;
    if (!sourceUrl.pathname.startsWith(expectedPrefix)) return null;
    return normalizeEntryPath(decodeURIComponent(sourceUrl.pathname.slice(expectedPrefix.length)));
  } catch {
    return null;
  }
}

function resolveRelativeEntryPath(sectionHref: string, rawSource: string): string | null {
  if (!sectionHref || rawSource.startsWith('blob:') || /^[a-z][a-z0-9+.-]*:/i.test(rawSource)) {
    return null;
  }
  try {
    const base = new URL(sectionHref, 'https://epub.invalid/');
    const resolved = new URL(rawSource, base);
    if (resolved.origin !== base.origin) return null;
    return normalizeEntryPath(decodeURIComponent(resolved.pathname.slice(1)));
  } catch {
    return null;
  }
}

function sectionHrefFromDocument(document: Document, epubRootUrl: string, bookId: string): string {
  const baseHref = document.querySelector('base[href]')?.getAttribute('href');
  const canonicalHref = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  for (const candidate of [baseHref, canonicalHref, document.baseURI]) {
    if (!candidate) continue;
    const entryPath = entryPathFromProtocolUrl(candidate, epubRootUrl, bookId);
    if (entryPath) return entryPath;
  }
  return '';
}

function normalizeEntryPath(path: string): string | null {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length > 0 ? segments.join('/') : null;
}

function isInteractiveElement(target: EventTarget | null): boolean {
  const element = target as Element | null;
  return Boolean(element?.closest?.('a, button, input, select, textarea, label, [role="button"]'));
}

function hasActiveSelection(document: Document): boolean {
  return Boolean(document.getSelection()?.toString().trim());
}
