import type { TocItem } from 'epubjs';

interface ReaderLocationUpdate {
  currentCfi: string;
  currentPage: number;
  totalPages: number;
  currentChapterHref: string | null;
}

interface RelocatedStart {
  index?: number;
  cfi: string;
  href: string;
  displayed: { page: number; total: number };
}

interface PageReadoutRendition {
  manager?: {
    name?: string;
    isPaginated?: boolean;
    settings?: { axis?: string; direction?: string; fullsize?: boolean };
    layout?: { name?: string; pageWidth?: number; divisor?: number };
    container?: HTMLElement;
    visible?: () => Array<{
      section: { index: number; href: string };
      position: () => { left: number };
    }>;
  };
}

// Scroll dimensions are rounded to CSS pixels, while WebView keeps fractional
// view positions. Only absorb the last pixel before a measured page boundary.
const PAGE_BOUNDARY_TOLERANCE_PX = 1;

function visibleChapterPage(start: RelocatedStart, rendition: object | null): number {
  const page = start.displayed.page;
  const total = start.displayed.total;
  const manager = (rendition as PageReadoutRendition | null)?.manager;
  const pageWidth = manager?.layout?.pageWidth;
  if (manager?.name !== 'default' || manager.isPaginated !== true
    || manager.settings?.axis !== 'horizontal' || manager.settings.direction !== 'ltr'
    || manager.settings.fullsize || manager.layout?.name !== 'reflowable'
    || manager.layout.divisor !== 1 || !manager.container?.isConnected
    || typeof pageWidth !== 'number' || !Number.isFinite(pageWidth) || pageWidth <= 0
    || !Number.isInteger(page) || !Number.isInteger(total) || page < 1 || page >= total) return page;

  // Match the first visible section used by EPUB.js's location calculation.
  // Never borrow a newer chapter's geometry to correct an older relocated event.
  const view = manager.visible?.()[0];
  if (!view || view.section.href !== start.href
    || (start.index !== undefined && view.section.index !== start.index)) return page;
  const offset = manager.container.getBoundingClientRect().left - view.position().left;
  if (!Number.isFinite(offset) || offset < 0) return page;
  const boundary = Math.round(offset / pageWidth);
  const shortfall = boundary * pageWidth - offset;
  const corrected = boundary + 1;
  // A stable fractional shortfall can make floor report the preceding page.
  // Mid-page positions, already-correct counts and larger lag stay native.
  return shortfall > 0 && shortfall <= PAGE_BOUNDARY_TOLERANCE_PX
    && page === Math.floor(offset / pageWidth) + 1
    && corrected === page + 1 && corrected <= total ? corrected : page;
}

export function createRelocatedHandler(
  readToc: () => TocItem[],
  update: (location: ReaderLocationUpdate) => void,
  isActive: () => boolean,
  onProgress: (cfi: string, progression: number) => void,
  readRendition: () => object | null = () => null,
): (...args: unknown[]) => void {
  return (location: unknown) => {
    if (!isActive()) return;
    const loc = location as { start: RelocatedStart };
    const cfi = loc.start.cfi;
    const page = visibleChapterPage(loc.start, readRendition());
    const total = loc.start.displayed.total;
    // Correcting the readout also corrects the existing chapter-level ratio.
    // Keep the native CFI and do not present this ratio as whole-book progress.
    const progression = total > 0 ? page / total : 0;

    update({
      currentCfi: cfi,
      currentPage: page,
      totalPages: total,
      currentChapterHref: resolveCurrentChapterHref(readToc(), loc.start.href),
    });
    if (!isActive()) return;
    onProgress(cfi, progression);
  };
}

function normalizeHref(href: string): string {
  const withoutFragment = href.split('#', 1)[0];
  try {
    return decodeURIComponent(withoutFragment).replace(/^\.\//, '');
  } catch {
    return withoutFragment.replace(/^\.\//, '');
  }
}

function flattenToc(items: TocItem[]): TocItem[] {
  return items.flatMap((item) => [item, ...flattenToc(item.subitems ?? [])]);
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
