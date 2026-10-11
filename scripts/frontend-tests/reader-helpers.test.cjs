const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const root = process.env.FRONTEND_TEST_BUILD_DIR;
if (!root) throw new Error('Run through scripts/test-frontend.mjs --reader');
const compiled = path.join(root, 'compiled/features/reader');
const { queueSettingsWrite } = require(path.join(compiled, 'settingsPersistence.js'));
const { isReaderPageKey, ignoreReaderShortcut, installReaderKeyboard } = require(path.join(compiled, 'engine/keyboard.js'));
const { installImageInteractions } = require(path.join(compiled, 'engine/imageInteractions.js'));
const { withBookTimeout, installProgressLifecycle } = require(path.join(compiled, 'engine/lifecycle.js'));
const { createRelocatedHandler } = require(path.join(compiled, 'engine/navigation.js'));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const gate = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

test('a clear cannot overtake the older settings write that would recreate its override', async () => {
  const first = gate(); const events = [];
  const save = queueSettingsWrite(async () => { events.push('save-start'); await first.promise; events.push('save-end'); });
  const clear = queueSettingsWrite(async () => { events.push('clear'); });
  await tick();
  try { assert.deepEqual(events, ['save-start']); } finally { first.resolve(); await Promise.all([save, clear]); }
  assert.deepEqual(events, ['save-start', 'save-end', 'clear']);
});

test('a rejected settings write does not poison the next queued action', async () => {
  await assert.rejects(queueSettingsWrite(async () => { throw new Error('controlled failure'); }), /controlled failure/);
  let executed = false;
  await assert.doesNotReject(queueSettingsWrite(async () => { executed = true; }));
  assert.equal(executed, true);
});

test('Reader keys leave composition, modified shortcuts and handled events alone', () => {
  for (const flag of ['isComposing', 'ctrlKey', 'altKey', 'metaKey', 'defaultPrevented']) {
    assert.equal(ignoreReaderShortcut({ key: 'Escape', [flag]: true }), true, flag);
    assert.equal(isReaderPageKey({ key: 'ArrowRight', [flag]: true }, false), false, flag);
  }
  assert.equal(ignoreReaderShortcut({ keyCode: 229 }), true);
});

test('page keys cannot turn content behind overlays or editable descendants', () => {
  assert.equal(isReaderPageKey({ key: 'ArrowRight', target: null }, true), false);
  assert.equal(isReaderPageKey({ key: 'ArrowRight', target: { isContentEditable: true } }, false), false);
  assert.equal(isReaderPageKey({ key: 'ArrowRight', target: { closest: () => ({ tagName: 'BUTTON' }) } }, false), false);
  assert.equal(isReaderPageKey({ key: 'ArrowRight', target: null }, false), true);
});

test('successful and failed book loads both clear their timeout timer', async () => {
  const realSet = global.setTimeout, realClear = global.clearTimeout;
  const timers = new Set(); let next = 0;
  global.setTimeout = () => { timers.add(++next); return next; };
  global.clearTimeout = (timer) => timers.delete(timer);
  try {
    assert.equal(await withBookTimeout(Promise.resolve(7), 'test success'), 7);
    await assert.rejects(withBookTimeout(Promise.reject(new Error('load failed')), 'test failure'), /load failed/);
    assert.equal(timers.size, 0);
  } finally { global.setTimeout = realSet; global.clearTimeout = realClear; }
});

test('suspension flush listeners belong to the active reader and are removed on cleanup', async () => {
  const docs = new Map(), windows = new Map(); let active = true, flushes = 0;
  const oldWindow = global.window, oldDocument = global.document;
  global.document = { visibilityState: 'hidden', addEventListener: (name, fn) => docs.set(name, fn),
    removeEventListener: (name, fn) => { if (docs.get(name) === fn) docs.delete(name); } };
  global.window = { addEventListener: (name, fn) => windows.set(name, fn),
    removeEventListener: (name, fn) => { if (windows.get(name) === fn) windows.delete(name); } };
  let cleanup;
  try {
    cleanup = installProgressLifecycle(async () => { flushes += 1; }, () => active);
    docs.get('visibilitychange')(); windows.get('pagehide')(); await tick(); assert.equal(flushes, 2);
    active = false; windows.get('pagehide')(); assert.equal(flushes, 2);
    cleanup(); assert.equal(docs.size + windows.size, 0);
  } finally { cleanup?.(); global.window = oldWindow; global.document = oldDocument; }
});

// Controlled document dispatch models passive cancellation; not a browser UI test.
function keyboardDocument() {
  const listeners = new Map();
  return {
    addEventListener: (_name, fn, options) => listeners.set(fn, options),
    removeEventListener: (_name, fn) => listeners.delete(fn),
    press() {
      const event = { key: 'ArrowRight', defaultPrevented: false };
      for (const [fn, options] of listeners) {
        event.preventDefault = () => { if (!options?.passive) event.defaultPrevented = true; };
        fn(event);
      }
      return event;
    },
  };
}

function keyboardRendition(document) {
  const handlers = new Map();
  return {
    documents: [document], handlers,
    getContents() { return this.documents.map((document) => ({ document })); },
    on: (name, callback) => handlers.set(name, callback),
    off: (name, callback) => { if (handlers.get(name) === callback) handlers.delete(name); },
  };
}

test('iframe page keys suppress default scrolling and bind each document once', () => {
  const document = keyboardDocument();
  const rendition = keyboardRendition(document);
  let turns = 0;
  const cleanup = installReaderKeyboard(rendition, (event) => { event.preventDefault(); turns += 1; });
  try {
    rendition.handlers.get('rendered')();
    rendition.handlers.get('relocated')();
    assert.equal(document.press().defaultPrevented, true, 'page key must cancel native scrolling');
    assert.equal(turns, 1);
  } finally { cleanup(); }
});

test('retired iframe documents and late rendition events cannot turn the new reader', () => {
  const oldDocument = keyboardDocument(), newDocument = keyboardDocument();
  const rendition = keyboardRendition(oldDocument);
  let turns = 0;
  const cleanup = installReaderKeyboard(rendition, () => { turns += 1; });
  const lateRendered = rendition.handlers.get('rendered');
  rendition.documents = [newDocument];
  rendition.handlers.get('relocated')();
  oldDocument.press();
  assert.equal(turns, 0, 'retired document must detach');
  newDocument.press();
  assert.equal(turns, 1);
  cleanup();
  lateRendered();
  newDocument.press();
  assert.equal(turns, 1, 'cleanup must prevent old events from rebinding');
  assert.equal(rendition.handlers.size, 0);
});

test('image viewer URL encodes reserved filename characters while keeping the entry path decoded', () => {
  const rootUrl = 'http://epub.localhost/book/book-1/';
  const oldWindow = global.window;
  const listeners = new Map();
  let imageHref = '';
  let opened = null;

  // This document dispatch reaches the production image click handler and URL builder.
  const document = {
    baseURI: `${rootUrl}OEBPS/Text/chapter.xhtml`,
    images: [],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => {
      if (listeners.get(name) === handler) listeners.delete(name);
    },
  };
  const image = {
    tagName: 'IMG',
    ownerDocument: document,
    style: {},
    alt: 'fixture image',
    getAttribute: (name) => name === 'src' ? imageHref : null,
    setAttribute: () => {},
  };
  document.images.push(image);
  const rendition = {
    getContents: () => [{ document, window: {} }],
    on: () => {},
    off: () => {},
  };
  const handlers = {
    onOpen: (target) => { opened = target; },
    onContextMenu: () => {},
    onError: (message) => { throw new Error(message); },
    onPreviousPage: () => {},
    onNextPage: () => {},
    onPageTurnGestureMove: () => {},
    onPageTurnGestureCancel: () => {},
    onPageTurnGestureCommit: () => {},
    onToggleNavigation: () => {},
    isPaginated: () => false,
  };

  global.window = { document: { getElementById: () => null } };
  let cleanup;
  try {
    cleanup = installImageInteractions(rendition, rootUrl, 'book-1', handlers);
    for (const [href, entryPath, displayUrl] of [
      ['../Images/100%25.png', 'OEBPS/Images/100%.png', `${rootUrl}OEBPS/Images/100%25.png`],
      ['../Images/a%23b.png', 'OEBPS/Images/a#b.png', `${rootUrl}OEBPS/Images/a%23b.png`],
      ['../Images/a%3Fb.png', 'OEBPS/Images/a?b.png', `${rootUrl}OEBPS/Images/a%3Fb.png`],
      ['../Images/literal%2520.png', 'OEBPS/Images/literal%20.png', `${rootUrl}OEBPS/Images/literal%2520.png`],
    ]) {
      imageHref = href;
      opened = null;
      listeners.get('click')({ target: image, preventDefault() {}, stopPropagation() {} });
      assert.equal(opened?.entryPath, entryPath, `decoded ZIP path for ${href}`);
      assert.equal(opened?.url, displayUrl, `viewer URL for ${href}`);
    }
  } finally {
    cleanup?.();
    global.window = oldWindow;
  }
});

// These fixtures exercise the production location adapter at the native failure
// boundary. They do not claim to reproduce EPUB.js DOM mapping or Android input.
function pageReadoutFixture(start, overrides = {}) {
  const view = {
    section: { index: 0, href: 'chapter.xhtml' },
    position: () => ({ left: -start }),
  };
  return { manager: {
    name: 'default', isPaginated: true,
    settings: { axis: 'horizontal', direction: 'ltr', fullsize: false },
    layout: { name: 'reflowable', pageWidth: 412, divisor: 1 },
    container: { isConnected: true, getBoundingClientRect: () => ({ left: 0 }) },
    visible: () => [view],
    ...overrides,
  } };
}

function pageReadoutLocation(page, href = 'chapter.xhtml') {
  return { start: {
    index: 0, href, cfi: 'epubcfi(/6/2!/4/10/1:0)',
    displayed: { page, total: 5 },
  } };
}

test('fractional native page boundaries report the visible second and last page without changing CFI', () => {
  let rendition = pageReadoutFixture(411.80950927734375);
  let updated, saved;
  const handler = createRelocatedHandler(() => [], (value) => { updated = value; },
    () => true, (cfi, progression) => { saved = { cfi, progression }; }, () => rendition);
  const location = pageReadoutLocation(1);
  handler(location);
  assert.equal(updated.currentPage, 2, 'visible second page must not still read page one');
  assert.equal(saved.cfi, location.start.cfi);
  assert.equal(saved.progression, 2 / 5, 'saving keeps the existing chapter-level page/total meaning');
  assert.equal(location.start.displayed.page, 1, 'the native event is not mutated');

  rendition = pageReadoutFixture(1647.8095092773438);
  handler(pageReadoutLocation(4));
  assert.equal(updated.currentPage, 5, 'fractional chapter-end position must read the last page');
  rendition = pageReadoutFixture(0);
  handler(pageReadoutLocation(1));
  assert.equal(updated.currentPage, 1, 'a new chapter starts at its own first page');
  rendition = pageReadoutFixture(1648);
  handler(pageReadoutLocation(5));
  assert.equal(updated.currentPage, 5, 'returning to an exact last-page boundary adds nothing');
});

test('readout correction requires the measured single-page LTR boundary and matching section', () => {
  const samples = [
    [pageReadoutFixture(410.9), 1], // More than one CSS pixel short is a real partial page.
    [pageReadoutFixture(412), 2],
    [pageReadoutFixture(411.8, { settings: { axis: 'vertical' } }), 1],
    [pageReadoutFixture(411.8, { settings: { axis: 'horizontal', direction: 'rtl' } }), 1],
    [pageReadoutFixture(411.8, { settings: { axis: 'horizontal', fullsize: true } }), 1],
    [pageReadoutFixture(411.8, { layout: { name: 'pre-paginated', pageWidth: 412, divisor: 1 } }), 1],
    [pageReadoutFixture(411.8, { layout: { name: 'reflowable', pageWidth: 206, divisor: 2 } }), 1],
    [pageReadoutFixture(411.8, { visible: () => [{
      section: { index: 1, href: 'next.xhtml' }, position: () => ({ left: -411.8 }),
    }] }), 1],
    [pageReadoutFixture(823.8), 1], // A lagging event cannot jump two pages based on newer geometry.
    [null, 1],
  ];
  for (const [rendition, nativePage] of samples) {
    let updated;
    const handler = createRelocatedHandler(() => [], (value) => { updated = value; },
      () => true, () => {}, () => rendition);
    handler(pageReadoutLocation(nativePage));
    assert.equal(updated.currentPage, nativePage);
  }
});

test('retired relocated callbacks never consult geometry from a newer rendition', () => {
  const handler = createRelocatedHandler(() => [], () => { assert.fail('retired update'); },
    () => false, () => { assert.fail('retired save'); },
    () => { assert.fail('retired geometry read'); });
  handler(pageReadoutLocation(1));
});
