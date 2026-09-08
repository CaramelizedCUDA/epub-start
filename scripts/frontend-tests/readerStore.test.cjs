const assert = require('node:assert/strict');
const path = require('node:path');
const { test, afterEach } = require('node:test');

const buildRoot = process.env.FRONTEND_TEST_BUILD_DIR;
if (!buildRoot) {
  throw new Error('FRONTEND_TEST_BUILD_DIR is required; run through scripts/test-frontend.mjs');
}

function testSetTimeout(callback, delay) {
  const timer = setTimeout(callback, delay);
  timer.unref?.();
  return timer;
}

global.window = {
  setTimeout: testSetTimeout,
  clearTimeout,
  requestAnimationFrame: (callback) => {
    callback(0);
    return 0;
  },
};

const compiledRoot = path.join(buildRoot, 'compiled');
const { useReaderStore } = require(path.join(compiledRoot, 'stores', 'readerStore.js'));
const { resetReaderIpc, setReaderIpc } = require(path.join(compiledRoot, 'lib', 'tauri.js'));
const epubJs = require(path.join(buildRoot, 'node_modules', 'epubjs'));

class FakeRendition {
  constructor(label) {
    this.label = label;
    this.handlers = new Map();
    this.displayCalls = [];
    this.destroyCalls = 0;
  }

  on(event, handler) {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  off(event, handler) {
    const handlers = this.handlers.get(event) ?? [];
    this.handlers.set(event, handlers.filter((candidate) => candidate !== handler));
  }

  handler(event) {
    return this.handlers.get(event)?.[0] ?? null;
  }

  destroy() {
    this.destroyCalls += 1;
  }

  display(target) {
    this.displayCalls.push(target);
    return Promise.resolve();
  }
}

class FakeBook {
  constructor(id, openPromise = Promise.resolve()) {
    this.id = id;
    this.openPromise = openPromise;
    this.ready = Promise.resolve();
    this.destroyCalls = 0;
    this.renditions = [];
    this.navigation = {
      toc: [{ href: `${id}.xhtml`, label: `Chapter ${id}` }],
    };
  }

  open() {
    return this.openPromise;
  }

  renderTo() {
    const rendition = new FakeRendition(`${this.id}-${this.renditions.length + 1}`);
    this.renditions.push(rendition);
    return rendition;
  }

  destroy() {
    this.destroyCalls += 1;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function makeSettings(flow = 'paginated') {
  return {
    theme: 'light',
    font_family: 'publisher',
    font_size_px: 18,
    line_height_multiplier: 1.6,
    paragraph_spacing_multiplier: 1,
    text_indent_em: 2,
    margin_top_px: 24,
    margin_bottom_px: 24,
    margin_left_percent: 8,
    margin_right_percent: 8,
    max_column_width_px: 720,
    flow,
    spread: 'auto',
    updated_at: 1,
  };
}

function makeProgress(bookId, cfi) {
  return {
    book_id: bookId,
    location_cfi: cfi,
    progression: 0.25,
    updated_at: 1,
  };
}

function makeNote(bookId, id = `${bookId}-note`) {
  return {
    id,
    book_id: bookId,
    cfi_start: `epubcfi(${bookId}-start)`,
    cfi_end: `epubcfi(${bookId}-end)`,
    cfi_range: `epubcfi(${bookId}-range)`,
    selected_text: `Selected ${bookId}`,
    content: `Note ${bookId}`,
    color: '#f59e0b',
    created_at: 1,
    updated_at: 1,
  };
}

function relocatedLocation(cfi, page = 1, total = 10, href = 'chapter.xhtml') {
  return {
    start: {
      cfi,
      href,
      displayed: { page, total },
    },
  };
}

function configureBooks(...books) {
  let index = 0;
  epubJs.setFactory(() => {
    const book = books[index];
    index += 1;
    if (!book) throw new Error('reader test did not configure enough books');
    return book;
  });
}

afterEach(() => {
  useReaderStore.getState().close();
  resetReaderIpc();
});

test('a delayed progress response cannot restore an old book after switching books', async () => {
  const bookA = new FakeBook('A');
  const bookB = new FakeBook('B');
  configureBooks(bookA, bookB);
  const progressA = deferred();
  const progressRequests = [];
  setReaderIpc({
    getReadingProgress: ({ bookId }) => {
      progressRequests.push(bookId);
      return bookId === 'A' ? progressA.promise : Promise.resolve(null);
    },
  });

  const openA = useReaderStore.getState().open('A', 'epub://A/', makeSettings());
  await waitFor(() => progressRequests.length === 1, 'A progress request');

  const openB = useReaderStore.getState().open('B', 'epub://B/', makeSettings());
  await openB;
  assert.equal(useReaderStore.getState().bookId, 'B');

  progressA.resolve(makeProgress('A', 'A-cfi'));
  await openA;

  assert.equal(bookA.renditions[0].displayCalls.includes('A-cfi'), false);
  assert.equal(useReaderStore.getState().bookId, 'B');
  assert.notEqual(useReaderStore.getState().currentCfi, 'A-cfi');
});

test('a stale relocated callback cannot update the current book or schedule its save', async () => {
  const bookA = new FakeBook('A');
  const bookB = new FakeBook('B');
  configureBooks(bookA, bookB);
  const saves = [];
  setReaderIpc({
    saveReadingProgress: async (args) => {
      saves.push(args);
      return makeProgress(args.bookId, args.locationCfi);
    },
  });

  await useReaderStore.getState().open('A', 'epub://A/', makeSettings());
  const staleHandler = bookA.renditions[0].handler('relocated');
  await useReaderStore.getState().open('B', 'epub://B/', makeSettings());

  staleHandler(relocatedLocation('A-cfi', 4, 10, 'A.xhtml'));
  assert.equal(useReaderStore.getState().currentCfi, null);
  assert.equal(useReaderStore.getState().currentPage, 0);

  useReaderStore.getState().close();
  assert.deepEqual(saves, []);
});

test('opening a new book flushes the old progress and clears transient reader state', async () => {
  const bookA = new FakeBook('A');
  const openB = deferred();
  const bookB = new FakeBook('B', openB.promise);
  configureBooks(bookA, bookB);
  const saves = [];
  setReaderIpc({
    saveReadingProgress: async (args) => {
      saves.push(args);
      return makeProgress(args.bookId, args.locationCfi);
    },
  });

  await useReaderStore.getState().open('A', 'epub://A/', makeSettings());
  bookA.renditions[0].handler('relocated')(relocatedLocation('A-cfi', 3, 12, 'A.xhtml'));
  useReaderStore.setState({
    searchResults: [{ href: 'A.xhtml', excerpt: 'old result' }],
    notes: [makeNote('A')],
  });

  const openingB = useReaderStore.getState().open('B', 'epub://B/', makeSettings());
  await waitFor(() => useReaderStore.getState().bookId === 'B' && useReaderStore.getState().isLoading, 'B loading state');

  assert.deepEqual(saves, [{ bookId: 'A', locationCfi: 'A-cfi', progression: 0.25 }]);
  assert.equal(useReaderStore.getState().currentCfi, null);
  assert.equal(useReaderStore.getState().currentPage, 0);
  assert.equal(useReaderStore.getState().totalPages, 0);
  assert.deepEqual(useReaderStore.getState().toc, []);
  assert.deepEqual(useReaderStore.getState().searchResults, []);
  assert.deepEqual(useReaderStore.getState().notes, []);

  openB.resolve();
  await openingB;
});

test('a settings operation started for an old book cannot replace the new book rendition', async () => {
  const bookA = new FakeBook('A');
  const bookB = new FakeBook('B');
  configureBooks(bookA, bookB);
  const saveGate = deferred();
  const saves = [];
  setReaderIpc({
    saveReadingProgress: (args) => {
      saves.push(args);
      return saveGate.promise;
    },
  });

  const settingsA = makeSettings();
  const settingsB = makeSettings();
  await useReaderStore.getState().open('A', 'epub://A/', settingsA);
  useReaderStore.setState({ currentCfi: 'A-cfi', currentPage: 1, totalPages: 4 });

  const applyA = useReaderStore.getState().applyReadingSettings({ ...settingsA, flow: 'scrolled' });
  await waitFor(() => saves.length === 1, 'A settings progress save');

  await useReaderStore.getState().open('B', 'epub://B/', settingsB);
  const bRendition = bookB.renditions[0];
  saveGate.resolve(makeProgress('A', 'A-cfi'));
  await applyA;

  assert.equal(useReaderStore.getState().bookId, 'B');
  assert.equal(useReaderStore.getState().rendition, bRendition);
  assert.equal(bookA.renditions.length, 1);
});

test('a same-session rendition replacement completes an in-flight open', async () => {
  const bookA = new FakeBook('A');
  configureBooks(bookA);
  const progressA = deferred();
  const progressRequests = [];
  setReaderIpc({
    getReadingProgress: ({ bookId }) => {
      progressRequests.push(bookId);
      return progressA.promise;
    },
  });

  const openA = useReaderStore.getState().open('A', 'epub://A/', makeSettings());
  await waitFor(() => progressRequests.length === 1, 'A progress request');

  const applyA = useReaderStore.getState().applyReadingSettings({
    ...makeSettings(),
    flow: 'scrolled',
  });
  await applyA;

  progressA.resolve(null);
  await openA;

  assert.equal(useReaderStore.getState().rendition, bookA.renditions[1]);
  assert.equal(useReaderStore.getState().isLoading, false);
});

test('delayed notes for an old book cannot overwrite the current book notes', async () => {
  const bookA = new FakeBook('A');
  const bookB = new FakeBook('B');
  configureBooks(bookA, bookB);
  const notesA = deferred();
  const noteRequests = [];
  setReaderIpc({
    listNotes: ({ bookId }) => {
      noteRequests.push(bookId);
      return bookId === 'A' ? notesA.promise : Promise.resolve([]);
    },
  });

  await useReaderStore.getState().open('A', 'epub://A/', makeSettings());
  const loadA = useReaderStore.getState().loadNotes();
  await waitFor(() => noteRequests.length === 1, 'A notes request');

  await useReaderStore.getState().open('B', 'epub://B/', makeSettings());
  notesA.resolve([makeNote('A')]);
  await loadA;

  assert.equal(useReaderStore.getState().bookId, 'B');
  assert.deepEqual(useReaderStore.getState().notes, []);
});
