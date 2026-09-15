const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const root = process.env.FRONTEND_TEST_BUILD_DIR;
if (!root) throw new Error('Run through scripts/test-frontend.mjs --reader');
const compiled = path.join(root, 'compiled/features/reader');
const { queueSettingsWrite } = require(path.join(compiled, 'settingsPersistence.js'));
const { isReaderPageKey, ignoreReaderShortcut, installReaderKeyboard } = require(path.join(compiled, 'engine/keyboard.js'));
const { withBookTimeout, installProgressLifecycle } = require(path.join(compiled, 'engine/lifecycle.js'));
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
