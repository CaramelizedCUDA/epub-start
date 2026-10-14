// 被测目标的适配层。三种目标：
//   E2E_TARGET=harness（默认）  纯 EPUB.js 基线页，见 e2e/harness/。没有 EpubStart 的任何补丁。
//   E2E_TARGET=app             EpubStart 本体。下面标了 TODO(adapt) 的地方需要按你的实际 UI/钩子改。
//   E2E_TARGET=mock            不依赖 EPUB.js 的模拟 rendition（e2e/selftest/）。只用来验证“测试框架本身”
//                              （矩阵、走书、快照、Playwright 配置）是通的，它的结果不代表任何真实阅读器的行为。
//
// 两种目标跑同一套不变量，是为了做归因：
//   基线能复现 -> 问题在 EPUB.js；只有 app 出现 -> 问题在 reflow.ts / pagination.ts 等项目自己的代码。

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type { SettingsCase } from "./types.ts";
import { installTauriMock } from "./app/tauri-mock.ts";
// @ts-ignore 无类型声明的 .mjs
import { readBookEntry } from "./app/book-entries.mjs";

export const TARGET = (process.env.E2E_TARGET ?? "harness") as "harness" | "app" | "mock";
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// app 目标：项目的 Vite 开发服务器（vite.config.ts 的 1420 端口）
export function baseUrl(): string {
  return process.env.E2E_BASE_URL ?? (TARGET === "app" ? "http://127.0.0.1:1420" : "http://127.0.0.1:4173");
}

export async function openFixture(page: Page, file: string): Promise<void> {
  if (TARGET === "mock") {
    // 模拟页不读 epub，而是直接拿生成器导出的章节 HTML（只支持内置 fixture，不支持 regression/ 里的书）
    // @ts-ignore 无类型声明的 .mjs
    const mod = await import("../scripts/make-fixtures.mjs");
    const id = path.basename(file, ".epub");
    await page.addInitScript((b) => ((window as any).__MOCK_BOOK = b), mod.exportForMock(id));
    await page.goto(`${baseUrl()}/e2e/selftest/mock-rendition.html`);
    await page.evaluate(() => (window as any).__mockReady);
    return;
  }
  if (TARGET === "harness") {
    await page.goto(`${baseUrl()}/e2e/harness/index.html`);
    await page.evaluate((f) => (window as any).__harness.open(`/fixtures/${f}`), file);
    return;
  }
  // EpubStart 本体：浏览器里跑 Vite 开发服务器。Tauri IPC 由 tauri-mock 模拟（书架只有这一本书），
  // 书的资源由 book-server 从 fixture 提供。从书架点击打开，与真实用户路径一致。
  // 开发钩子 ?e2e=1 只在 DEV 构建挂出（src/stores/readerStore.ts 末尾）。
  const id = path.basename(file, ".epub");
  // 书资源：拦截 Windows 桌面版的 epub 根地址 http://epub.localhost/book/<id>/，从 fixture 取条目。
  // 应用的 normalizeEpubRequestUrl 只原样放行这个前缀，所以根地址必须用它。
  await page.route("http://epub.localhost/book/**", async (route) => {
    const u = new URL(route.request().url());
    const m = /^\/book\/([\w-]+)\/(.+)$/.exec(u.pathname);
    const entry = m ? await readBookEntry(m[1]!, decodeURIComponent(m[2]!)) : null;
    if (!entry) return route.fulfill({ status: 404 });
    return route.fulfill({
      status: 200,
      body: entry.body,
      contentType: entry.type,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await installTauriMock(page, { books: [{ id, title: id }], bookBase: "http://epub.localhost" });
  await page.goto(`${baseUrl()}/?e2e=1`);
  // 卡片点击先打开书籍操作面板，再点“开始阅读”才进入阅读器
  await page.locator(".library-book-card", { hasText: id }).locator("button").first().click();
  await page.getByRole("button", { name: "开始阅读", exact: true }).click();
  await page.waitForFunction(() => Boolean((window as any).__EPUBSTART_E2E__?.rendition?.getContents?.().length));
}

export async function applySettings(page: Page, s: SettingsCase): Promise<void> {
  if (TARGET === "mock") return; // 模拟页没有可调设置
  if (TARGET === "harness") {
    await page.evaluate((x) => (window as any).__harness.applySettings(x), s);
    return;
  }
  // 必须走应用自己的设置入口（经 applyReadingSettings -> reflow.ts / preserveAndReflow），
  // 不能直接调 rendition.resize()，那正是 ARCHITECTURE.md 禁止的。
  // 以当前生效设置为底，只替换本用例关心的字段。
  const current = await page.evaluate(() => (window as any).__EPUBSTART_E2E__.readingSettings());
  await page.evaluate(
    ([cur, x]) =>
      (window as any).__EPUBSTART_E2E__.applySettings({
        ...cur,
        font_size_px: x.fontSizePx,
        spread: x.spread === "double" ? "always" : "none",
      }),
    [current, s] as const,
  );
}

/** 窗口缩放：交给 Playwright，让应用自己的 resize 监听去触发重排 */
export async function resizeViewport(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
}
