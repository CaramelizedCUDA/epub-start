const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const buildRoot = process.env.FRONTEND_TEST_BUILD_DIR;
if (!buildRoot) {
  throw new Error('FRONTEND_TEST_BUILD_DIR is required; run through scripts/test-frontend.mjs');
}

const compiledRoot = path.join(buildRoot, 'compiled');
const { useLibraryStore } = require(path.join(compiledRoot, 'stores', 'libraryStore.js'));
const { resetLibraryIpc, setLibraryIpc } = require(path.join(compiledRoot, 'lib', 'tauri.js'));

function makeBook(id) {
  return {
    id,
    title: `Book ${id}`,
    authors: [],
    format: 'epub',
    cover_cache_path: null,
    file_size_bytes: 1,
    last_modified_ts: 1,
    package_identifier: null,
    status: 'available',
    status_detail: null,
    added_at: 1,
    updated_at: 1,
  };
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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function resetFixture() {
  resetLibraryIpc();
  useLibraryStore.setState({ books: [], isLoading: false, error: null });
}

test('newer list request wins when an older response arrives later', async () => {
  resetFixture();
  const requests = [];
  setLibraryIpc({
    listBooks: () => {
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
  });

  const olderLoad = useLibraryStore.getState().loadBooks();
  const newerLoad = useLibraryStore.getState().loadBooks();
  assert.equal(requests.length, 2);
  assert.equal(useLibraryStore.getState().isLoading, true);

  requests[1].resolve([makeBook('new')]);
  await newerLoad;
  assert.deepEqual(useLibraryStore.getState().books.map((book) => book.id), ['new']);

  requests[0].resolve([makeBook('old')]);
  await olderLoad;
  assert.deepEqual(useLibraryStore.getState().books.map((book) => book.id), ['new']);
});

test('loading count remains active until all concurrent requests settle', async () => {
  resetFixture();
  const requests = [];
  setLibraryIpc({
    listBooks: () => {
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
  });

  const firstLoad = useLibraryStore.getState().loadBooks();
  const secondLoad = useLibraryStore.getState().loadBooks();
  assert.equal(useLibraryStore.getState().isLoading, true);

  requests[0].resolve([]);
  await firstLoad;
  assert.equal(useLibraryStore.getState().isLoading, true);

  requests[1].resolve([]);
  await secondLoad;
  assert.equal(useLibraryStore.getState().isLoading, false);
});

test('delete refresh cannot reintroduce a book from a stale in-flight list', async () => {
  resetFixture();
  const deleted = makeBook('deleted');
  const survivor = makeBook('survivor');
  useLibraryStore.setState({ books: [deleted, survivor] });

  const requests = [];
  setLibraryIpc({
    listBooks: () => {
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
    deleteBook: async ({ bookId }) => {
      assert.equal(bookId, 'deleted');
      return 'deleted';
    },
  });

  const staleLoad = useLibraryStore.getState().loadBooks();
  await waitFor(() => requests.length === 1, 'the stale list request');

  const remove = useLibraryStore.getState().removeBook('deleted');
  await waitFor(() => requests.length === 2, 'the post-delete refresh');
  assert.deepEqual(useLibraryStore.getState().books.map((book) => book.id), ['survivor']);

  requests[1].resolve([survivor]);
  await remove;
  assert.equal(useLibraryStore.getState().isLoading, true);

  requests[0].resolve([deleted, survivor]);
  await staleLoad;
  assert.deepEqual(useLibraryStore.getState().books.map((book) => book.id), ['survivor']);
  assert.equal(useLibraryStore.getState().isLoading, false);
});

test('loading failure clears its slot and the next load recovers the shelf', async () => {
  resetFixture();
  let attempt = 0;
  const recovered = makeBook('recovered');
  setLibraryIpc({
    listBooks: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('temporary list failure');
      return [recovered];
    },
  });

  await useLibraryStore.getState().loadBooks();
  assert.equal(useLibraryStore.getState().isLoading, false);
  assert.equal(useLibraryStore.getState().error, 'temporary list failure');

  useLibraryStore.getState().clearError();
  assert.equal(useLibraryStore.getState().error, null);
  await useLibraryStore.getState().loadBooks();
  assert.deepEqual(useLibraryStore.getState().books.map((book) => book.id), ['recovered']);
  assert.equal(useLibraryStore.getState().error, null);
  assert.equal(useLibraryStore.getState().isLoading, false);
});
