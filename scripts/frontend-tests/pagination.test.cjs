const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { installPaginationGuard, disposePaginationGuard } = require(path.join(
  process.env.FRONTEND_TEST_BUILD_DIR, 'compiled/features/reader/engine/pagination.js',
));
// Use the installed EPUB.js methods, with controlled view/queue boundaries.
// These numerical locations are not real CFIs or WebView layout evidence.
const DefaultManager = require(path.resolve(__dirname, '../../node_modules/epubjs/lib/managers/default/index.js')).default;
const Rendition = require(path.resolve(__dirname, '../../node_modules/epubjs/lib/rendition.js')).default;

function fixture(width = 600) {
  const container = {
    isConnected: true, clientWidth: width, offsetWidth: width,
    scrollWidth: width * 4, scrollLeft: width * 2 + 0.25, scrollTop: 0,
  };
  const calls = { native: 0, chapters: 0, reports: [] };
  const section = { next: () => ({ index: 1, properties: [] }) };
  const manager = Object.assign(Object.create(DefaultManager.prototype), {
    name: 'default', isPaginated: true, container,
    settings: { axis: 'horizontal', direction: 'ltr', fullsize: false },
    layout: { name: 'reflowable', delta: width, divisor: width === 1200 ? 2 : 1 },
    views: { length: 1, last: () => ({ section }), show() {} },
    clear() { container.scrollLeft = 0; }, updateLayout() {},
    append() { calls.chapters += 1; return Promise.resolve(); },
  });
  manager.next = function () { calls.native += 1; return DefaultManager.prototype.next.call(this); };
  let tail = Promise.resolve();
  const handlers = new Map();
  const rendition = {
    manager,
    on: (event, fn) => handlers.set(event, fn),
    off: (event, fn) => { if (handlers.get(event) === fn) handlers.delete(event); },
    // Serialize the actual Rendition.next calls without constructing a DOM.
    q: { enqueue(fn) { tail = tail.then(fn); return tail; } },
    reportLocation() { calls.reports.push(container.scrollLeft); },
    next: Rendition.prototype.next,
  };
  return { rendition, manager, container, calls, handlers };
}

test('a native boundary rejection displays the remaining chapter tail before crossing', async () => {
  const f = fixture(); installPaginationGuard(f.rendition);
  try {
    await f.rendition.next();
    assert.equal(f.container.scrollLeft, 1800, 'the unread tail must appear before another spine loads');
    assert.equal(f.calls.chapters, 0);
    assert.equal(f.calls.native, 0);
    assert.deepEqual(f.calls.reports, [1800], 'Rendition still reports the final position');
    await f.rendition.next();
    assert.equal(f.calls.chapters, 1, 'the following next crosses exactly once');
    assert.equal(f.calls.native, 1);
  } finally { disposePaginationGuard(f.rendition); }
});

test('double-page turns keep the full spread delta and queued turns retain the tail', async () => {
  const f = fixture(1200); installPaginationGuard(f.rendition);
  try {
    await Promise.all([f.rendition.next(), f.rendition.next()]);
    assert.deepEqual(f.calls.reports, [3600, 0], 'show the final spread before entering the next chapter');
    assert.equal(f.calls.chapters, 1);
    assert.equal(f.manager.layout.delta, 1200, 'the guard must not rewrite EPUB.js geometry');
  } finally { disposePaginationGuard(f.rendition); }
});

test('ordinary pages and rounding-only terminal residual use the native manager', async () => {
  const f = fixture(); installPaginationGuard(f.rendition);
  try {
    f.container.scrollLeft = 600;
    await f.rendition.next();
    assert.equal(f.container.scrollLeft, 1200);
    assert.equal(f.calls.native, 1);
    f.container.scrollLeft = 1799.75;
    await f.rendition.next();
    assert.equal(f.calls.chapters, 1, 'a quarter-pixel residual must not add a nearly duplicate page');
  } finally { disposePaginationGuard(f.rendition); }
});

test('unsupported layout, direction, manager and invalid geometry retain native navigation', () => {
  for (const configure of [
    f => { f.manager.name = 'continuous'; },
    f => { f.manager.isPaginated = false; },
    f => { f.manager.settings.axis = 'vertical'; },
    f => { f.manager.settings.direction = 'rtl'; },
    f => { f.manager.settings.fullsize = true; },
    f => { f.manager.layout.name = 'pre-paginated'; },
    f => { f.manager.layout.delta = NaN; },
    f => { f.manager.views.length = 0; },
    f => { f.container.isConnected = false; },
  ]) {
    const f = fixture(); configure(f);
    let nativeCalls = 0;
    f.manager.next = () => { nativeCalls += 1; return 'native'; };
    installPaginationGuard(f.rendition);
    try {
      assert.equal(f.manager.next(), 'native');
      assert.equal(nativeCalls, 1);
      assert.equal(f.container.scrollLeft, 1200.25);
    } finally { disposePaginationGuard(f.rendition); }
  }
});

test('startup attachment is idempotent and disposal restores the owned method', () => {
  const f = fixture(); const originalNext = f.manager.next;
  delete f.rendition.manager;
  installPaginationGuard(f.rendition);
  f.rendition.manager = f.manager; f.handlers.get('started')();
  const queuedOldNext = f.manager.next;
  installPaginationGuard(f.rendition);
  assert.equal(f.manager.next, queuedOldNext, 'do not wrap twice');
  disposePaginationGuard(f.rendition);
  assert.equal(f.manager.next, originalNext);
  assert.equal(f.handlers.has('started'), false);
  queuedOldNext();
  assert.equal(f.container.scrollLeft, 1200.25, 'captured old work must not revive a closed view');
  assert.equal(f.calls.native, 0);
});

test('disposing before startup prevents a late guard attaching to a retired rendition', () => {
  const f = fixture(); const originalNext = f.manager.next;
  delete f.rendition.manager;
  installPaginationGuard(f.rendition); const lateStarted = f.handlers.get('started');
  disposePaginationGuard(f.rendition);
  f.rendition.manager = f.manager; lateStarted();
  assert.equal(f.manager.next, originalNext);
  assert.equal(f.handlers.size, 0);
});

test('disposal restores an inherited method without keeping an instance override', () => {
  const f = fixture(); delete f.manager.next;
  installPaginationGuard(f.rendition);
  assert.equal(Object.hasOwn(f.manager, 'next'), true);
  disposePaginationGuard(f.rendition);
  assert.equal(Object.hasOwn(f.manager, 'next'), false);
  assert.equal(f.manager.next, DefaultManager.prototype.next);
});
