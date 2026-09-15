import type { TocItem } from 'epubjs';

interface ReaderLocationUpdate {
  currentCfi: string;
  currentPage: number;
  totalPages: number;
  currentChapterHref: string | null;
}

export function createRelocatedHandler(
  readToc: () => TocItem[],
  update: (location: ReaderLocationUpdate) => void,
  isActive: () => boolean,
  onProgress: (cfi: string, progression: number) => void,
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
