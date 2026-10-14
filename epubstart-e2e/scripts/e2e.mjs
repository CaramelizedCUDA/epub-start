// 跨平台启动器：设置 E2E_TARGET 等环境变量后运行 Playwright。
// 为什么需要它：`E2E_TARGET=app npx playwright test` 这种写法在 PowerShell / cmd 里不能用。
//
//   node scripts/e2e.mjs <harness|app|mock> [--full] [--anchor-baseline] [playwright 的其他参数...]
//
//   --full             跑完整矩阵（E2E_MATRIX=full）
//   --anchor-baseline  在 harness 目标上也跑重排锚定（默认不跑，见 reader.spec.ts）
//   其余参数原样交给 `playwright test`，例如 --update-snapshots、-g "long-chapter"

import { spawnSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const [target, ...rest] = process.argv.slice(2);
if (!["harness", "app", "mock"].includes(target ?? "")) {
  console.error("用法：node scripts/e2e.mjs <harness|app|mock> [--full] [--anchor-baseline] [playwright 参数...]");
  process.exit(2);
}

const env = { ...process.env, E2E_TARGET: target };
const args = [];
for (const a of rest) {
  if (a === "--full") env.E2E_MATRIX = "full";
  else if (a === "--anchor-baseline") env.E2E_ANCHOR_BASELINE = "1";
  else args.push(a);
}

function findCli() {
  const require = createRequire(import.meta.url);
  for (const spec of ["@playwright/test/cli", "playwright/cli"]) {
    try {
      return require.resolve(spec);
    } catch {
      /* 试下一个 */
    }
  }
  // 只有全局安装时的兜底
  const root = execSync("npm root -g", { encoding: "utf8" }).trim();
  return path.join(root, "playwright", "cli.js");
}

const r = spawnSync(process.execPath, [findCli(), "test", ...args], {
  cwd: SUITE_ROOT,
  stdio: "inherit",
  env,
});
process.exit(r.status ?? 1);
