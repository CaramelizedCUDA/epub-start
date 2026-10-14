// 检查器自检：不依赖 EPUB.js、不依赖你的应用。
//
// 做法：在 mock-rendition.html 里用真实浏览器的 CSS 多列 + scrollLeft 复现 EPUB.js 的分页方式，
// 分别跑“无缺陷”和“埋入已知缺陷”的版本，确认：
//   1) 无缺陷时，走书器 + 不变量零误报（否则整套测试都不可信）
//   2) 每个已知缺陷都被对应规则抓到（负向对照；检查器抓不到 bug 就等于没有）
//
//   node e2e/selftest/run.mjs
//
// 需要 Node >= 22.18（直接 import .ts）和 playwright（装了 @playwright/test 就有）。

import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createServer } from "../../scripts/serve.mjs";
import { exportForMock, FIXTURE_IDS } from "../../scripts/make-fixtures.mjs";
import { checkAll, formatViolations } from "../invariants.ts";
import { summarize } from "../summary.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WALKER = path.join(HERE, "..", "in-page", "walker.js");

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // 全局安装（没有在项目里装 @playwright/test）时的兜底
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    return await import(path.join(root, "playwright", "index.mjs"));
  }
}

const { chromium } = await loadPlaywright();
const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

/** 每个用例：埋入的缺陷 -> 期望出现的规则（none 表示期望零违规） */
const CASES = [
  { bug: "none", expect: [] },
  { bug: "skip", expect: ["text-lost"] },
  // 章末不足一页时直接跳章：被跳过的是“章节结尾”，所以对应 chapter-end（text-lost 只管章内的缺口）
  { bug: "tailjump", expect: ["chapter-end"] },
  { bug: "blank", expect: ["blank-page"] },
  // next 正常、prev 多退一页：只有往返探测能发现这类不对称
  { bug: "prevskip", expect: ["roundtrip-prev"], mustReachEnd: true },
];

let failed = 0;
const report = [];

for (const c of CASES) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript({ path: WALKER });
  await page.goto(`${base}/e2e/selftest/mock-rendition.html?bug=${c.bug}`);
  await page.evaluate(() => window.__mockReady);

  const res = await page.evaluate(() => window.__e2eWalker.walk({ roundTripEvery: 3 }));
  const traj = {
    bookId: "mock",
    settingsId: c.bug,
    viewport: { width: 900, height: 600, dpr: 1 },
    chapters: res.chapters,
    pages: res.pages,
    roundTrips: res.roundTrips,
    spineLength: res.spineLength,
    stoppedBy: res.stoppedBy,
  };
  const violations = checkAll(traj);
  const rules = [...new Set(violations.map((v) => v.rule))];

  let ok;
  if (c.bug === "none") ok = violations.length === 0 && errors.length === 0 && traj.stoppedBy === "end" && traj.chapters.length === traj.spineLength && traj.pages.length >= traj.spineLength * 2 &&
    // 自检本身要真的覆盖到这两条路径：做过往返探测；出现过不对齐步长的“贴章末”尾页（text-duplicated / scroll-misaligned 的豁免路径）
    traj.roundTrips.length > 0 && traj.pages.some((p) => p.atMaxScroll && p.scrollLeft % p.step !== 0);
  else ok = c.expect.every((r) => rules.includes(r)) && (!c.mustReachEnd || (traj.stoppedBy === "end" && !rules.includes("walk-stuck")));

  report.push({ bug: c.bug, ok, pages: traj.pages.length, stoppedBy: traj.stoppedBy, rules, errors, sample: formatViolations(violations, 4) });
  if (!ok) failed++;
  if (c.bug === "none") process.env.SELFTEST_DUMP && console.log(JSON.stringify(summarize(traj), null, 1));
  await ctx.close();
}

// ---- 第二部分：fixture 自身在“多列 + scrollLeft”布局下也必须零违规 ----
// 这一步验证的是 fixture（图片、ruby、超长串、纯图章节……）不会制造假阳性，不涉及 EPUB.js。
const fixtureReport = [];
for (const id of FIXTURE_IDS) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript({ path: WALKER });
  await page.addInitScript((book) => (window.__MOCK_BOOK = book), exportForMock(id));
  await page.goto(`${base}/e2e/selftest/mock-rendition.html`);
  await page.evaluate(() => window.__mockReady);
  const res = await page.evaluate(() => window.__e2eWalker.walk({ roundTripEvery: 4, maxPages: 400 }));
  const traj = { bookId: id, settingsId: "mock", viewport: { width: 900, height: 600, dpr: 1 }, ...res };
  const violations = checkAll(traj);
  const ok = violations.length === 0 && errors.length === 0 && res.stoppedBy === "end" && res.chapters.length === res.spineLength;
  if (!ok) failed++;
  fixtureReport.push({ id, ok, pages: res.pages.length, chapters: res.chapters.length, roundTrips: res.roundTrips.length, sample: formatViolations(violations, 6), errors });
  await ctx.close();
}

await browser.close();
server.close();

for (const r of report) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  bug=${r.bug.padEnd(8)} pages=${String(r.pages).padStart(3)} stoppedBy=${r.stoppedBy}  规则: ${r.rules.join(",") || "（无）"}`);
  if (!r.ok || process.env.VERBOSE) console.log("      " + r.sample.replace(/\n/g, "\n      "));
  for (const e of r.errors) console.log("      pageerror:", e);
}
for (const r of fixtureReport) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  fixture=${r.id.padEnd(18)} pages=${String(r.pages).padStart(3)} chapters=${r.chapters} roundTrips=${r.roundTrips}`);
  if (!r.ok) console.log("      " + r.sample.replace(/\n/g, "\n      "));
  for (const e of r.errors) console.log("      pageerror:", e);
}

if (failed) {
  console.error(`\n${failed} 个自检用例失败`);
  process.exit(1);
}
console.log("\n自检通过：无缺陷零误报，埋入的缺陷全部被抓到，fixture 在多列布局下零违规");
