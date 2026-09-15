import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceStorePath = path.join(repoRoot, 'src', 'stores', 'libraryStore.ts');
const sourceReaderStorePath = path.join(repoRoot, 'src', 'stores', 'readerStore.ts');
const sourceModelsPath = path.join(repoRoot, 'src', 'types', 'models.ts');
const targetBase = path.resolve(repoRoot, 'target');
const targetRoot = path.join(repoRoot, 'target', 'frontend-tests');
const redGreenRoot = path.join(repoRoot, 'target', 'frontend-tests-redgreen');
const allowedTempRoots = new Set([path.resolve(targetRoot), path.resolve(redGreenRoot)]);
const libraryTests = new Map([['library', ['libraryStore.test.cjs']]]);
const readerTests = new Map([['reader', [
  'readerStore.test.cjs',
  'reader-closeout.test.cjs',
  'readingActivity-closeout.test.cjs',
  'reader-helpers.test.cjs', 'seriesSearch-closeout.test.cjs',
  'pageTurn.test.cjs',
  'reflow-anchor.test.cjs',
]]]);
const testSuites = new Map([...libraryTests, ...readerTests]);

const staleListGuardPattern = /if \(requestId === latestListRequestId\) \{\r?\n\s+set\(\{ books \}\);\r?\n\s+\}/g;
const redGreenSpecs = [
  {
    label: 'old-list overwrite',
    testName: 'newer list request wins when an older response arrives later',
    pattern: staleListGuardPattern,
    mutate: (match) => match.replace('requestId === latestListRequestId', 'true'),
    assertionText: 'ERR_ASSERTION',
  },
  {
    label: 'delete/list competition',
    testName: 'delete refresh cannot reintroduce a book from a stale in-flight list',
    pattern: staleListGuardPattern,
    mutate: (match) => match.replace('requestId === latestListRequestId', 'true'),
    assertionText: 'ERR_ASSERTION',
  },
  {
    label: 'loading count',
    testName: 'loading count remains active until all concurrent requests settle',
    pattern: /set\(\{ isLoading: activeOperations > 0 \}\);/g,
    mutate: () => 'set({ isLoading: false });',
    assertionText: 'ERR_ASSERTION',
  },
  {
    label: 'failure recovery',
    testName: 'loading failure clears its slot and the next load recovers the shelf',
    pattern: /set\(\{ error: userFacingError\(error\) \}\);/g,
    mutate: () => "set({ error: 'injected failure' });",
    assertionText: 'ERR_ASSERTION',
  },
];

const mockTauriSource = `
import type { BookSummary } from '../types/models';

type LibraryIpc = {
  selectEpubSources: () => Promise<unknown[]>;
  importBook: (args: { source: unknown }) => Promise<unknown>;
  listBooks: () => Promise<BookSummary[]>;
  relocateBook: (args: { bookId: string; source: unknown }) => Promise<unknown>;
  deleteBook: (args: { bookId: string }) => Promise<string>;
};

const defaults: LibraryIpc = {
  selectEpubSources: async () => [],
  importBook: async () => ({}),
  listBooks: async () => [],
  relocateBook: async () => ({}),
  deleteBook: async () => '',
};

let handlers: LibraryIpc = { ...defaults };

export function setLibraryIpc(overrides: Partial<LibraryIpc>): void {
  handlers = { ...handlers, ...overrides };
}

export function resetLibraryIpc(): void {
  handlers = { ...defaults };
}

export function selectEpubSources(): Promise<unknown[]> {
  return handlers.selectEpubSources();
}

export function importBook(args: { source: unknown }): Promise<unknown> {
  return handlers.importBook(args);
}

export function listBooks(): Promise<BookSummary[]> {
  return handlers.listBooks();
}

export function relocateBook(args: { bookId: string; source: unknown }): Promise<unknown> {
  return handlers.relocateBook(args);
}

export function deleteBook(args: { bookId: string }): Promise<string> {
  return handlers.deleteBook(args);
}
`;

const mockReaderTauriSource = `
import type {
  CreateNoteInput,
  Note,
  BookSeries,
  SearchTaskStatus,
  SearchIndexStatus,
  SearchResult,
  ReadingProgress,
  ReadingActivityReceipt,
  ReadingActivityState,
  UpdateNoteInput,
} from '../types/models';

type ProgressArgs = { bookId: string };
type SaveProgressArgs = { bookId: string; locationCfi: string; progression: number };
type BeginActivityArgs = { bookId: string; utcOffsetMinutes: number };
type ObserveActivityArgs = {
  sessionId: string; sequence: number; activityState: ReadingActivityState; utcOffsetMinutes: number;
};
type ReaderIpc = {
  listSeriesBooks: (args: { seriesId: string }) => Promise<BookSeries[]>;
  ensureSeriesSearchIndex: (args: { seriesId: string }) => Promise<SearchTaskStatus>;
  getSearchIndexStatus: (args: { seriesId: string }) => Promise<SearchIndexStatus>;
  searchSeries: (args: { seriesId: string; query: string; limit?: number }) => Promise<SearchResult[]>;
  cancelSearchIndex: (args: { taskId: string }) => Promise<void>;
  getReadingProgress: (args: ProgressArgs) => Promise<ReadingProgress | null>;
  saveReadingProgress: (args: SaveProgressArgs) => Promise<ReadingProgress>;
  listNotes: (args: ProgressArgs) => Promise<Note[]>;
  createNote: (args: { note: CreateNoteInput }) => Promise<Note>;
  updateNote: (args: { note: UpdateNoteInput }) => Promise<Note>;
  deleteNote: (noteId: string) => Promise<void>;
  beginReadingActivity: (args: BeginActivityArgs) => Promise<ReadingActivityReceipt>;
  observeReadingActivity: (args: ObserveActivityArgs) => Promise<ReadingActivityReceipt>;
};

const defaults: ReaderIpc = {
  listSeriesBooks: async () => [],
  ensureSeriesSearchIndex: async () => ({} as SearchTaskStatus),
  getSearchIndexStatus: async () => ({} as SearchIndexStatus),
  searchSeries: async () => [],
  cancelSearchIndex: async () => undefined,
  getReadingProgress: async () => null,
  saveReadingProgress: async ({ bookId, locationCfi, progression }) => ({
    book_id: bookId,
    location_cfi: locationCfi,
    progression,
    updated_at: 0,
  }),
  listNotes: async () => [],
  createNote: async () => ({} as Note),
  updateNote: async () => ({} as Note),
  deleteNote: async () => undefined,
  beginReadingActivity: async () => ({
    session_id: 'activity-A', sequence: 0, state: 'visible', accepted_at: 0,
  }),
  observeReadingActivity: async ({ sessionId, sequence, activityState }) => ({
    session_id: sessionId, sequence, state: activityState, accepted_at: 0,
  }),
};

let handlers: ReaderIpc = { ...defaults };

export function setReaderIpc(overrides: Partial<ReaderIpc>): void {
  handlers = { ...handlers, ...overrides };
}

export function listSeriesBooks(args: { seriesId: string }): Promise<BookSeries[]> { return handlers.listSeriesBooks(args); }
export function ensureSeriesSearchIndex(args: { seriesId: string }): Promise<SearchTaskStatus> { return handlers.ensureSeriesSearchIndex(args); }
export function getSearchIndexStatus(args: { seriesId: string }): Promise<SearchIndexStatus> { return handlers.getSearchIndexStatus(args); }
export function searchSeries(args: { seriesId: string; query: string; limit?: number }): Promise<SearchResult[]> { return handlers.searchSeries(args); }
export function cancelSearchIndex(args: { taskId: string }): Promise<void> { return handlers.cancelSearchIndex(args); }

export function resetReaderIpc(): void {
  handlers = { ...defaults };
}

export function getReadingProgress(args: ProgressArgs): Promise<ReadingProgress | null> {
  return handlers.getReadingProgress(args);
}

export function saveReadingProgress(args: SaveProgressArgs): Promise<ReadingProgress> {
  return handlers.saveReadingProgress(args);
}

export function listNotes(args: ProgressArgs): Promise<Note[]> {
  return handlers.listNotes(args);
}

export function createNote(args: { note: CreateNoteInput }): Promise<Note> {
  return handlers.createNote(args);
}

export function updateNote(args: { note: UpdateNoteInput }): Promise<Note> {
  return handlers.updateNote(args);
}

export function deleteNote(noteId: string): Promise<void> {
  return handlers.deleteNote(noteId);
}

export function beginReadingActivity(args: BeginActivityArgs): Promise<ReadingActivityReceipt> {
  return handlers.beginReadingActivity(args);
}

export function observeReadingActivity(args: ObserveActivityArgs): Promise<ReadingActivityReceipt> {
  return handlers.observeReadingActivity(args);
}
`;

const mockReaderEngineSource = `
export function captureFirstVisibleLine(..._args: any[]): any { return null; }
export async function captureReflowAnchor(..._args: any[]): Promise<any> { return null; }
export async function rememberReflowAnchor(..._args: any[]): Promise<void> {}
export function clearFirstLineOffset(..._args: any[]): void {}
export function exitWindowFullscreen(..._args: any[]): Promise<boolean> { return Promise.resolve(false); }
export function injectReadingTheme(..._args: any[]): void {}
export function installContinuousScrollStabilizer(..._args: any[]): () => void { return () => {}; }
export function preserveAndReflow(..._args: any[]): Promise<void> { return Promise.resolve(); }
export function readerViewportGeometry(..._args: any[]): any { return null; }
export function resizeToViewport(..._args: any[]): void {}
export function restoreFirstVisibleLine(..._args: any[]): void {}
export function settleInitialPagination(..._args: any[]): Promise<void> { return Promise.resolve(); }
export function waitForRenditionReady(..._args: any[]): Promise<void> { return Promise.resolve(); }
export function toggleWindowFullscreen(..._args: any[]): Promise<boolean> { return Promise.resolve(false); }
`;

const mockReaderHighlightsSource = `
export type SelectionInfo = any;
export type HighlightMarkClick = any;
export function renderHighlight(
  _rendition: any,
  _note: any,
  _theme: any,
  _onMarkClick: (click: HighlightMarkClick) => void,
): void {}
export function removeHighlight(_rendition: any, _cfiRange: string): void {}
export function installHighlightEngine(..._args: any[]): () => void { return () => {}; }
export function clearActiveSelection(): void {}
export const HIGHLIGHT_CLASS = 'reader-highlight';
export const HIGHLIGHT_NOTE_ATTR = 'data-note-id';
`;

const mockEpubJsRuntime = `
let factory = () => {
  throw new Error('reader test did not configure the epubjs factory');
};

function ePub(options) {
  return factory(options);
}

ePub.setFactory = (nextFactory) => {
  factory = nextFactory;
};

module.exports = ePub;
`;

const mockEpubJsPackage = JSON.stringify({
  name: 'epubjs-reader-test-double',
  main: 'index.js',
  types: 'index.d.ts',
});

const mockEpubJsTypes = `
export interface TocItem {
  href: string;
  label: string;
  subitems?: TocItem[];
}

export interface Rendition {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
  destroy: () => void;
  display: (target?: string) => Promise<unknown>;
  next: () => Promise<unknown> | void;
  prev: () => Promise<unknown> | void;
}

export interface Book {
  open: (root: string) => Promise<void>;
  ready: Promise<void>;
  navigation?: { toc: TocItem[] };
  renderTo: (element: string, options: Record<string, unknown>) => Rendition;
  destroy: () => void;
}

declare const ePub: (options?: unknown) => Book;
export default ePub;
`;

function parseArguments(args) {
  let library = null;
  let reader = false;
  let explicitSuite = false;
  let redGreen = false;
  let list = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--red-green') {
      redGreen = true;
      continue;
    }
    if (arg === '--list') {
      list = true;
      continue;
    }
    if (arg === '--library') {
      library = args[index + 1];
      explicitSuite = true;
      index += 1;
      continue;
    }
    if (arg.startsWith('--library=')) {
      library = arg.slice('--library='.length);
      explicitSuite = true;
      continue;
    }
    if (arg === '--reader') {
      reader = true;
      explicitSuite = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (library !== null && !libraryTests.has(library)) {
    throw new Error(`Unknown library '${library}'. Available: ${[...libraryTests.keys()].join(', ')}`);
  }
  if (reader && library !== null) {
    throw new Error('Choose one frontend test group: --library or --reader');
  }
  const suites = reader ? ['reader'] : library === null ? [...testSuites.keys()] : [library];
  return { suites, explicitSuite, list, redGreen };
}

function commandFailure(error) {
  const code = typeof error?.code === 'number' ? error.code : 1;
  return {
    code,
    stdout: String(error?.stdout ?? ''),
    stderr: String(error?.stderr ?? error?.message ?? ''),
  };
}

async function runCommand(command, args, options) {
  try {
    const result = await execFileAsync(command, args, {
      ...options,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return commandFailure(error);
  }
}

function compactOutput(result) {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const lines = output.split(/\r?\n/).filter(Boolean);
  return lines.slice(-36).join('\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function testCount(result) {
  const match = `${result.stdout}\n${result.stderr}`.match(/# tests (\d+)/);
  return match?.[1] ?? '?';
}

function hasExecutedTests(result) {
  const count = Number(testCount(result));
  return Number.isInteger(count) && count > 0;
}

async function prepareBuild(buildRoot, suites) {
  assertSafeTempRoot(buildRoot);
  await rm(buildRoot, { recursive: true, force: true });
  const sourceRoot = path.join(buildRoot, 'source');
  await mkdir(path.join(sourceRoot, 'stores'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'lib'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'types'), { recursive: true });

  const includesLibrary = suites.includes('library');
  const includesReader = suites.includes('reader');
  if (includesReader) {
    await mkdir(path.join(sourceRoot, 'features', 'reader', 'engine'), { recursive: true });
    await mkdir(path.join(buildRoot, 'node_modules', 'epubjs'), { recursive: true });
  }

  let sourceHashInput = '';
  if (includesLibrary) {
    const storeSource = await readFile(sourceStorePath, 'utf8');
    sourceHashInput += storeSource;
    await writeFile(path.join(sourceRoot, 'stores', 'libraryStore.ts'), storeSource);
    await writeFile(path.join(sourceRoot, 'lib', 'tauri.ts'), mockTauriSource);
  }
  if (includesReader) {
    const readerStoreSource = await readFile(sourceReaderStorePath, 'utf8');
    sourceHashInput += readerStoreSource;
    sourceHashInput += await readFile(path.join(repoRoot, 'src/features/reader/engine/reflow.ts'), 'utf8');
    await writeFile(path.join(sourceRoot, 'stores', 'readerStore.ts'), readerStoreSource);
    await writeFile(path.join(sourceRoot, 'lib', 'tauri.ts'), mockReaderTauriSource);
    await writeFile(
      path.join(sourceRoot, 'features', 'reader', 'engine', 'reflow.ts'),
      mockReaderEngineSource,
    );
    await writeFile(
      path.join(sourceRoot, 'features', 'reader', 'engine', 'highlights.ts'),
      mockReaderHighlightsSource,
    );
    await writeFile(
      path.join(buildRoot, 'node_modules', 'epubjs', 'package.json'),
      mockEpubJsPackage,
    );
    await writeFile(
      path.join(buildRoot, 'node_modules', 'epubjs', 'index.js'),
      mockEpubJsRuntime,
    );
    await writeFile(
      path.join(buildRoot, 'node_modules', 'epubjs', 'index.d.ts'),
      mockEpubJsTypes,
    );
    // Exercise production adapters and the effect body, not copies of their logic.
    const readerSources = [
      'features/reader/engine/lifecycle.ts',
      'features/reader/engine/search.ts',
      'features/reader/engine/navigation.ts',
      'features/reader/engine/keyboard.ts',
      'features/reader/engine/pageTurn.ts',
      'features/reader/settingsPersistence.ts',
      'features/reader/useReadingActivity.ts',
      'features/library/seriesSearch.ts',
    ];
    for (const relative of readerSources) {
      const source = await readFile(path.join(repoRoot, 'src', relative), 'utf8');
      sourceHashInput += relative + source;
      await mkdir(path.dirname(path.join(sourceRoot, relative)), { recursive: true });
      await writeFile(path.join(sourceRoot, relative), source);
    }
    // Only capture an effect setup/cleanup; this is not a React/WebView renderer.
    const reactRoot = path.join(buildRoot, 'node_modules', 'react');
    await mkdir(reactRoot, { recursive: true });
    await writeFile(path.join(reactRoot, 'package.json'), JSON.stringify({
      name: 'reader-effect-test-double', main: 'index.js', types: 'index.d.ts',
    }));
    await writeFile(path.join(reactRoot, 'index.js'),
      'let cleanup;exports.useEffect=effect=>{cleanup=effect()};'
      + 'exports.takeEffectCleanup=()=>{const old=cleanup;cleanup=undefined;return old};');
    await writeFile(path.join(reactRoot, 'index.d.ts'),
      'export function useEffect(effect:()=>void|(()=>void),deps?:unknown[]):void;');
  }

  await cp(sourceModelsPath, path.join(sourceRoot, 'types', 'models.ts'));
  await writeFile(
    path.join(buildRoot, 'package.json'),
    JSON.stringify({ type: 'commonjs' }, null, 2),
  );
  const tsconfigPath = path.join(buildRoot, 'tsconfig.json');
  await writeFile(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'CommonJS',
          moduleResolution: 'Node',
          outDir: path.join(buildRoot, 'compiled'),
          rootDir: sourceRoot,
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          forceConsistentCasingInFileNames: true,
          noEmitOnError: true,
        },
        include: [path.join(sourceRoot, '**', '*.ts')],
      },
      null,
      2,
    ),
  );

  const tscScript = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const compile = await runCommand(process.execPath, [tscScript, '--project', tsconfigPath], {
    cwd: repoRoot,
  });
  if (compile.code !== 0) {
    throw new Error(`frontend TypeScript compile failed\n${compactOutput(compile)}`);
  }
  return { sourceHash: createHash('sha256').update(sourceHashInput).digest('hex') };
}

function assertSafeTempRoot(buildRoot) {
  const resolvedRoot = path.resolve(buildRoot);
  const relativeRoot = path.relative(targetBase, resolvedRoot);
  if (
    !allowedTempRoots.has(resolvedRoot) ||
    !relativeRoot ||
    relativeRoot.startsWith('..') ||
    path.isAbsolute(relativeRoot)
  ) {
    throw new Error(`Refusing to remove a non-whitelisted frontend test directory: ${resolvedRoot}`);
  }
}

function injectStoreMutation(storeSource, spec) {
  const matches = storeSource.match(spec.pattern) ?? [];
  if (matches.length !== 1) {
    throw new Error(`Red-green injection point changed for ${spec.label}: expected one match`);
  }
  return storeSource.replace(spec.pattern, (match) => spec.mutate(match));
}

function assertTargetedFailure(result, spec) {
  const output = `${result.stdout}\n${result.stderr}`;
  const namedFailure = new RegExp(`not ok \\d+ - ${escapeRegExp(spec.testName)}`).test(output);
  const assertionFailure = output.includes(`code: '${spec.assertionText}'`)
    && output.includes('Expected values to be strictly');
  if (result.code === 0 || !namedFailure || !output.includes('failureType: \'testCodeFailure\'') || !assertionFailure) {
    throw new Error(
      `Red-green check for ${spec.label} did not fail at the named assertion\n${compactOutput(result)}`,
    );
  }
}

async function runSelectedTests(buildRoot, suites, testNamePattern = null) {
  const testPaths = suites.flatMap((suite) =>
    testSuites.get(suite).map((file) => path.join(repoRoot, 'scripts', 'frontend-tests', file)),
  );
  const testArgs = testNamePattern === null
    ? ['--test', '--test-reporter=tap', ...testPaths]
    : ['--test', '--test-reporter=tap', '--test-name-pattern', testNamePattern, ...testPaths];
  return runCommand(process.execPath, testArgs, {
    cwd: repoRoot,
    env: { ...process.env, FRONTEND_TEST_BUILD_DIR: buildRoot },
  });
}

async function runNormal(suites) {
  let cases = 0;
  let sourceHash = null;
  for (const suite of suites) {
    const build = await prepareBuild(targetRoot, [suite]);
    const result = await runSelectedTests(targetRoot, [suite]);
    if (result.code !== 0) {
      console.error(`frontend tests failed (suite: ${suite}, exit: ${result.code || 1})`);
      console.error(compactOutput(result));
      return result.code || 1;
    }
    if (!hasExecutedTests(result)) {
      console.error(`frontend tests failed (suite: ${suite}, exit: 1)`);
      console.error('Node reported no executed tests');
      return 1;
    }
    cases += Number(testCount(result));
    sourceHash = build.sourceHash;
  }
  console.log(
    `frontend tests passed (suite: ${suites.join(', ')}, cases: ${cases}, exit: 0, source: ${sourceHash.slice(0, 12)})`,
  );
  return 0;
}

async function runRedGreen(suites) {
  let checks = 0;
  try {
    for (const spec of redGreenSpecs) {
      await prepareBuild(redGreenRoot, suites);
      const mutatedStore = injectStoreMutation(
        await readFile(path.join(redGreenRoot, 'source', 'stores', 'libraryStore.ts'), 'utf8'),
        spec,
      );
      await writeFile(path.join(redGreenRoot, 'source', 'stores', 'libraryStore.ts'), mutatedStore);
      const compile = await runCommand(
        process.execPath,
        [path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', path.join(redGreenRoot, 'tsconfig.json')],
        { cwd: repoRoot },
      );
      if (compile.code !== 0) {
        throw new Error(`Red-green compile failed for ${spec.label}\n${compactOutput(compile)}`);
      }
      const red = await runSelectedTests(redGreenRoot, suites, spec.testName);
      assertTargetedFailure(red, spec);
      checks += 1;
    }

    const greenBuild = await prepareBuild(targetRoot, suites);
    const green = await runSelectedTests(targetRoot, suites);
    if (green.code !== 0) {
      console.error('red-green failed: clean source did not recover');
      console.error(compactOutput(green));
      return green.code || 1;
    }
    if (!hasExecutedTests(green)) {
      console.error('red-green failed: clean source reported no executed tests');
      return 1;
    }
    console.log(
      `red-green passed (${checks} targeted defects failed at named assertions; restored source passed; cases: ${testCount(green)}; exit: 0; source: ${greenBuild.sourceHash.slice(0, 12)})`,
    );
    return 0;
  } finally {
    assertSafeTempRoot(redGreenRoot);
    await rm(redGreenRoot, { recursive: true, force: true });
  }
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('Usage: npm run test:frontend -- [--library <name> | --reader] [--list] [--red-green]');
    return 2;
  }

  if (options.list) {
    console.log([...testSuites.keys()].join('\n'));
    return 0;
  }
  if (options.redGreen && options.suites.includes('reader') && options.explicitSuite) {
    console.error('The --red-green mode currently supports only the library suite');
    return 2;
  }
  return options.redGreen
    ? runRedGreen(options.explicitSuite ? options.suites : ['library'])
    : runNormal(options.suites);
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`frontend tests failed (exit: 1)`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
