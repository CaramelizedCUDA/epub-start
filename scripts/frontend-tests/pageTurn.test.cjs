const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { createPageTurnController } = require(path.join(
  process.env.FRONTEND_TEST_BUILD_DIR, 'compiled/features/reader/engine/pageTurn.js',
));

// Keep a real-looking surface so the old direct-motion implementation fails.
// Visual feedback must never update the Reader's content or reading location.
function fixture() {
  const frames = new Map(); let id = 0;
  global.window = {
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: key => frames.delete(key),
  };
  global.getComputedStyle = () => ({ direction: 'ltr' });
  const container = { isConnected: true, scrollLeft: 600, scrollWidth: 3600, clientWidth: 600 };
  const manager = { container, layout: { delta: 600 }, settings: { axis: 'horizontal' } };
  return { controller: createPageTurnController({ manager }), container, manager, frames };
}

test('gesture feedback leaves the content still and release submits one logical page turn', () => {
  const f = fixture();
  assert.equal(f.controller.update('next', 240), false, 'React supplies visual feedback');
  assert.equal(f.container.scrollLeft, 600, 'drag must not emit a temporary reading location');
  let logicalTurns = 0;
  // Match the existing EpubReader commit fallback, shared with buttons/keys.
  if (!f.controller.commit('next', 260)) logicalTurns += 1;
  assert.equal(logicalTurns, 1, 'release requests exactly one store navigation');
  assert.equal(f.container.scrollLeft, 600, 'feedback must not also turn the content');
  assert.equal(f.frames.size, 0, 'no late content animation races the logical turn');
});

test('cancel and retirement cannot move the old surface or a replacement book', () => {
  const f = fixture();
  f.controller.update('previous', 150); f.controller.cancel(180);
  assert.equal(f.container.scrollLeft, 600, 'cancel preserves the reading position');
  f.controller.dispose();
  const replacement = { ...f.container, scrollLeft: 1200 };
  f.manager.container = replacement;
  assert.equal(f.controller.update('next', 180), false);
  assert.equal(f.controller.commit('next', 260), false);
  f.controller.reset();
  assert.equal(replacement.scrollLeft, 1200, 'retired feedback does not bind the next book');
  assert.equal(f.container.scrollLeft, 600);
  assert.equal(f.frames.size, 0);
});

test('chapter edges, continuous flow and RTL retain the same logical fallback', () => {
  const f = fixture();
  for (const configure of [
    () => { f.container.scrollLeft = 3000; },
    () => { f.manager.settings.axis = 'vertical'; },
    () => { f.manager.settings.direction = 'rtl'; },
    () => { f.container.isConnected = false; },
  ]) {
    configure();
    assert.equal(f.controller.update('next', 100), false);
    assert.equal(f.controller.commit('next', 260), false);
  }
  assert.equal(f.container.scrollLeft, 3000);
});
