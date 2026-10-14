#!/usr/bin/env node
// 按 docs/VERIFICATION.md 影响面执行提交前快速确定性门禁（零浏览器/零打包开销）。
//
// 用法：
//   node scripts/run-staged-gate.mjs                    # 读取 git diff --cached --name-only
//   node scripts/run-staged-gate.mjs --files a.ts b.md  # 用指定文件列表演练触发逻辑
//   node scripts/run-staged-gate.mjs --dry-run ...      # 只输出将执行的命令，不实际运行

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NPM_CMD = process.platform === "win32" ? "npm.cmd" : "npm";
const CARGO_CMD = process.platform === "win32" ? "cargo.exe" : "cargo";

function parseArgs(argv) {
  let dryRun = false;
  let explicitFiles = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--files") {
      explicitFiles = [];
      for (i = i + 1; i < argv.length && !argv[i].startsWith("--"); i++) {
        explicitFiles.push(argv[i]);
      }
      i--;
    }
  }
  return { dryRun, explicitFiles };
}

function getStagedFiles() {
  const out = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return out
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

export function planGateSteps(files) {
  const norm = files.map((f) => f.replace(/\\/g, "/"));
  const touchesFrontend = norm.some(
    (f) =>
      f.startsWith("src/") ||
      f.startsWith("scripts/frontend-tests/") ||
      f === "scripts/test-frontend.mjs" ||
      f === "package.json" ||
      f === "tsconfig.json" ||
      f === "vite.config.ts",
  );
  const touchesLibraryOnly =
    touchesFrontend &&
    norm
      .filter((f) => f.startsWith("src/") || f.startsWith("scripts/frontend-tests/"))
      .every(
        (f) =>
          f.includes("library") ||
          f.startsWith("src/features/bookshelf/") ||
          f === "scripts/frontend-tests/libraryStore.test.cjs",
      );
  const touchesE2eSuite = norm.some((f) => f.startsWith("epubstart-e2e/"));
  const touchesRust = norm.some((f) => f.startsWith("src-tauri/"));
  const touchesUnwrapRegistry =
    touchesRust ||
    norm.some(
      (f) =>
        f === "BACKEND_AUDIT.md" ||
        f === "TODO.md" ||
        f === "scripts/audit-unwrap.mjs",
    );

  const steps = [];

  if (touchesFrontend) {
    steps.push({
      label: "TypeScript 类型检查 (tsc --noEmit)",
      cmd: NPM_CMD,
      args: ["run", "typecheck"],
    });
    steps.push({
      label: "Reader 架构静态约束 (check:arch)",
      cmd: NPM_CMD,
      args: ["run", "check:arch"],
    });
    if (touchesLibraryOnly) {
      steps.push({
        label: "前端回归：library 子集",
        cmd: NPM_CMD,
        args: ["run", "test:frontend", "--", "--library", "library"],
      });
    } else {
      steps.push({
        label: "前端回归套件 (test:frontend)",
        cmd: NPM_CMD,
        args: ["run", "test:frontend"],
      });
    }
  }

  if (touchesE2eSuite) {
    steps.push({
      label: "E2E 套件确定性单测与静态检查 (test:e2e:unit)",
      cmd: NPM_CMD,
      args: ["run", "test:e2e:unit"],
    });
  }

  if (touchesUnwrapRegistry) {
    steps.push({
      label: "Rust unwrap 统计登记一致性 (audit:check)",
      cmd: NPM_CMD,
      args: ["run", "audit:check"],
    });
  }

  if (touchesRust) {
    steps.push({
      label: "Rust 格式检查 (cargo fmt --check)",
      cmd: CARGO_CMD,
      args: ["fmt", "--manifest-path", "src-tauri/Cargo.toml", "--check"],
    });
    steps.push({
      label: "Rust 编译检查 (cargo check)",
      cmd: CARGO_CMD,
      args: ["check", "--manifest-path", "src-tauri/Cargo.toml"],
    });
  }

  return steps;
}

const { dryRun, explicitFiles } = parseArgs(process.argv.slice(2));
const files = explicitFiles ?? getStagedFiles();

if (files.length === 0) {
  console.log("[gate] 无暂存文件，跳过门禁。");
  process.exit(0);
}

const steps = planGateSteps(files);
if (steps.length === 0) {
  console.log(`[gate] 暂存变更仅涉及文档或非代码资产（${files.length} 个文件），按验证策略不触发构建/测试。`);
  process.exit(0);
}

console.log(`[gate] 检测到 ${files.length} 个变更文件，匹配 ${steps.length} 项快速确定性门禁：`);
for (const step of steps) {
  const display = `${step.cmd} ${step.args.join(" ")}`;
  console.log(`  -> ${step.label}: ${display}`);
  if (dryRun) continue;
  const res = spawnSync(step.cmd, step.args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    console.error(`\n[gate] 门禁失败：${step.label}`);
    process.exit(res.status ?? 1);
  }
}

if (!dryRun) {
  console.log("[gate] 全部受影响快速确定性门禁通过。");
}
