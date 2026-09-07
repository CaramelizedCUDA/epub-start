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
const sourceModelsPath = path.join(repoRoot, 'src', 'types', 'models.ts');
const targetBase = path.resolve(repoRoot, 'target');
const targetRoot = path.join(repoRoot, 'target', 'frontend-tests');
const redGreenRoot = path.join(repoRoot, 'target', 'frontend-tests-redgreen');
const allowedTempRoots = new Set([path.resolve(targetRoot), path.resolve(redGreenRoot)]);
const libraryTests = new Map([['library', ['libraryStore.test.cjs']]]);

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

function parseArguments(args) {
  let library = null;
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
      index += 1;
      continue;
    }
    if (arg.startsWith('--library=')) {
      library = arg.slice('--library='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (library !== null && !libraryTests.has(library)) {
    throw new Error(`Unknown library '${library}'. Available: ${[...libraryTests.keys()].join(', ')}`);
  }
  return { libraries: library === null ? [...libraryTests.keys()] : [library], list, redGreen };
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

async function prepareBuild(buildRoot) {
  assertSafeTempRoot(buildRoot);
  await rm(buildRoot, { recursive: true, force: true });
  const sourceRoot = path.join(buildRoot, 'source');
  await mkdir(path.join(sourceRoot, 'stores'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'lib'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'types'), { recursive: true });

  let storeSource = await readFile(sourceStorePath, 'utf8');
  const sourceHash = createHash('sha256').update(storeSource).digest('hex');

  await writeFile(path.join(sourceRoot, 'stores', 'libraryStore.ts'), storeSource);
  await cp(sourceModelsPath, path.join(sourceRoot, 'types', 'models.ts'));
  await writeFile(path.join(sourceRoot, 'lib', 'tauri.ts'), mockTauriSource);
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
  return { sourceHash };
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

async function runSelectedTests(buildRoot, libraries, testNamePattern = null) {
  const testPaths = libraries.flatMap((library) =>
    libraryTests.get(library).map((file) => path.join(repoRoot, 'scripts', 'frontend-tests', file)),
  );
  const testArgs = testNamePattern === null
    ? ['--test', '--test-reporter=tap', ...testPaths]
    : ['--test', '--test-reporter=tap', '--test-name-pattern', testNamePattern, ...testPaths];
  return runCommand(process.execPath, testArgs, {
    cwd: repoRoot,
    env: { ...process.env, FRONTEND_TEST_BUILD_DIR: buildRoot },
  });
}

async function runNormal(libraries) {
  const build = await prepareBuild(targetRoot);
  const result = await runSelectedTests(targetRoot, libraries);
  if (result.code !== 0) {
    console.error(`frontend tests failed (library: ${libraries.join(', ')}, exit: ${result.code || 1})`);
    console.error(compactOutput(result));
    return result.code || 1;
  }
  if (!hasExecutedTests(result)) {
    console.error('frontend tests failed (exit: 1)');
    console.error('Node reported no executed tests');
    return 1;
  }
  console.log(
    `frontend tests passed (library: ${libraries.join(', ')}, cases: ${testCount(result)}, exit: 0, source: ${build.sourceHash.slice(0, 12)})`,
  );
  return 0;
}

async function runRedGreen(libraries) {
  let checks = 0;
  try {
    for (const spec of redGreenSpecs) {
      await prepareBuild(redGreenRoot);
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
      const red = await runSelectedTests(redGreenRoot, libraries, spec.testName);
      assertTargetedFailure(red, spec);
      checks += 1;
    }

    const greenBuild = await prepareBuild(targetRoot);
    const green = await runSelectedTests(targetRoot, libraries);
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
    console.error('Usage: npm run test:frontend -- [--library <name>] [--list] [--red-green]');
    return 2;
  }

  if (options.list) {
    console.log([...libraryTests.keys()].join('\n'));
    return 0;
  }
  return options.redGreen ? runRedGreen(options.libraries) : runNormal(options.libraries);
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`frontend tests failed (exit: 1)`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
