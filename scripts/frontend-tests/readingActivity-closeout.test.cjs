// Exercises the actual effect's coordination, not React scheduling or OS visibility.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, afterEach } = require('node:test');
const root = process.env.FRONTEND_TEST_BUILD_DIR;
if (!root) throw new Error('Run through scripts/test-frontend.mjs --reader');
const react = require(path.join(root, 'node_modules/react'));
const ipc = require(path.join(root, 'compiled/lib/tauri.js'));
const { useReadingActivity } = require(path.join(root, 'compiled/features/reader/useReadingActivity.js'));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const gate = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
async function until(predicate) { for (let i = 0; i < 100; i += 1) { if (predicate()) return; await tick(); } throw new Error('Did not reach observation step'); }
let cleanup;
function mount() {
  const documentEvents = new Map(), windowEvents = new Map(), timeouts = new Map(), intervals = new Map();
  const add = (map) => (name, fn) => { const set = map.get(name) ?? new Set(); set.add(fn); map.set(name, set); };
  const remove = (map) => (name, fn) => map.get(name)?.delete(fn);
  let id = 0, focused = true;
  global.document = { visibilityState: 'visible', hasFocus: () => focused,
    addEventListener: add(documentEvents), removeEventListener: remove(documentEvents) };
  global.window = { addEventListener: add(windowEvents), removeEventListener: remove(windowEvents),
    setTimeout: (fn) => { timeouts.set(++id, fn); return id; }, clearTimeout: (key) => timeouts.delete(key),
    setInterval: (fn) => { intervals.set(++id, fn); return id; }, clearInterval: (key) => intervals.delete(key) };
  useReadingActivity({ bookId: 'A', isReady: true }); cleanup = react.takeEffectCleanup();
  for (const fn of timeouts.values()) fn(); timeouts.clear();
  const emit = (map, name) => { for (const fn of map.get(name) ?? []) fn(); };
  return { beat: () => { for (const fn of intervals.values()) fn(); },
    hide: () => { document.visibilityState = 'hidden'; focused = false; emit(documentEvents, 'visibilitychange'); },
    show: () => { document.visibilityState = 'visible'; focused = true; emit(windowEvents, 'focus'); },
    pageHide: () => emit(windowEvents, 'pagehide'), pageShow: () => emit(windowEvents, 'pageshow') };
}
const receipt = (state = 'visible', sequence = 0, sessionId = 'activity-A') => ({ session_id: sessionId, state, sequence, accepted_at: 1 });
afterEach(async () => { cleanup?.(); cleanup = undefined; await tick(); ipc.resetReaderIpc(); delete global.document; delete global.window; });

test('a receipt must not erase a later queued pause and suppress the next resume', async () => {
  const first = gate(), pause = gate(); const observations = [];
  ipc.setReaderIpc({ beginReadingActivity: async () => receipt(), observeReadingActivity: (args) => {
    observations.push(args); if (observations.length === 1) return first.promise;
    if (observations.length === 2) return pause.promise;
    return Promise.resolve(receipt(args.activityState, args.sequence));
  } });
  const env = mount(); await tick(); env.beat(); await until(() => observations.length === 1);
  env.hide(); first.resolve(receipt('visible', 1)); await until(() => observations.length === 2);
  env.show(); pause.resolve(receipt('paused', 2)); await tick();
  assert.deepEqual(observations.map((item) => item.activityState), ['visible', 'paused', 'visible']);
  assert.deepEqual(observations.map((item) => item.sequence), [1, 2, 3]);
});

test('pagehide suppresses heartbeats even when the document still reports visible', async () => {
  const observations = [];
  ipc.setReaderIpc({ beginReadingActivity: async () => receipt(), observeReadingActivity: async (args) => {
    observations.push(args); return receipt(args.activityState, args.sequence);
  } });
  const env = mount(); await tick(); env.pageHide(); await tick(); env.beat(); await tick();
  assert.deepEqual(observations.map((item) => item.activityState), ['paused']);
  env.pageShow(); await tick(); assert.equal(observations.at(-1).activityState, 'visible');
});

for (const prefix of ['READING_ACTIVITY_NOT_FOUND:', 'READING_ACTIVITY_CONFLICT:']) {
  test(`${prefix} discards the invalid activity handle without replaying its interval`, async () => {
    let begins = 0; const observations = [];
    ipc.setReaderIpc({ beginReadingActivity: async () => receipt('visible', 0, `session-${++begins}`),
      observeReadingActivity: async (args) => {
        observations.push(args);
        if (args.sessionId === 'session-1') throw new Error(`${prefix} invalid handle`);
        return receipt(args.activityState, args.sequence, args.sessionId);
      } });
    const env = mount(); await tick(); env.beat(); await tick(); env.show(); await tick();
    assert.equal(begins, 2);
    assert.equal(observations.filter((item) => item.sessionId === 'session-1').length, 1);
  });
}

test('a queued heartbeat cannot report visible after the reader effect is disposed', async () => {
  const first = gate(); const observations = [];
  ipc.setReaderIpc({ beginReadingActivity: async () => receipt(), observeReadingActivity: (args) => {
    observations.push(args);
    return observations.length === 1 ? first.promise : Promise.resolve(receipt(args.activityState, args.sequence));
  } });
  const env = mount(); await tick(); env.beat(); await until(() => observations.length === 1);
  env.beat(); cleanup(); cleanup = undefined; first.resolve(receipt('visible', 1)); await tick();
  assert.deepEqual(observations.map((item) => item.activityState), ['visible', 'ended']);
});
