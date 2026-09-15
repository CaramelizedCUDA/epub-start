// Tests of actual store/adapter code with controlled IPC and EPUB.js boundaries.
// Opaque location tokens below are deliberately NOT real CFIs or recovery evidence.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, afterEach } = require('node:test');
const root = process.env.FRONTEND_TEST_BUILD_DIR;
if (!root) throw new Error('Run through scripts/test-frontend.mjs --reader');
global.window = {
  setTimeout: (callback, delay) => { const timer = setTimeout(callback, delay); timer.unref?.(); return timer; },
  clearTimeout,
  requestAnimationFrame: (callback) => { callback(0); return 0; },
};
const compiled = path.join(root, 'compiled');
const { useReaderStore: store } = require(path.join(compiled, 'stores/readerStore.js'));
const ipc = require(path.join(compiled, 'lib/tauri.js'));
const highlights = require(path.join(compiled, 'features/reader/engine/highlights.js'));
const reflow = require(path.join(compiled, 'features/reader/engine/reflow.js'));
const lifecycle = require(path.join(compiled, 'features/reader/engine/lifecycle.js'));
const epub = require(path.join(root, 'node_modules/epubjs'));
const originalFetch = global.fetch;
const originalDOMParser = global.DOMParser;
const originalRender = highlights.renderHighlight;
const originalRemove = highlights.removeHighlight;
const originalStabilizer = reflow.installContinuousScrollStabilizer;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function until(predicate) {
  // Disposal waits for a timer turn; a tight setImmediate loop can exhaust all
  // attempts before that timer is due on a fast event loop.
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Test did not reach the target step');
}
const settings = (flow = 'paginated') => ({ theme: 'light', font_family: 'publisher', font_size_px: 18,
  line_height_multiplier: 1.6, paragraph_spacing_multiplier: 1, text_indent_em: 2,
  margin_top_px: 24, margin_bottom_px: 24, margin_left_percent: 8, margin_right_percent: 8,
  max_column_width_px: 720, flow, spread: 'auto', updated_at: 1 });
const note = (id = 'A-note', book = 'A') => ({ id, book_id: book, cfi_start: 'opaque-start', cfi_end: 'opaque-end',
  cfi_range: 'opaque-range', selected_text: 'text', content: '', color: '#f59e0b', created_at: 1, updated_at: 1 });
class Rendition {
  constructor() { this.handlers = new Map(); this.displayCalls = []; this.destroyCalls = 0; }
  on(name, fn) { this.handlers.set(name, fn); }
  off(name, fn) { if (this.handlers.get(name) === fn) this.handlers.delete(name); }
  display(value) { this.displayCalls.push(value); return Promise.resolve(); }
  destroy() { this.destroyCalls += 1; }
  relocate(cfi) { this.handlers.get('relocated')?.({ start: { cfi, href: 'chapter.xhtml', displayed: { page: 2, total: 8 } } }); }
}
class Book {
  constructor(id = 'A', bodies = ['needle']) {
    this.id = id; this.ready = Promise.resolve(); this.destroyCalls = 0; this.renditions = []; this.reads = [];
    this.navigation = { toc: [] };
    this.read = async (index) => ({ textContent: bodies[index], body: { textContent: bodies[index] }, documentElement: { textContent: bodies[index] } });
    this.sections = bodies.map((_, index) => ({ href: `chapter-${index}.xhtml`, url: `epub://localhost/book/${id}/chapter-${index}.xhtml`,
      load: () => { this.reads.push(index); return this.read(index); } }));
    this.spine = { each: (callback) => this.sections.forEach(callback) };
  }
  load(url) { const index = this.sections.findIndex((section) => section.url === url); assert.ok(index >= 0, 'uses resolved section URL'); this.reads.push(index); return this.read(index); }
  open() { return Promise.resolve(); }
  renderTo() { this.rendition = new Rendition(); this.renditions.push(this.rendition); return this.rendition; }
  destroy() { this.destroyCalls += 1; this.rendition?.destroy(); this.rendition = undefined; }
}
function books(...items) { let index = 0; epub.setFactory(() => { assert.ok(items[index], 'configured book'); return items[index++]; }); }
const open = (id = 'A', flow) => store.getState().open(id, `epub://localhost/book/${id}/`, settings(flow));
afterEach(async () => {
  store.getState().close(); await tick(); ipc.resetReaderIpc();
  global.fetch = originalFetch; global.DOMParser = originalDOMParser;
  highlights.renderHighlight = originalRender; highlights.removeHighlight = originalRemove;
  reflow.installContinuousScrollStabilizer = originalStabilizer;
});

test('managed open waits for real EPUB.js detached navigation and display-options work', async () => {
  const RealBook = require('epubjs/lib/book').default;
  global.DOMParser = require('@xmldom/xmldom').DOMParser;
  const nav = gate(), displayOptions = gate(); const requested = [];
  const container = '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const opf = '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">lifecycle</dc:identifier><dc:title>Lifecycle</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch" href="ch.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch"/></spine></package>';
  global.fetch = async (url) => {
    requested.push(url);
    const body = url.endsWith('container.xml') ? container : url.endsWith('book.opf') ? opf
      : url.endsWith('nav.xhtml') ? await nav.promise : await displayOptions.promise;
    return { ok: true, headers: new Headers({ 'content-type': 'application/xml' }), text: async () => body };
  };
  epub.setFactory((options) => new RealBook(options));
  const book = lifecycle.createEpubBook('http://epub.localhost/book/A/'); let complete = false;
  const opening = book.open('http://epub.localhost/book/A/').then(() => { complete = true; });
  try {
    await until(() => requested.some((url) => url.endsWith('nav.xhtml')));
    await tick();
    assert.equal(complete, false, 'open must not expose a book with detached unpack callbacks still pending');
  } finally {
    nav.resolve('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="ch.xhtml">Chapter</a></li></ol></nav></body></html>');
    displayOptions.resolve('<display_options/>');
    await opening; await book.ready; await book.opened;
    lifecycle.destroyEpubBook(book);
  }
});

test('retiring a loading book aborts its request and keeps fields until late callbacks settle', async () => {
  const a = new Book(); const pending = gate(); const late = []; let signal;
  a.loading = { sentinel: true };
  const originalDestroy = a.destroy.bind(a);
  a.destroy = () => { a.loading = undefined; originalDestroy(); };
  global.fetch = (_url, options) => {
    signal = options?.signal;
    signal?.addEventListener('abort', () => pending.reject(new DOMException('Aborted', 'AbortError')), { once: true });
    return pending.promise;
  };
  epub.setFactory((options) => {
    a.open = () => options.requestMethod('chapter.xhtml', 'text').then(
      () => { late.push(a.loading?.sentinel); },
      (error) => { late.push(a.loading?.sentinel); throw error; },
    );
    return a;
  });
  const book = lifecycle.createEpubBook('epub://localhost/book/A/');
  const outcome = book.open('epub://localhost/book/A/').then(() => null, (error) => error);
  lifecycle.destroyEpubBook(book);
  try {
    assert.equal(signal?.aborted, true, 'close must cancel the outstanding resource request');
    assert.equal(a.destroyCalls, 0, 'Book.destroy must wait for the request continuation');
  } finally {
    pending.resolve({ ok: true, headers: new Headers(), text: async () => 'late chapter' });
    await outcome;
  }
  await until(() => a.destroyCalls === 1);
  assert.deepEqual(late, [true]);
  assert.ok(await outcome instanceof Error, 'cancelled open must reject');
  await assert.rejects(book.open('epub://localhost/book/A/'), /BOOK_RETIRED/);
});

test('managed navigation failure still reaches the current reader session', async () => {
  const a = new Book(); const nav = gate(); const ready = gate(); const failure = new Error('BOOK_RESOURCE_FAILED: nav.xhtml status=404');
  a.ready = ready.promise;
  a.loadNavigation = () => nav.promise;
  // The rejected branch only observes the old upstream defect for test cleanup.
  // EPUB.js 0.3.93 unpack itself has only the success continuation here.
  a.open = () => { a.loadNavigation().then(() => ready.resolve(), () => ready.resolve()); return Promise.resolve(); };
  books(a);
  const opening = open(); nav.reject(failure); await opening;
  assert.equal(store.getState().error, failure.message);
  assert.equal(a.renditions.length, 0);
});

test('closing before ready immediately cancels the locally opening book', async () => {
  const a = new Book(); const pending = gate(); let signal;
  global.fetch = (_url, options) => {
    signal = options?.signal;
    signal?.addEventListener('abort', () => pending.reject(new DOMException('Aborted', 'AbortError')), { once: true });
    return pending.promise;
  };
  epub.setFactory((options) => {
    a.open = () => options.requestMethod('container.xml', 'text');
    return a;
  });
  const opening = open(); await until(() => signal);
  store.getState().close();
  try {
    assert.equal(signal.aborted, true, 'close must retire the local book before it reaches store.book');
  } finally {
    pending.resolve({ ok: true, headers: new Headers(), text: async () => 'late container' });
    await opening;
  }
  await until(() => a.destroyCalls === 1);
  assert.equal(store.getState().error, null, 'user cancellation is not a new-session load error');
  assert.equal(a.renditions.length, 0);
});

test('retiring a rendition cancels queued startup and settles queued display callers', async () => {
  const Queue = require('epubjs/lib/utils/queue').default;
  const a = new Book(); const frames = []; let starts = 0;
  a.renderTo = () => {
    const r = new Rendition(); r.q = new Queue(r); r.q.tick = (callback) => frames.push(callback);
    r.q.enqueue(() => { starts += 1; });
    r.display = () => r.q.enqueue(() => 'displayed');
    a.rendition = r; return r;
  };
  books(a); const book = lifecycle.createEpubBook('epub://localhost/book/A/');
  const rendition = lifecycle.createRendition(book, settings());
  let settled = false;
  const displaying = rendition.display().then(() => { settled = true; return null; }, (error) => { settled = true; return error; });
  lifecycle.destroyRendition(rendition);
  try {
    await tick();
    assert.equal(settled, true, 'close must not strand the display await after stopping its queue');
    assert.match((await displaying)?.message ?? '', /BOOK_RETIRED/);
    for (let index = 0; frames.length && index < 10; index += 1) { frames.shift()(); await tick(); }
    assert.equal(starts, 0, 'a queued Rendition.start must not run after destruction');
    await assert.rejects(rendition.display(), /BOOK_RETIRED/);
  } finally {
    rendition.q.stop(); lifecycle.destroyEpubBook(book);
  }
});

test('retiring fire-and-forget displays does not emit an unhandled rejection', async () => {
  const a = new Book(); const pending = gate();
  a.renderTo = () => {
    const r = new Rendition(); r.display = () => pending.promise;
    a.rendition = r; return r;
  };
  books(a);
  const book = lifecycle.createEpubBook('epub://localhost/book/A/');
  const rendition = lifecycle.createRendition(book, settings());
  // EPUB.js handleLinks/onResized deliberately ignore the display result.
  // Node's test runner fails this test if the discarded promise rejects
  // without an observer; do not attach a test-side rejection handler here.
  void rendition.display('chapter-1.xhtml');
  lifecycle.destroyRendition(rendition);
  try {
    await tick();
    await tick();
  } finally {
    pending.resolve();
    lifecycle.destroyEpubBook(book);
  }
});

test('retiring between real manager startup and attachment does not tear down absent DOM', () => {
  const Manager = require('epubjs/lib/managers/default').default;
  const RealRendition = require('epubjs/lib/rendition').default;
  const manager = new Manager({ settings: {} });
  const rendition = { manager, book: {}, destroy: RealRendition.prototype.destroy };
  assert.equal(manager.rendered, false);
  assert.equal(manager.stage, undefined);
  assert.doesNotThrow(() => lifecycle.destroyRendition(rendition));
  assert.equal(rendition.book, undefined);
});

test('close and stale open continuation destroy an owned rendition only once', async () => {
  const a = new Book(); const b = new Book('B'); books(a, b); const read = gate();
  ipc.setReaderIpc({ getReadingProgress: ({ bookId }) => bookId === 'A' ? read.promise : Promise.resolve(null) });
  const opening = open(); await until(() => a.renditions.length === 1);
  await open('B'); read.resolve(null); await opening;
  assert.equal(a.renditions[0].destroyCalls, 1);
  assert.equal(a.destroyCalls, 1);
});

test('initial continuous mode installs and removes its scroll stabilizer', async () => {
  let installs = 0, removals = 0;
  reflow.installContinuousScrollStabilizer = () => { installs += 1; return () => { removals += 1; }; };
  books(new Book()); await open('A', 'scrolled');
  assert.equal(installs, 1); store.getState().close(); assert.equal(removals, 1);
});

test('a failed progress read cannot silently display and overwrite the start page', async () => {
  const a = new Book(); books(a);
  ipc.setReaderIpc({ getReadingProgress: async () => { throw new Error('INTERNAL_ERROR: read failed'); } });
  await open();
  assert.equal(a.renditions[0].displayCalls.length, 0);
  assert.match(store.getState().error, /read failed/);
});

test('reopening the same book waits for its outstanding exit save', async () => {
  const a = new Book(); const second = new Book(); books(a, second); const saved = gate(); let reads = 0;
  ipc.setReaderIpc({ getReadingProgress: async () => { reads += 1; return null; }, saveReadingProgress: () => saved.promise });
  await open(); a.rendition.relocate('opaque-exit-position'); store.getState().close();
  const reopening = open(); await tick();
  try { assert.equal(reads, 1); } finally { saved.resolve({}); await reopening; }
  assert.equal(reads, 2);
});

test('exit writes cannot overtake an earlier settings progress write for the same book', async () => {
  const a = new Book(); books(a); const first = gate(); const calls = [];
  ipc.setReaderIpc({ saveReadingProgress: (args) => { calls.push(args); return calls.length === 1 ? first.promise : Promise.resolve({}); } });
  await open(); store.setState({ currentCfi: 'opaque-first', currentPage: 1, totalPages: 4 });
  const apply = store.getState().applyReadingSettings(settings()); await until(() => calls.length === 1);
  a.rendition.relocate('opaque-last'); store.getState().close(); await tick();
  try { assert.equal(calls.length, 1); } finally { first.resolve({}); await apply; await tick(); }
  assert.equal(calls.length, 2); assert.equal(calls[1].locationCfi, 'opaque-last');
});

test('an old-book search response cannot populate the newly opened book', async () => {
  const a = new Book(); const b = new Book('B'); books(a, b); const read = gate(); a.read = () => read.promise;
  await open(); const searching = store.getState().searchCurrentBook('needle'); await until(() => a.reads.length === 1);
  await open('B'); read.resolve({ textContent: 'needle', body: { textContent: 'needle' } }); await searching;
  assert.deepEqual(store.getState().searchResults, []);
});

test('a newer query wins when an older query completes later', async () => {
  const a = new Book(); books(a); const old = gate(); const fresh = gate(); let count = 0;
  a.read = () => (++count === 1 ? old.promise : fresh.promise);
  await open(); const first = store.getState().searchCurrentBook('older'); await until(() => count === 1);
  const second = store.getState().searchCurrentBook('newer'); await until(() => count === 2);
  fresh.resolve({ textContent: 'newer', body: { textContent: 'newer' } }); await second;
  old.resolve({ textContent: 'older', body: { textContent: 'older' } }); await first;
  assert.equal(store.getState().searchResults[0].excerpt, 'newer');
});

test('clearing a query invalidates its still-running search', async () => {
  const a = new Book(); books(a); const read = gate(); a.read = () => read.promise;
  await open(); const search = store.getState().searchCurrentBook('needle'); await until(() => a.reads.length === 1);
  await store.getState().searchCurrentBook(''); read.resolve({ textContent: 'needle', body: { textContent: 'needle' } }); await search;
  assert.deepEqual(store.getState().searchResults, []);
});

test('chapter search stops after fifty hits instead of loading the entire spine in parallel', async () => {
  const a = new Book('A', Array(100).fill('needle')); books(a); await open();
  await store.getState().searchCurrentBook('needle');
  assert.equal(a.reads.length, 50); assert.equal(store.getState().searchResults.length, 50);
  assert.equal(store.getState().searchLimited, true);
});

test('a failed chapter remains visible as partial-search feedback', async () => {
  const a = new Book('A', ['needle', 'needle']); books(a); const normal = a.read;
  a.read = (index) => index === 0 ? Promise.reject(new Error('unreadable')) : normal(index);
  await open(); await store.getState().searchCurrentBook('needle');
  assert.equal(store.getState().searchResults.length, 1);
  assert.match(store.getState().searchError, /1 个章节读取失败/);
  assert.equal(store.getState().isSearching, false);
});

for (const operation of ['addNote', 'editNote']) {
  test(`late ${operation} response cannot insert a marker into another book`, async () => {
    books(new Book(), new Book('B')); const write = gate(); let marks = 0;
    highlights.renderHighlight = () => { marks += 1; };
    ipc.setReaderIpc({ [operation === 'addNote' ? 'createNote' : 'updateNote']: () => write.promise });
    await open(); store.setState({ notes: [note()] }); const operationPromise = store.getState()[operation](note());
    await open('B'); write.resolve(note()); await operationPromise;
    assert.equal(marks, 0); assert.deepEqual(store.getState().notes, []);
  });
}

test('late deletion cannot remove a marker from another book rendition', async () => {
  books(new Book(), new Book('B')); const deletion = gate(); let removals = 0;
  highlights.removeHighlight = () => { removals += 1; };
  ipc.setReaderIpc({ deleteNote: () => deletion.promise });
  await open(); store.setState({ notes: [note()] }); const deleting = store.getState().removeNote('A-note');
  await open('B'); deletion.resolve(); await deleting;
  assert.equal(removals, 0);
});

test('an in-flight notes list cannot erase a newly created note in the same book', async () => {
  books(new Book()); const reading = gate();
  ipc.setReaderIpc({ listNotes: () => reading.promise, createNote: async () => note() });
  await open(); const listing = store.getState().loadNotes(); await store.getState().addNote(note());
  reading.resolve([]); await listing;
  assert.deepEqual(store.getState().notes.map((entry) => entry.id), ['A-note']);
});

test('the newest notes list wins within the same reader session', async () => {
  books(new Book()); const old = gate(); let count = 0;
  ipc.setReaderIpc({ listNotes: () => (++count === 1 ? old.promise : Promise.resolve([note('fresh')])) });
  await open(); const first = store.getState().loadNotes(); await store.getState().loadNotes();
  old.resolve([note('old')]); await first;
  assert.equal(store.getState().notes[0].id, 'fresh');
});

test('editing a highlight range removes the old range before rendering the replacement', async () => {
  books(new Book()); const events = [];
  highlights.removeHighlight = (_rendition, range) => events.push(['remove', range]);
  highlights.renderHighlight = (_rendition, item) => events.push(['render', item.cfi_range]);
  ipc.setReaderIpc({ updateNote: async () => ({ ...note(), cfi_range: 'opaque-new-range' }) });
  await open(); store.setState({ notes: [note()] }); await store.getState().editNote(note());
  assert.deepEqual(events, [['remove', 'opaque-range'], ['render', 'opaque-new-range']]);
});


test('flow replacement stays loading until its first display completes', async () => {
  const a = new Book(); books(a); await open();
  const ready = gate(); const renderTo = a.renderTo.bind(a);
  a.renderTo = () => { const r = renderTo(); r.display = () => ready.promise; return r; };
  const changing = store.getState().applyReadingSettings(settings('scrolled'));
  await until(() => a.renditions.length === 2);
  try {
    assert.equal(store.getState().isLoading, true, 'ready-only interactions cannot mount before manager startup');
  } finally { ready.resolve(); await changing; }
  assert.equal(store.getState().isLoading, false);
});

test('failed flow replacement exposes a recoverable error and clears loading', async () => {
  const a = new Book(); books(a); await open(); const renderTo = a.renderTo.bind(a);
  a.renderTo = () => { const r = renderTo(); r.display = async () => { throw new Error('display failed'); }; return r; };
  await assert.rejects(store.getState().applyReadingSettings(settings('scrolled')), /display failed/);
  assert.equal(store.getState().isLoading, false);
  assert.match(store.getState().error, /display failed/);
});

test('notes loaded during a flow change attach to the replacement rendition of the same book', async () => {
  const a = new Book(); books(a); const read = gate(); const marks = [];
  highlights.renderHighlight = (rendition, item) => marks.push({ rendition, id: item.id });
  ipc.setReaderIpc({ listNotes: () => read.promise });
  await open(); const listing = store.getState().loadNotes();
  await store.getState().applyReadingSettings(settings('scrolled'));
  read.resolve([note()]); await listing;
  assert.equal(store.getState().notes.length, 1);
  assert.equal(marks.length, 1); assert.equal(marks[0].rendition, a.renditions[1]);
});


test('a marker callback retained after settings reflow cannot open a note menu in another book', async () => {
  books(new Book(), new Book('B')); let callback;
  highlights.renderHighlight = (_rendition, _note, _theme, onClick) => { callback = onClick; };
  await open(); store.setState({ notes: [note()] });
  await store.getState().applyReadingSettings(settings());
  await open('B'); callback({ noteId: 'A-note', rect: {} });
  assert.equal(store.getState().clickedNote, null);
});

test('an explicit series hit opens its chapter rather than the older saved location', async () => {
  const a = new Book(); books(a);
  ipc.setReaderIpc({ getReadingProgress: async () => ({ book_id: 'A', location_cfi: 'opaque-saved', progression: 0.5, updated_at: 1 }) });
  await store.getState().open('A', 'epub://localhost/book/A/', settings(), 'Text/hit.xhtml');
  assert.equal(a.rendition.displayCalls[0], 'Text/hit.xhtml');
  assert.equal(store.getState().currentCfi, null, 'a chapter href is not manufactured into a CFI');
});
