// Node 侧：把浏览器里的走书结果装配成 Trajectory。

import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { PageRecord, Trajectory, ViewportCase } from "./types.ts";

export const WALKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "in-page", "walker.js");

/** 必须在 page.goto 之前调用：脚本会在每次导航后自动重新注入 */
export async function installWalker(page: Page): Promise<void> {
  await page.addInitScript({ path: WALKER_PATH });
}

interface WalkResult {
  pages: Omit<PageRecord, "seq">[] & { seq?: number }[];
  chapters: Trajectory["chapters"];
  roundTrips: Trajectory["roundTrips"];
  spineLength: number;
  stoppedBy: Trajectory["stoppedBy"];
}

export interface WalkOptions {
  bookId: string;
  settingsId: string;
  viewport: Pick<ViewportCase, "width" | "height" | "dpr">;
  maxPages?: number;
  roundTripEvery?: number;
  /** 打开书之后是否已经停在第一页；是则不再 display(0) */
  skipInitialDisplay?: boolean;
}

export async function walkBook(page: Page, o: WalkOptions): Promise<Trajectory> {
  const res = (await page.evaluate(
    (opts) => (window as unknown as { __e2eWalker: { walk(o: unknown): Promise<unknown> } }).__e2eWalker.walk(opts),
    {
      maxPages: o.maxPages,
      roundTripEvery: o.roundTripEvery,
      skipInitialDisplay: o.skipInitialDisplay,
    },
  )) as WalkResult;
  return {
    bookId: o.bookId,
    settingsId: o.settingsId,
    viewport: o.viewport,
    chapters: res.chapters,
    pages: res.pages as PageRecord[],
    roundTrips: res.roundTrips,
    spineLength: res.spineLength,
    stoppedBy: res.stoppedBy,
  };
}

type WalkerApi = {
  advance(n: number, o?: unknown): Promise<PageRecord>;
  readCurrent(): Promise<PageRecord>;
  readAnchor(): Promise<{ chapterIndex: number; offset: number; href: string }>;
};

export function advance(page: Page, n: number, skipInitialDisplay = false): Promise<PageRecord> {
  return page.evaluate(
    ([count, skip]) => (window as unknown as { __e2eWalker: WalkerApi }).__e2eWalker.advance(count as number, { skipInitialDisplay: skip }),
    [n, skipInitialDisplay] as const,
  );
}

export function readCurrent(page: Page): Promise<PageRecord> {
  return page.evaluate(() => (window as unknown as { __e2eWalker: WalkerApi }).__e2eWalker.readCurrent());
}

export function readAnchor(page: Page): Promise<{ chapterIndex: number; offset: number; href: string }> {
  return page.evaluate(() => (window as unknown as { __e2eWalker: WalkerApi }).__e2eWalker.readAnchor());
}
