#!/usr/bin/env node
/**
 * Audit the current Android arm64 release artifacts against the committed
 * absolute limits and size baseline. The script only reads build outputs.
 *
 * Usage:
 *   npm run audit:android-release
 *   node scripts/audit-android-release.mjs --baseline path/to/baseline.json
 *   node scripts/audit-android-release.mjs --readelf path/to/llvm-readelf
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASELINE = join(
  ROOT,
  'release-baselines',
  'android-arm64-release.json',
);
const PACKAGE_LOCK = join(ROOT, 'package-lock.json');
const CARGO_LOCK = join(ROOT, 'src-tauri', 'Cargo.lock');
const APK = join(
  ROOT,
  'src-tauri',
  'gen',
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'arm64',
  'release',
  'app-arm64-release-unsigned.apk',
);
const AAB = join(
  ROOT,
  'src-tauri',
  'gen',
  'android',
  'app',
  'build',
  'outputs',
  'bundle',
  'arm64Release',
  'app-arm64-release.aab',
);
const RUST_NATIVE = join(
  ROOT,
  'src-tauri',
  'target',
  'aarch64-linux-android',
  'release',
  'libepub_start_lib.so',
);
const DIST = join(ROOT, 'dist');
const APP_GRADLE = join(
  ROOT,
  'src-tauri',
  'gen',
  'android',
  'app',
  'build.gradle.kts',
);
const ROOT_GRADLE = join(
  ROOT,
  'src-tauri',
  'gen',
  'android',
  'build.gradle.kts',
);
const RUST_PLUGIN = join(
  ROOT,
  'src-tauri',
  'gen',
  'android',
  'buildSrc',
  'src',
  'main',
  'java',
  'com',
  'epubstart',
  'reader',
  'kotlin',
  'RustPlugin.kt',
);
const WRAPPER_PROPERTIES = join(
  ROOT,
  'src-tauri',
  'gen',
  'android',
  'gradle',
  'wrapper',
  'gradle-wrapper.properties',
);

function parseArgs(argv) {
  const result = { baseline: DEFAULT_BASELINE, readelf: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--baseline' || arg === '--readelf') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a path`);
      result[arg.slice(2)] = isAbsolute(value) ? value : resolve(ROOT, value);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return result;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read JSON ${relative(ROOT, path)}: ${error.message}`);
  }
}

function requirePath(path, kind) {
  if (!existsSync(path)) {
    throw new Error(`missing ${kind}: ${relative(ROOT, path)}`);
  }
}

function commandVersion(command, args, pattern, label) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`cannot run ${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} exited with status ${result.status}`);
  }
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const match = output.match(pattern);
  if (!match) throw new Error(`cannot read ${label} version`);
  return match[1];
}

function directorySize(path) {
  let bytes = 0;
  let files = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) {
      const nested = directorySize(full);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile()) {
      bytes += statSync(full).size;
      files += 1;
    } else {
      throw new Error(`dist contains unsupported entry: ${relative(ROOT, full)}`);
    }
  }
  return { bytes, files };
}

function findEndOfCentralDirectory(buffer, archivePath) {
  const signature = 0x06054b50;
  const lowerBound = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  throw new Error(`ZIP central directory not found: ${relative(ROOT, archivePath)}`);
}

function readZip(path) {
  const buffer = readFileSync(path);
  const eocd = findEndOfCentralDirectory(buffer, path);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`invalid ZIP central entry in ${relative(ROOT, path)}`);
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString((flags & 0x0800) !== 0 ? 'utf8' : 'latin1');
    entries.push({
      name,
      flags,
      method,
      compressedSize,
      size,
      localOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { buffer, entries };
}

function extractZipEntry(zip, entry) {
  if ((entry.flags & 0x0001) !== 0) {
    throw new Error(`encrypted ZIP entry is unsupported: ${entry.name}`);
  }
  const offset = entry.localOffset;
  if (zip.buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`invalid ZIP local entry: ${entry.name}`);
  }
  const nameLength = zip.buffer.readUInt16LE(offset + 26);
  const extraLength = zip.buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = zip.buffer.subarray(
    dataStart,
    dataStart + entry.compressedSize,
  );
  let output;
  if (entry.method === 0) output = Buffer.from(compressed);
  else if (entry.method === 8) output = inflateRawSync(compressed);
  else throw new Error(`unsupported ZIP compression method ${entry.method}: ${entry.name}`);
  if (output.length !== entry.size) {
    throw new Error(`ZIP size mismatch for ${entry.name}`);
  }
  return output;
}

function executableCandidates(ndkRoot) {
  const prebuilt = join(ndkRoot, 'toolchains', 'llvm', 'prebuilt');
  if (!existsSync(prebuilt)) return [];
  const executable = process.platform === 'win32' ? 'llvm-readelf.exe' : 'llvm-readelf';
  return readdirSync(prebuilt, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(prebuilt, entry.name, 'bin', executable));
}

function findReadelf(explicitPath, ndkVersion) {
  const executable = process.platform === 'win32' ? 'llvm-readelf.exe' : 'llvm-readelf';
  const direct = [explicitPath, process.env.LLVM_READELF].filter(Boolean);
  for (const path of direct) if (existsSync(path)) return path;

  const ndkRoots = [process.env.ANDROID_NDK_HOME, process.env.NDK_HOME].filter(Boolean);
  const sdkRoots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);
  if (process.env.LOCALAPPDATA) sdkRoots.push(join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
  if (process.platform === 'win32') sdkRoots.push('D:\\Android\\Sdk');
  for (const sdk of sdkRoots) {
    ndkRoots.push(join(sdk, 'ndk', ndkVersion));
  }
  for (const root of ndkRoots) {
    for (const candidate of executableCandidates(root)) {
      if (existsSync(candidate)) return candidate;
    }
  }
  for (const part of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(part, executable);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function capture(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`cannot read ${label} from Android build files`);
  return match[1];
}

function formatMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(3)} MiB`;
}

function percentChange(current, baseline) {
  return ((current - baseline) / baseline) * 100;
}

function printMetric(label, bytes, detail = '') {
  console.log(
    `${label.padEnd(25)} ${String(bytes).padStart(10)} B  ${formatMiB(bytes).padStart(11)}${detail}`,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const [path, kind] of [
    [args.baseline, 'baseline'],
    [PACKAGE_LOCK, 'npm package lock'],
    [CARGO_LOCK, 'Cargo lock'],
    [APK, 'arm64 release APK'],
    [AAB, 'arm64 release AAB'],
    [RUST_NATIVE, 'Rust release native library'],
    [DIST, 'frontend dist directory'],
    [APP_GRADLE, 'Android app Gradle file'],
    [ROOT_GRADLE, 'Android root Gradle file'],
    [RUST_PLUGIN, 'Android Rust Gradle plugin'],
    [WRAPPER_PROPERTIES, 'Gradle wrapper properties'],
  ]) {
    requirePath(path, kind);
  }

  const baseline = readJson(args.baseline);
  if (baseline.schemaVersion !== 1) {
    throw new Error(`unsupported baseline schema: ${baseline.schemaVersion}`);
  }

  const appGradle = readFileSync(APP_GRADLE, 'utf8');
  const rootGradle = readFileSync(ROOT_GRADLE, 'utf8');
  const rustPlugin = readFileSync(RUST_PLUGIN, 'utf8');
  const wrapper = readFileSync(WRAPPER_PROPERTIES, 'utf8');
  const packageLock = readJson(PACKAGE_LOCK);
  const cargoLock = readFileSync(CARGO_LOCK, 'utf8');
  const npmCommand = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', 'npm.cmd --version']]
    : ['npm', ['--version']];
  const observedToolchain = {
    node: process.versions.node,
    npm: commandVersion(npmCommand[0], npmCommand[1], /(\d+\.\d+\.\d+)/, 'npm'),
    rustc: commandVersion('rustc', ['--version'], /rustc\s+(\d+\.\d+\.\d+)/, 'rustc'),
    cargo: commandVersion('cargo', ['--version'], /cargo\s+(\d+\.\d+\.\d+)/, 'cargo'),
    jdk: commandVersion(
      'java',
      ['--version'],
      /(?:openjdk|java)(?:\s+version)?\s+"?(\d+\.\d+\.\d+)/i,
      'JDK',
    ),
    compileSdk: Number(capture(appGradle, /compileSdk\s*=\s*(\d+)/, 'compileSdk')),
    targetSdk: Number(capture(appGradle, /targetSdk\s*=\s*(\d+)/, 'targetSdk')),
    ndk: capture(appGradle, /ndkVersion\s*=\s*"([^"]+)"/, 'ndkVersion'),
    androidGradlePlugin: capture(
      rootGradle,
      /com\.android\.tools\.build:gradle:([^"\)]+)/,
      'Android Gradle Plugin version',
    ),
    gradle: capture(wrapper, /gradle-([0-9.]+)-bin\.zip/, 'Gradle version'),
    tauriCli: packageLock.packages?.['node_modules/@tauri-apps/cli']?.version,
    tauri: capture(
      cargoLock,
      /\[\[package\]\]\s+name = "tauri"\s+version = "([^"]+)"/s,
      'Tauri crate version',
    ),
  };

  const failures = [];
  const profileBlock = appGradle.match(/create\("profile"\)\s*\{([^}]*)\}/s)?.[1];
  if (!profileBlock) {
    failures.push('Android profile build type is missing');
  } else {
    for (const [snippet, label] of [
      ['initWith(getByName("release"))', 'inherit release configuration'],
      ['isDebuggable = true', 'remain app-debuggable'],
      ['isJniDebuggable = false', 'disable JNI debug packaging'],
      ['isMinifyEnabled = false', 'disable ignored debuggable minification'],
      ['signingConfig = signingConfigs.getByName("debug")', 'use local debug signing'],
    ]) {
      if (!profileBlock.includes(snippet)) {
        failures.push(`Android profile must ${label}`);
      }
    }
  }
  if (!rustPlugin.includes('listOf("debug", "profile", "release")')) {
    failures.push('Rust Gradle plugin does not generate profile tasks');
  }
  if (!rustPlugin.includes('release = profile != "debug"')) {
    failures.push('Rust Gradle profile does not use a release native library');
  }
  if (!observedToolchain.tauriCli) {
    failures.push('cannot read Tauri CLI version from package-lock.json');
  }
  for (const [key, value] of Object.entries(observedToolchain)) {
    if (baseline.toolchain[key] !== value) {
      failures.push(
        `toolchain drift: ${key} is ${value}, baseline is ${baseline.toolchain[key]}`,
      );
    }
  }

  const apkZip = readZip(APK);
  const aabZip = readZip(AAB);
  const apkNative = apkZip.entries.find(
    (entry) => entry.name === 'lib/arm64-v8a/libepub_start_lib.so',
  );
  const aabNative = aabZip.entries.find(
    (entry) => entry.name === 'base/lib/arm64-v8a/libepub_start_lib.so',
  );
  if (!apkNative) failures.push('APK is missing the arm64 runtime library');
  if (!aabNative) failures.push('AAB is missing the arm64 runtime library');

  const runtimeAbis = new Set(
    apkZip.entries
      .map((entry) => entry.name.match(/^lib\/([^/]+)\/[^/]+\.so$/)?.[1])
      .filter(Boolean),
  );
  if (runtimeAbis.size !== 1 || !runtimeAbis.has('arm64-v8a')) {
    failures.push(`APK ABI set is not arm64-only: ${[...runtimeAbis].join(', ') || '(none)'}`);
  }
  const bundleAbis = new Set(
    aabZip.entries
      .map((entry) => entry.name.match(/^[^/]+\/lib\/([^/]+)\/[^/]+\.so$/)?.[1])
      .filter(Boolean),
  );
  if (bundleAbis.size !== 1 || !bundleAbis.has('arm64-v8a')) {
    failures.push(`AAB ABI set is not arm64-only: ${[...bundleAbis].join(', ') || '(none)'}`);
  }

  const forbiddenEntry = /(?:^|\/)(?:cache|source-cache|fixtures?|test-?data)(?:\/|$)|\.epub$|(?:^|\/)(?:Users|home)\//i;
  for (const [kind, entries] of [
    ['APK', apkZip.entries],
    ['AAB', aabZip.entries],
  ]) {
    const forbidden = entries.filter((entry) => forbiddenEntry.test(entry.name));
    if (forbidden.length > 0) {
      failures.push(`${kind} contains forbidden payloads: ${forbidden.map((entry) => entry.name).join(', ')}`);
    }
  }

  let forbiddenSections = [];
  let elfMachine = '(not checked)';
  let aabForbiddenSections = [];
  let aabElfMachine = '(not checked)';
  const readelf = findReadelf(args.readelf, baseline.toolchain.ndk);
  if (!readelf) {
    failures.push(
      'llvm-readelf not found; set ANDROID_HOME/ANDROID_NDK_HOME or pass --readelf',
    );
  } else {
    const auditDir = mkdtempSync(join(tmpdir(), 'epub-start-release-audit-'));
    try {
      for (const [kind, zip, native, fileName] of [
        ['APK', apkZip, apkNative, 'apk-libepub_start_lib.so'],
        ['AAB', aabZip, aabNative, 'aab-libepub_start_lib.so'],
      ]) {
        if (!native) continue;
        const nativePath = join(auditDir, fileName);
        writeFileSync(nativePath, extractZipEntry(zip, native));
        const output = execFileSync(
          readelf,
          ['--file-header', '--sections', '--wide', nativePath],
          { encoding: 'utf8' },
        );
        const machine = output.match(/Machine:\s+(.+)/)?.[1]?.trim() ?? '(unknown)';
        const sections = [...output.matchAll(/^\s*\[\s*\d+\]\s+(\S+)/gm)].map(
          (match) => match[1],
        );
        const forbidden = sections.filter(
          (section) =>
            section.startsWith('.debug') ||
            ['.symtab', '.strtab', '.gdb_index', '.gnu_debuglink'].includes(section),
        );
        if (kind === 'APK') {
          elfMachine = machine;
          forbiddenSections = forbidden;
        } else {
          aabElfMachine = machine;
          aabForbiddenSections = forbidden;
        }
        if (!/AArch64/i.test(machine)) {
          failures.push(`${kind} packaged native library machine is ${machine}, expected AArch64`);
        }
        if (forbidden.length > 0) {
          failures.push(`${kind} packaged native library retains forbidden sections: ${forbidden.join(', ')}`);
        }
      }
    } finally {
      rmSync(auditDir, { recursive: true, force: true });
    }
  }

  const dist = directorySize(DIST);
  const metrics = {
    apkBytes: statSync(APK).size,
    aabBytes: statSync(AAB).size,
    rustNativeBytes: statSync(RUST_NATIVE).size,
    packagedNativeBytes: apkNative?.size ?? 0,
    distBytes: dist.bytes,
  };
  const symbolMetadata = aabZip.entries.find((entry) =>
    /^BUNDLE-METADATA\/com\.android\.tools\.build\.debugsymbols\/arm64-v8a\/libepub_start_lib\.so\.sym$/.test(
      entry.name,
    ),
  );

  for (const [metric, limit] of [
    ['apkBytes', baseline.limits.apkBytes],
    ['rustNativeBytes', baseline.limits.rustNativeBytes],
    ['distBytes', baseline.limits.distBytes],
  ]) {
    if (metrics[metric] > limit) {
      failures.push(`${metric} is ${metrics[metric]} B, limit is ${limit} B`);
    }
  }

  const growthLimit = baseline.limits.relativeGrowthPercent;
  const growth = {};
  for (const [metric, baselineBytes] of Object.entries(baseline.artifacts)) {
    if (!(metric in metrics) || !Number.isFinite(baselineBytes) || baselineBytes <= 0) {
      failures.push(`invalid baseline metric: ${metric}`);
      continue;
    }
    growth[metric] = percentChange(metrics[metric], baselineBytes);
    if (growth[metric] > growthLimit) {
      failures.push(
        `${metric} grew ${growth[metric].toFixed(2)}%, limit is ${growthLimit}%`,
      );
    }
  }

  console.log('Android arm64 release audit');
  console.log(`Baseline                 ${relative(ROOT, args.baseline)}`);
  console.log(`Toolchain                Node ${observedToolchain.node}, npm ${observedToolchain.npm}, Rust ${observedToolchain.rustc}, JDK ${observedToolchain.jdk}`);
  console.log(`Android toolchain        Gradle ${observedToolchain.gradle}, AGP ${observedToolchain.androidGradlePlugin}, NDK ${observedToolchain.ndk}, Tauri ${observedToolchain.tauri}`);
  console.log('');
  printMetric('APK', metrics.apkBytes, `  growth ${growth.apkBytes?.toFixed(2)}%`);
  printMetric('AAB', metrics.aabBytes, `  growth ${growth.aabBytes?.toFixed(2)}%`);
  printMetric('Cargo release .so', metrics.rustNativeBytes, `  growth ${growth.rustNativeBytes?.toFixed(2)}%`);
  printMetric('Packaged runtime .so', metrics.packagedNativeBytes, `  growth ${growth.packagedNativeBytes?.toFixed(2)}%`);
  printMetric('Frontend dist', metrics.distBytes, `  ${dist.files} files; growth ${growth.distBytes?.toFixed(2)}%`);
  if (symbolMetadata) {
    printMetric('AAB symbol metadata', symbolMetadata.size, '  not installed on device');
  }
  console.log('');
  console.log(`APK ABI set              ${[...runtimeAbis].join(', ') || '(none)'}`);
  console.log(`AAB ABI set              ${[...bundleAbis].join(', ') || '(none)'}`);
  console.log(`APK packaged ELF         ${elfMachine}; forbidden sections ${forbiddenSections.length === 0 ? 'none' : forbiddenSections.join(', ')}`);
  console.log(`AAB packaged ELF         ${aabElfMachine}; forbidden sections ${aabForbiddenSections.length === 0 ? 'none' : aabForbiddenSections.join(', ')}`);

  if (failures.length > 0) {
    console.error('');
    console.error('Android release audit FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('');
  console.log('Android release audit PASSED.');
}

try {
  main();
} catch (error) {
  console.error(`Android release audit ERROR: ${error.message}`);
  process.exit(1);
}
