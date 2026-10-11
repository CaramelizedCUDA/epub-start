export type PageTurnDirection = 'previous' | 'next';

/**
 * React owns gesture feedback; all committed turns use the store's Rendition
 * navigation. Moving scrollLeft during a preview could publish temporary CFIs
 * and race a resize, so this compatibility controller never moves the content.
 */
export function createPageTurnController(_rendition: unknown) {
  return {
    update(_direction: PageTurnDirection, _distancePx: number): boolean {
      return false;
    },
    cancel(_durationMs: number) {},
    commit(_direction: PageTurnDirection, _durationMs: number): boolean {
      // False tells EpubReader to submit exactly one normal logical page turn.
      return false;
    },
    reset() {},
    dispose() {},
  };
}
