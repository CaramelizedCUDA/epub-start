const assert = require('node:assert/strict');
const path = require('node:path');
const { test, afterEach } = require('node:test');
const root = process.env.FRONTEND_TEST_BUILD_DIR;
if (!root) throw new Error('Run through scripts/test-frontend.mjs --reader');
const { searchSeriesChapters, waitForSeriesIndex } = require(path.join(root, 'compiled/features/library/seriesSearch.js'));
const { setReaderIpc, resetReaderIpc } = require(path.join(root, 'compiled/lib/tauri.js'));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const gate = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const status = (state = 'ready', detail = null) => ({ series_id: 'series-A', status: state, indexed_documents: 1, total_documents: 2, error_detail: detail, updated_at: 1 });
const task = { task_id: 'owned-A', ...status() };
const oldWindow = global.window;
afterEach(() => { resetReaderIpc(); global.window = oldWindow; });
function configure(extra = {}) {
  setReaderIpc({ listSeriesBooks: async () => [{ book_id: 'A', series_id: 'series-A', volume_label: '', sort_order: 0 }],
    ensureSeriesSearchIndex: async () => task, getSearchIndexStatus: async () => status(),
    searchSeries: async () => [], cancelSearchIndex: async () => undefined, ...extra });
}
const callbacks = (isCurrent = () => true) => ({ isCurrent, onTask: () => {}, onStatus: () => {} });

test('a series query resolved after retirement cannot return old results', async () => {
  const response = gate(); let active = true, queried = false;
  configure({ searchSeries: () => { queried = true; return response.promise; } });
  const run = searchSeriesChapters('series-A', 'word', callbacks(() => active));
  await tick(); assert.equal(queried, true); active = false;
  response.resolve([{ book_id: 'A', href: 'chapter.xhtml', cfi: null }]);
  assert.equal(await run, null);
});

test('a stale membership response cannot start an unwanted index', async () => {
  const membership = gate(); let active = true, starts = 0;
  configure({ listSeriesBooks: () => membership.promise, ensureSeriesSearchIndex: async () => { starts += 1; return task; } });
  const run = searchSeriesChapters('series-A', 'word', callbacks(() => active));
  active = false; membership.resolve([{ book_id: 'A' }]);
  assert.equal(await run, null); assert.equal(starts, 0);
});

test('a task created after retirement is cancelled by its actual task ID', async () => {
  const started = gate(); let active = true; const cancelled = [];
  configure({ ensureSeriesSearchIndex: () => started.promise, cancelSearchIndex: async ({ taskId }) => { cancelled.push(taskId); } });
  const run = searchSeriesChapters('series-A', 'word', callbacks(() => active));
  await tick(); active = false; started.resolve(task);
  assert.equal(await run, null); assert.deepEqual(cancelled, ['owned-A']);
});

test('retiring a poll during its delay prevents the next IPC request', async () => {
  let active = true, polls = 0;
  configure({ getSearchIndexStatus: async () => { polls += 1; return polls === 1 ? status('building') : status(); } });
  global.window = { setTimeout: (resolve) => { active = false; resolve(); return 0; } };
  assert.equal(await waitForSeriesIndex('series-A', task, () => {}, () => active), null);
  assert.equal(polls, 1);
});

test('an old in-flight status cannot update the new series panel', async () => {
  const response = gate(); let active = true; const updates = [];
  configure({ getSearchIndexStatus: () => response.promise });
  const run = waitForSeriesIndex('series-A', task, (value) => updates.push(value), () => active);
  active = false; response.resolve(status());
  assert.equal(await run, null); assert.deepEqual(updates, []);
});

test('partial ready status and null CFI are preserved without inventing positions', async () => {
  const partial = status('ready', 'A chapter exceeded the existing budget');
  const hit = { book_id: 'A', spine_index: 2, href: 'Text/3.xhtml', title: 'Chapter 3', snippet: 'word', cfi: null };
  const updates = [];
  configure({ getSearchIndexStatus: async () => partial, searchSeries: async () => [hit] });
  const result = await searchSeriesChapters('series-A', 'word', { ...callbacks(), onStatus: (value) => updates.push(value) });
  assert.deepEqual(result, [hit]); assert.equal(updates[0].error_detail, partial.error_detail);
});

test('an interrupted index stops polling and keeps its actionable error', async () => {
  let polls = 0;
  global.window = { setTimeout: (resolve) => { resolve(); return 0; } };
  configure({ getSearchIndexStatus: async () => { polls += 1; return polls === 1 ? status('pending', 'SEARCH_INDEX_INTERRUPTED: retry indexing') : status(); } });
  await assert.rejects(waitForSeriesIndex('series-A', task, () => {}, () => true), /SEARCH_INDEX_INTERRUPTED:/);
  assert.equal(polls, 1);
});
