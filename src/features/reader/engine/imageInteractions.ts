import type { Content, Rendition } from 'epubjs';
import { isPointOnHighlightMark } from './highlights';

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
  onToggleNavigation: () => void;
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
const SWIPE_MIN_DISTANCE_PX = 48;
const SWIPE_MAX_DURATION_MS = 700;
const SWIPE_VERTICAL_TOLERANCE = 1.25;

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

  const onRelocated = () => attachCurrentViews();
  rendition.on('rendered', rendered);
  rendition.on('relocated', onRelocated);

  // MutationObserver：监听 viewport 内 iframe 的创建/移除，确保 spread 右 View 也能被 attach。
  // 不依赖 relocated/rendered 事件时机——DOM 变化必然触发，rAF 去抖避免频繁 attach。
  let rafId: number | null = null;
  const debouncedAttach = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      attachCurrentViews();
      // 双 rAF：处理 view.contents 懒初始化（content 在 iframe 加载后才完整绑定）
      rafId = requestAnimationFrame(() => {
        rafId = null;
        attachCurrentViews();
      });
    });
  };
  const viewport = window.document.getElementById('epub-reader-viewport');
  const viewportClick = (event: MouseEvent) => {
    // When the paginated rendition is narrower than the host viewport, clicks
    // land on the host's side gutters rather than inside an iframe document.
    // Handle those gutter clicks here; iframe clicks remain authoritative.
    if (event.target !== viewport || !handlers.isPaginated() || hasActiveSelection(window.document)) return;
    const rect = viewport?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    if (ratio <= PAGE_TURN_EDGE_RATIO) {
      event.preventDefault();
      turnPage('previous');
    } else if (ratio >= 1 - PAGE_TURN_EDGE_RATIO) {
      event.preventDefault();
      turnPage('next');
    } else {
      handlers.onToggleNavigation();
    }
  };
  viewport?.addEventListener('click', viewportClick);
  let observer: MutationObserver | null = null;
  if (viewport) {
    observer = new MutationObserver(debouncedAttach);
    observer.observe(viewport, { childList: true, subtree: true });
  }

  attachCurrentViews();

  return () => {
    observer?.disconnect();
    viewport?.removeEventListener('click', viewportClick);
    rendition.off('rendered', rendered);
    rendition.off('relocated', onRelocated);
    if (rafId !== null) cancelAnimationFrame(rafId);
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
  let swipeStart: {
    x: number;
    y: number;
    startedAt: number;
    target: EventTarget | null;
    isImage: boolean;
  } | null = null;
  let suppressNextClick = false;

  for (const image of Array.from(document.images)) {
    image.style.cursor = 'zoom-in';
    image.setAttribute('title', image.getAttribute('title') || 'Click to enlarge; right-click for tools');
  }
  for (const svgImage of Array.from(document.querySelectorAll('svg image'))) {
    (svgImage as SVGElement).style.cursor = 'zoom-in';
    svgImage.setAttribute('data-reader-image', 'true');
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
  const imageElementFromEvent = (event: Event): HTMLImageElement | SVGImageElement | null => {
    const target = event.target as Element | null;
    if (!target) return null;
    const tag = target.tagName?.toUpperCase();
    if (tag === 'IMG') return target as HTMLImageElement;
    if (tag === 'IMAGE') {
      // SVG <image>（SVGImageElement）的 tagName 是 'IMAGE'，用 namespaceURI 与 HTML 区分
      const ns = target.namespaceURI ?? '';
      if (ns === 'http://www.w3.org/2000/svg') {
        return target as unknown as SVGImageElement;
      }
    }
    return null;
  };
  const reportUnresolvedImage = () => handlers.onError(
    '\u65e0\u6cd5\u8bfb\u53d6\u8fd9\u5f20\u56fe\u7247\u7684\u663e\u793a\u5730\u5740\u3002',
  );
  const click = (event: MouseEvent) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const image = imageElementFromEvent(event);
    if (image) {
      event.preventDefault();
      event.stopPropagation();
      const target = resolveImageTarget(image, sectionHref, epubRootUrl, bookId);
      if (!target) {
        reportUnresolvedImage();
        return;
      }
      handlers.onOpen(target);
      return;
    }

    if (hasActiveSelection(document) || isInteractiveElement(event.target)) return;
    // 已渲染的高亮标记优先于边缘翻页：点击高亮区域只打开批注菜单，不翻页。
    if (isPointOnHighlightMark(document, event.clientX, event.clientY)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const viewport = window.document.getElementById('epub-reader-viewport');
    const viewportRect = viewport?.getBoundingClientRect();
    if (!handlers.isPaginated()) {
      handlers.onToggleNavigation();
      return;
    }
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
    } else {
      handlers.onToggleNavigation();
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
    swipeStart = {
      x: event.clientX,
      y: event.clientY,
      startedAt: Date.now(),
      target: event.target,
      isImage: Boolean(image),
    };
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
  const pointerUp = (event: PointerEvent) => {
    const start = swipeStart;
    swipeStart = null;
    clearLongPress();
    if (!start || event.pointerType === 'mouse' || start.isImage) return;
    if (Date.now() - start.startedAt > SWIPE_MAX_DURATION_MS) return;
    if (hasActiveSelection(document) || isInteractiveElement(start.target)) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (
      Math.abs(deltaX) < SWIPE_MIN_DISTANCE_PX
      || Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_VERTICAL_TOLERANCE
      || !handlers.isPaginated()
    ) return;

    suppressNextClick = true;
    event.preventDefault();
    turnPage(deltaX < 0 ? 'next' : 'previous');
  };
  const pointerCancel = () => {
    swipeStart = null;
    clearLongPress();
  };

  document.addEventListener('click', click, true);
  document.addEventListener('contextmenu', contextMenu, true);
  document.addEventListener('pointerdown', pointerDown, true);
  document.addEventListener('pointermove', pointerMove, true);
  document.addEventListener('pointerup', pointerUp, true);
  document.addEventListener('pointercancel', pointerCancel, true);

  return () => {
    clearLongPress();
    document.removeEventListener('click', click, true);
    document.removeEventListener('contextmenu', contextMenu, true);
    document.removeEventListener('pointerdown', pointerDown, true);
    document.removeEventListener('pointermove', pointerMove, true);
    document.removeEventListener('pointerup', pointerUp, true);
    document.removeEventListener('pointercancel', pointerCancel, true);
  };
}

function resolveImageTarget(
  image: HTMLImageElement | SVGImageElement,
  sectionHref: string,
  epubRootUrl: string,
  bookId: string,
): ReaderImageTarget | null {
  const rawSource =
    image.getAttribute('src')
    || image.getAttribute('href')        // SVG2 标准属性
    || image.getAttribute('xlink:href')  // SVG1 旧属性
    || '';
  if (!rawSource || /^javascript:/i.test(rawSource)) return null;

  // 收集候选 base：优先用 image 所在 document 的 baseURI（含完整 OPF 目录前缀，
  // 如 OEBPS/），再用传入的 sectionHref（spine 相对 href，可能丢前缀）作为 fallback。
  const docBaseUri = image.ownerDocument?.baseURI ?? '';
  const docEntryPath = docBaseUri
    ? entryPathFromProtocolUrl(docBaseUri, epubRootUrl, bookId)
    : null;
  const bases = [docEntryPath, sectionHref].filter(
    (value): value is string => Boolean(value),
  );

  let entryPath: string | null = null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawSource) && !rawSource.startsWith('blob:')) {
    entryPath = entryPathFromProtocolUrl(rawSource, epubRootUrl, bookId);
  }
  if (!entryPath) {
    for (const base of bases) {
      entryPath = resolveRelativeEntryPath(base, rawSource);
      if (entryPath) break;
    }
  }
  if (!entryPath) return null;

  // 用平台层抽象的 epubRootUrl 构造 displayUrl（Windows/Android:
  // http://epub.localhost/...；其他桌面平台保留 epub://localhost/...），
  // 确保外层 React <img> 能被 webview 正确加载。硬编码 epub:// 在 Windows
  // WebView2 和 Android WebView 对资源加载都有 edge case。
  const displayUrl = `${epubRootUrl}${entryPath}`;

  return {
    url: displayUrl,
    entryPath,
    alt: (image as HTMLImageElement).alt || entryPath.split('/').pop() || 'EPUB image',
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
