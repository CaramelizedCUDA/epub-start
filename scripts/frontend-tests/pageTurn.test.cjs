const assert = require('node:assert/strict');
const path = require('node:path');
const { test, afterEach } = require('node:test');
const { createPageTurnController } = require(path.join(
  process.env.FRONTEND_TEST_BUILD_DIR, 'compiled/features/reader/engine/pageTurn.js',
));
const originalWindow = global.window, originalStyle = global.getComputedStyle;
afterEach(() => { global.window = originalWindow; global.getComputedStyle = originalStyle; });

function fixture() {
  const frames = new Map(); let id = 0;
  global.window = {
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: key => frames.delete(key),
  };
  global.getComputedStyle = element => ({ direction: element.direction ?? 'ltr' });
  const container = { isConnected: true, scrollLeft: 600, scrollWidth: 3600, clientWidth: 600 };
  const manager = { container, layout: { delta: 600 }, settings: { axis: 'horizontal' } };
  const controller = createPageTurnController({ manager });
  return { controller, container, manager, frames,
    finish: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(performance.now() + 1000)); } };
}

test('gesture commit uses the manager page distance and cancel restores the origin', () => {
  const f = fixture(); f.manager.layout.delta = 1200;
  assert.equal(f.controller.update('next', 240), true);
  assert.equal(f.container.scrollLeft, 840);
  assert.equal(f.controller.commit('next', 260), true); f.finish();
  assert.equal(f.container.scrollLeft, 1800, 'finish at the EPUB.js page boundary');
  assert.equal(f.controller.update('previous', 150), true);
  f.controller.cancel(180); f.finish();
  assert.equal(f.container.scrollLeft, 1800, 'cancel must restore the same page');
});

test('a retired gesture cannot move a new book or revive a cancelled animation', () => {
  const f = fixture(); f.controller.update('next', 180); f.controller.commit('next', 260);
  const late = [...f.frames.values()][0]; f.controller.dispose();
  assert.equal(f.container.scrollLeft, 600);
  const replacement = { ...f.container, scrollLeft: 1200 };
  f.manager.container = replacement;
  late(performance.now() + 1000);
  assert.equal(f.container.scrollLeft, 600, 'retired animation must not move its old surface');
  assert.equal(f.controller.update('next', 180), false);
  assert.equal(replacement.scrollLeft, 1200, 'retired controller must not bind the new book');
});

test('chapter boundaries, continuous flow and RTL fall back to rendition navigation', () => {
  const f = fixture(); f.container.scrollLeft = 3000;
  assert.equal(f.controller.update('next', 100), false);
  f.manager.settings.axis = 'vertical';
  assert.equal(f.controller.update('previous', 100), false);
  f.manager.settings.axis = 'horizontal'; f.container.direction = 'rtl';
  assert.equal(f.controller.update('previous', 100), false);
  f.container.direction = 'ltr'; f.container.isConnected = false;
  assert.equal(f.controller.update('previous', 100), false);
  assert.equal(f.container.scrollLeft, 3000);
});
