export type PageTurnDirection = 'previous' | 'next';

interface PageTurnSurface {
  container: HTMLElement;
  direction: PageTurnDirection;
  originScrollLeft: number;
  pageDistance: number;
  targetScrollLeft: number;
  directionSign: number;
}

interface RenditionPageTurnLayout {
  manager?: {
    container?: HTMLElement;
    layout?: { delta?: number };
    settings?: { axis?: string };
  };
}

function createSurface(rendition: unknown, direction: PageTurnDirection): PageTurnSurface | null {
  const manager = (rendition as RenditionPageTurnLayout | null)?.manager;
  // Bind to this rendition's container, never a later book's global viewport.
  const container = manager?.container;
  if (!container?.isConnected || container.scrollWidth <= container.clientWidth + 1) return null;
  if (manager?.settings?.axis === 'vertical' || getComputedStyle(container).direction === 'rtl') return null;
  const delta = manager?.layout?.delta;
  const pageDistance = typeof delta === 'number' && Number.isFinite(delta) && delta > 0
    ? delta : container.clientWidth;
  const originScrollLeft = container.scrollLeft;
  const directionSign = direction === 'next' ? 1 : -1;
  const targetScrollLeft = originScrollLeft + directionSign * pageDistance;
  if (targetScrollLeft < 0 || targetScrollLeft > container.scrollWidth - container.clientWidth) return null;
  return { container, direction, originScrollLeft, pageDistance, targetScrollLeft, directionSign };
}

/** Owns only EPUB.js surface motion. React owns the visible gesture indicator. */
export function createPageTurnController(rendition: unknown) {
  let surface: PageTurnSurface | null = null;
  let frameId: number | null = null;
  let disposed = false;
  let revision = 0;
  const stop = () => {
    ++revision;
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    frameId = null;
  };
  const reset = () => {
    stop();
    if (surface?.container.isConnected) surface.container.scrollLeft = surface.originScrollLeft;
    surface = null;
  };
  const animate = (target: number, durationMs: number) => {
    stop();
    const active = surface;
    if (!active?.container.isConnected) { surface = null; return; }
    const start = active.container.scrollLeft;
    const distance = target - start;
    if (Math.abs(distance) < 0.5 || durationMs <= 0) {
      active.container.scrollLeft = target;
      surface = null;
      return;
    }
    const startedAt = performance.now();
    const currentRevision = revision;
    const frame = (now: number) => {
      if (disposed || currentRevision !== revision || surface !== active) return;
      if (!active.container.isConnected) { frameId = null; surface = null; return; }
      const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
      active.container.scrollLeft = start + distance * (1 - ((1 - progress) ** 3));
      if (progress < 1) frameId = window.requestAnimationFrame(frame);
      else { frameId = null; surface = null; }
    };
    frameId = window.requestAnimationFrame(frame);
  };
  return {
    update(direction: PageTurnDirection, distancePx: number): boolean {
      if (disposed) return false;
      if (!surface || surface.direction !== direction) {
        reset();
        surface = createSurface(rendition, direction);
      } else {
        stop();
      }
      if (!surface?.container.isConnected) { surface = null; return false; }
      const distance = Math.min(surface.pageDistance, Math.max(0, Number.isFinite(distancePx) ? distancePx : 0));
      surface.container.scrollLeft = surface.originScrollLeft + surface.directionSign * distance;
      return true;
    },
    cancel(durationMs: number) {
      if (!disposed && surface) animate(surface.originScrollLeft, durationMs);
    },
    commit(direction: PageTurnDirection, durationMs: number): boolean {
      if (disposed || surface?.direction !== direction || !surface.container.isConnected) {
        reset();
        return false;
      }
      animate(surface.targetScrollLeft, durationMs);
      return true;
    },
    reset,
    dispose() { disposed = true; reset(); },
  };
}
