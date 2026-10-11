interface PaginationManager {
  name?: string;
  isPaginated?: boolean;
  container?: HTMLElement;
  views?: { length: number };
  layout?: { name?: string; delta?: number };
  settings?: { axis?: string; direction?: string; fullsize?: boolean };
  scrollLeft?: number;
  scrollTo?: (left: number, top: number, silent?: boolean) => void;
  next?: () => unknown;
}

interface PaginationRendition {
  manager?: PaginationManager;
  on?: (event: string, handler: () => void) => unknown;
  off?: (event: string, handler: () => void) => unknown;
}

const paginationDisposers = new WeakMap<object, () => void>();
// A one-pixel residual can be integer scrollWidth rounding, not another page.
const SCROLL_END_TOLERANCE_PX = 1;

/**
 * Defend a remaining same-chapter page against EPUB.js's full-page comparison.
 * This is a boundary safeguard, not evidence of the reported layout root cause.
 * Only replace manager.next: rendition.next retains its queue and CFI reporting.
 */
export function installPaginationGuard(rendition: object): void {
  if (paginationDisposers.has(rendition)) return;
  const host = rendition as PaginationRendition;
  let disposed = false;
  let restoreManager: (() => void) | null = null;

  const attach = () => {
    if (disposed || restoreManager) return;
    const manager = host.manager;
    if (!manager?.next) return;
    const originalNext = manager.next;
    const originalDescriptor = Object.getOwnPropertyDescriptor(manager, 'next');
    const guardedNext = () => {
      // A queued callback captured before close must not revive the old view.
      if (disposed) return;
      const container = manager.container;
      const delta = manager.layout?.delta;
      const supported = manager.name === 'default'
        && manager.isPaginated === true
        && manager.layout?.name === 'reflowable'
        && manager.settings?.axis === 'horizontal'
        && (!manager.settings.direction || manager.settings.direction === 'ltr')
        && !manager.settings.fullsize
        && (manager.views?.length ?? 0) > 0
        && container?.isConnected
        && typeof delta === 'number' && Number.isFinite(delta) && delta > 0
        && typeof manager.scrollTo === 'function';
      if (supported && container && typeof delta === 'number') {
        const left = container.scrollLeft;
        const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
        const remaining = maxLeft - left;
        const nativeTargetEnd = left + container.offsetWidth + delta;
        if (Number.isFinite(left) && container.clientWidth > 0
          && remaining > SCROLL_END_TOLERANCE_PX
          && nativeTargetEnd > container.scrollWidth) {
          // Show the remaining tail first; the following next uses native spine
          // navigation. Never mutate delta/pageWidth or synthesize a location.
          manager.scrollLeft = left;
          manager.scrollTo!(Math.min(left + delta, maxLeft), container.scrollTop, true);
          return;
        }
      }
      return originalNext.call(manager);
    };
    manager.next = guardedNext;
    restoreManager = () => {
      if (manager.next !== guardedNext) return;
      // Native managers inherit next from their prototype. Restore that shape
      // as well as the method, without replacing another owner's later change.
      if (originalDescriptor) Object.defineProperty(manager, 'next', originalDescriptor);
      else delete manager.next;
    };
  };

  // The manager may not exist until asynchronous Rendition.start completes.
  host.on?.('started', attach);
  attach();
  paginationDisposers.set(rendition, () => {
    disposed = true;
    host.off?.('started', attach);
    restoreManager?.();
    paginationDisposers.delete(rendition);
  });
}

/** Restore the exact owned manager method and unregister pending startup work. */
export function disposePaginationGuard(rendition: object | null): void {
  if (rendition) paginationDisposers.get(rendition)?.();
}
