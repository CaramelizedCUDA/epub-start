import type { Content, Location, Rendition } from 'epubjs';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ReadingSettings } from '../../../types/models';

const REFLOW_EVENT_TIMEOUT_MS = 1_200;
const AUTO_SPREAD_MIN_VIEWPORT_PX = 1_000;
const PAGINATED_GAP_PX = 32;
const renditionQueues = new WeakMap<Rendition, Promise<void>>();

export interface PreserveAndReflowOptions {
  restoreTheme: boolean;
  settings?: ReadingSettings | null;
  preserveTextAnchor?: boolean;
}

export interface TextAnchor {
  cfi: string;
  viewportY: number;
}

export async function preserveAndReflow(
  rendition: Rendition,
  action: (savedCfi: string | null) => Promise<void> | void,
  options: PreserveAndReflowOptions,
): Promise<void> {
  const previous = renditionQueues.get(rendition) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const savedCfi = await readCurrentCfi(rendition);
    const textAnchor = options.preserveTextAnchor
      ? captureFirstVisibleLine(rendition)
      : null;
    clearFirstLineOffset(rendition);
    const actionRelocated = waitForRelocated(rendition);

    await action(savedCfi);
    await actionRelocated;

    if (options.restoreTheme && options.settings) {
      injectReadingTheme(rendition, options.settings);
      await waitForViewportLayout();
    }

    const restoreCfi = textAnchor?.cfi ?? savedCfi;
    if (restoreCfi) {
      const restored = waitForRelocated(rendition);
      await rendition.display(restoreCfi);
      await restored;
    }

    if (textAnchor) {
      await waitForViewportLayout();
      restoreFirstVisibleLine(rendition, textAnchor);
    }

  });

  renditionQueues.set(rendition, current);
  try {
    await current;
  } finally {
    if (renditionQueues.get(rendition) === current) {
      renditionQueues.delete(rendition);
    }
  }
}

export function clearFirstLineOffset(rendition: Rendition): void {
  for (const content of rendition.getContents()) {
    const root = content.document.documentElement;
    if (root.dataset.epubstartFirstLineOffset !== 'true') continue;
    root.style.removeProperty('top');
    root.style.removeProperty('position');
    delete root.dataset.epubstartFirstLineOffset;
  }
}

export function captureFirstVisibleLine(rendition: Rendition): TextAnchor | null {
  const viewport = document.getElementById('epub-reader-viewport');
  if (!viewport) return null;
  const viewportRect = viewport.getBoundingClientRect();
  let first: {
    content: Content;
    rect: DOMRect;
    frameRect: DOMRect;
    node: Text;
  } | null = null;

  for (const content of rendition.getContents()) {
    const frame = content.window.frameElement;
    if (!(frame instanceof HTMLElement)) continue;
    const frameRect = frame.getBoundingClientRect();
    const walker = content.document.createTreeWalker(
      content.document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return node.textContent?.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      },
    );

    let node = walker.nextNode();
    while (node) {
      const range = content.document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        const globalTop = frameRect.top + rect.top;
        const globalBottom = frameRect.top + rect.bottom;
        const globalLeft = frameRect.left + rect.left;
        const globalRight = frameRect.left + rect.right;
        const isVisible = globalBottom > viewportRect.top + 0.5
          && globalTop < viewportRect.bottom - 0.5
          && globalRight > viewportRect.left + 0.5
          && globalLeft < viewportRect.right - 0.5;
        if (!isVisible || rect.width <= 0 || rect.height <= 0) continue;

        if (!first
          || globalTop < first.frameRect.top + first.rect.top - 0.5
          || (
            Math.abs(globalTop - (first.frameRect.top + first.rect.top)) <= 0.5
            && globalLeft < first.frameRect.left + first.rect.left
          )) {
          first = { content, rect, frameRect, node: node as Text };
        }
      }
      node = walker.nextNode();
    }
  }

  if (!first) return null;
  const start = rangeAtLineStart(
    first.content,
    first.node,
    first.rect,
    first.frameRect,
    viewportRect,
  );
  if (!start) return null;
  return {
    cfi: first.content.cfiFromRange(start),
    viewportY: first.frameRect.top + first.rect.top - viewportRect.top,
  };
}

export function installContinuousScrollStabilizer(
  rendition: Rendition,
): () => void {
  const viewport = document.getElementById('epub-reader-viewport');
  const scroller = viewport?.querySelector<HTMLElement>('.epub-container');
  if (!scroller) return () => undefined;

  let anchor: TextAnchor | null = null;
  let correcting = false;
  let correctionFrame: number | null = null;
  let userScrollPending = false;
  let pointerActive = false;

  const rememberAnchor = () => {
    if (!correcting) anchor = captureFirstVisibleLine(rendition);
  };
  const restoreAnchor = () => {
    if (!anchor || correctionFrame !== null) return;
    correctionFrame = window.requestAnimationFrame(() => {
      correctionFrame = window.requestAnimationFrame(() => {
        correctionFrame = null;
        if (!anchor) return;
        const currentY = locateAnchorViewportY(rendition, anchor.cfi);
        if (currentY === null) return;
        const delta = currentY - anchor.viewportY;
        if (Math.abs(delta) < 0.5) return;
        correcting = true;
        scroller.scrollTop += delta;
        window.requestAnimationFrame(() => {
          correcting = false;
        });
      });
    });
  };

  const onWheel = () => {
    userScrollPending = true;
  };
  const onPointerDown = () => {
    pointerActive = true;
  };
  const onPointerUp = () => {
    pointerActive = false;
  };
  const onTouchMove = () => {
    userScrollPending = true;
  };
  const onScroll = () => {
    if (correcting || (!userScrollPending && !pointerActive)) return;
    userScrollPending = false;
    window.requestAnimationFrame(rememberAnchor);
  };
  const onRendered = () => restoreAnchor();
  const onRemoved = () => restoreAnchor();
  scroller.addEventListener('wheel', onWheel, { passive: true });
  scroller.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  scroller.addEventListener('touchmove', onTouchMove, { passive: true });
  scroller.addEventListener('scroll', onScroll, { passive: true });
  rendition.on('rendered', onRendered);
  rendition.on('removed', onRemoved);

  return () => {
    scroller.removeEventListener('wheel', onWheel);
    scroller.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    scroller.removeEventListener('touchmove', onTouchMove);
    scroller.removeEventListener('scroll', onScroll);
    rendition.off('rendered', onRendered);
    rendition.off('removed', onRemoved);
    if (correctionFrame !== null) window.cancelAnimationFrame(correctionFrame);
  };
}

export interface ReaderViewportGeometry {
  width: number;
  height: number;
  spread: 'none' | 'both';
  gap: number;
}

export function readerViewportGeometry(
  settings: ReadingSettings | null,
): ReaderViewportGeometry | null {
  const viewport = document.getElementById('epub-reader-viewport');
  if (!viewport) return null;
  const { width, height } = viewport.getBoundingClientRect();
  if (width <= 0 || height <= 0) return null;

  const availableWidth = Math.floor(width);
  const maxColumnWidth = settings?.max_column_width_px ?? availableWidth;
  const spread = resolveSpread(settings, availableWidth);
  const gap = spread === 'both' ? PAGINATED_GAP_PX : 0;
  const widthLimit = spread === 'both'
    ? maxColumnWidth * 2 + gap
    : maxColumnWidth;

  return {
    width: Math.max(1, Math.min(availableWidth, widthLimit)),
    height: Math.max(1, Math.floor(height)),
    spread,
    gap,
  };
}

export function resizeToViewport(
  rendition: Rendition,
  settings: ReadingSettings | null,
): void {
  const geometry = readerViewportGeometry(settings);
  if (!geometry) return;
  rendition.spread(settings?.flow === 'scrolled' ? 'none' : geometry.spread);
  rendition.resize(geometry.width, geometry.height);
  centerReaderContainer();
}

export async function settleInitialPagination(
  rendition: Rendition,
  settings: ReadingSettings,
): Promise<void> {
  if (settings.flow !== 'paginated') return;
  await waitForRenderedAssets(rendition);
  await preserveAndReflow(
    rendition,
    () => resizeToViewport(rendition, settings),
    { restoreTheme: true, settings, preserveTextAnchor: true },
  );
}

export async function toggleWindowFullscreen(
  rendition: Rendition,
  settings: ReadingSettings | null,
): Promise<boolean> {
  const appWindow = getCurrentWindow();
  const nextFullscreen = !(await appWindow.isFullscreen());
  await preserveAndReflow(
    rendition,
    async () => {
      await appWindow.setFullscreen(nextFullscreen);
      await waitForViewportLayout();
      resizeToViewport(rendition, settings);
    },
    { restoreTheme: true, settings, preserveTextAnchor: true },
  );
  return nextFullscreen;
}

export async function exitWindowFullscreen(
  rendition: Rendition,
  settings: ReadingSettings | null,
): Promise<boolean> {
  const appWindow = getCurrentWindow();
  if (!(await appWindow.isFullscreen())) return false;
  await preserveAndReflow(
    rendition,
    async () => {
      await appWindow.setFullscreen(false);
      await waitForViewportLayout();
      resizeToViewport(rendition, settings);
    },
    { restoreTheme: true, settings, preserveTextAnchor: true },
  );
  return true;
}

export function injectReadingTheme(
  rendition: Rendition,
  settings: ReadingSettings,
): void {
  const palette = {
    light: { background: '#f8fafc', color: '#111827' },
    sepia: { background: '#f4ecd8', color: '#3f3527' },
    dark: { background: '#111827', color: '#f9fafb' },
  }[settings.theme];
  const fontFamily = {
    publisher: 'inherit',
    serif: 'Georgia, "Times New Roman", serif',
    sans: 'Arial, Helvetica, sans-serif',
    system: 'system-ui, sans-serif',
  }[settings.font_family];

  rendition.themes.register('reader-settings', {
    html: {
      'background-color': `${palette.background} !important`,
      color: `${palette.color} !important`,
      height: '100% !important',
      margin: '0 !important',
    },
    body: {
      'background-color': `${palette.background} !important`,
      color: `${palette.color} !important`,
      'box-sizing': 'border-box !important',
      'font-family': `${fontFamily} !important`,
      'font-size': `${settings.font_size_px}px !important`,
      'line-height': `${settings.line_height_multiplier} !important`,
      'min-height': '100% !important',
      margin: '0 !important',
      'padding-top': `${settings.margin_top_px}px !important`,
      'padding-bottom': `${settings.margin_bottom_px}px !important`,
      'padding-left': `${settings.margin_left_percent}% !important`,
      'padding-right': `${settings.margin_right_percent}% !important`,
    },
    p: {
      'margin-bottom': `${settings.paragraph_spacing_multiplier}em !important`,
      'text-indent': `${settings.text_indent_em}em !important`,
    },
    '*': { color: `${palette.color} !important` },
  });
  rendition.themes.select('reader-settings');
  centerReaderContainer();
}

function centerReaderContainer(): void {
  const viewport = document.getElementById('epub-reader-viewport');
  const container = viewport?.querySelector<HTMLElement>('.epub-container');
  if (!container) return;
  container.style.removeProperty('max-width');
  container.style.marginLeft = 'auto';
  container.style.marginRight = 'auto';
}

function resolveSpread(
  settings: ReadingSettings | null,
  viewportWidth: number,
): 'none' | 'both' {
  if (settings?.flow === 'scrolled' || settings?.spread === 'none') return 'none';
  if (settings?.spread === 'always') return 'both';
  return viewportWidth >= AUTO_SPREAD_MIN_VIEWPORT_PX ? 'both' : 'none';
}

export function readingBackground(settings: ReadingSettings | null): string {
  if (settings?.theme === 'light') return '#f8fafc';
  if (settings?.theme === 'sepia') return '#f4ecd8';
  return '#111827';
}

function readCurrentCfi(rendition: Rendition): Promise<string | null> {
  try {
    return Promise.resolve(rendition.currentLocation())
      .then((location: Location | undefined) => location?.start?.cfi ?? null)
      .catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

function waitForRelocated(rendition: Rendition): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      rendition.off('relocated', onRelocated);
      resolve();
    };
    const onRelocated = () => finish();
    const timeoutId = window.setTimeout(finish, REFLOW_EVENT_TIMEOUT_MS);
    rendition.on('relocated', onRelocated);
  });
}

function waitForViewportLayout(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

async function waitForRenderedAssets(rendition: Rendition): Promise<void> {
  const waits = rendition.getContents().flatMap((content) => {
    const document = content.document;
    const fonts = document.fonts?.ready
      ? Promise.resolve(document.fonts.ready).then(() => undefined)
      : Promise.resolve();
    const images = Array.from(document.images)
      .filter((image) => !image.complete)
      .map((image) => new Promise<void>((resolve) => {
        const finish = () => {
          image.removeEventListener('load', finish);
          image.removeEventListener('error', finish);
          resolve();
        };
        image.addEventListener('load', finish, { once: true });
        image.addEventListener('error', finish, { once: true });
      }));
    return [fonts, ...images];
  });
  if (waits.length === 0) {
    await waitForViewportLayout();
    return;
  }
  await Promise.race([
    Promise.all(waits).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, REFLOW_EVENT_TIMEOUT_MS)),
  ]);
  await waitForViewportLayout();
}

function rangeAtLineStart(
  content: Content,
  textNode: Text,
  lineRect: DOMRect,
  frameRect: DOMRect,
  viewportRect: DOMRect,
): Range | null {
  const documentWithCaret = content.document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caretRangeFromPoint = documentWithCaret.caretRangeFromPoint?.bind(documentWithCaret);
  const visibleLeft = Math.max(lineRect.left, viewportRect.left - frameRect.left);
  const pointX = visibleLeft + Math.min(1, Math.max(0.1, lineRect.width / 2));
  const pointY = lineRect.top + Math.min(lineRect.height / 2, 2);
  const pointRange = caretRangeFromPoint?.(pointX, pointY);
  if (pointRange) {
    pointRange.collapse(true);
    return pointRange;
  }

  const text = textNode.data;
  let low = 0;
  let high = text.length;
  let result = text.length;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const probe = content.document.createRange();
    probe.setStart(textNode, mid);
    probe.setEnd(textNode, Math.min(text.length, mid + 1));
    const rect = probe.getClientRects()[0];
    if (rect && rect.top >= lineRect.top - 0.5) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  const range = content.document.createRange();
  range.setStart(textNode, result);
  range.collapse(true);
  return range;
}

export function restoreFirstVisibleLine(
  rendition: Rendition,
  anchor: TextAnchor,
): void {
  if (rendition.settings.flow !== 'scrolled') {
    // display(anchor.cfi) already makes this the first paginated line. Moving
    // the document root would invalidate EPUB.js column coordinates.
    return;
  }
  const viewport = document.getElementById('epub-reader-viewport');
  if (!viewport) return;
  const viewportRect = viewport.getBoundingClientRect();
  const targetY = viewportRect.top + anchor.viewportY;

  for (const content of rendition.getContents()) {
    try {
      const frame = content.window.frameElement;
      if (!(frame instanceof HTMLElement)) continue;
      const range = content.range(anchor.cfi);
      const rect = Array.from(range.getClientRects())
        .find((candidate) => candidate.width > 0 || candidate.height > 0);
      if (!rect) continue;
      const currentY = frame.getBoundingClientRect().top + rect.top;
      const delta = targetY - currentY;
      if (Math.abs(delta) < 0.5) return;

      const scroller = viewport.querySelector<HTMLElement>('.epub-container');
      if (scroller) scroller.scrollTop -= delta;
      return;
    } catch {
      // The CFI belongs to another rendered spine item.
    }
  }
}

function locateAnchorViewportY(rendition: Rendition, cfi: string): number | null {
  const viewport = document.getElementById('epub-reader-viewport');
  if (!viewport) return null;
  const viewportTop = viewport.getBoundingClientRect().top;
  for (const content of rendition.getContents()) {
    try {
      const frame = content.window.frameElement;
      if (!(frame instanceof HTMLElement)) continue;
      const range = content.range(cfi);
      const rect = Array.from(range.getClientRects())
        .find((candidate) => candidate.width > 0 || candidate.height > 0);
      if (rect) return frame.getBoundingClientRect().top + rect.top - viewportTop;
    } catch {
      // The CFI is owned by another rendered spine item.
    }
  }
  return null;
}
