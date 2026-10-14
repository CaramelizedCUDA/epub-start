// 快照摘要：把轨迹压成“人能读、diff 能看懂”的 JSON。
// 只放决定“排版结果”的字段（页数、每页文字范围、首尾字符）。
// scrollLeft/cfi 这类易受亚像素影响或不稳定的值不进快照。

import type { Trajectory } from "./types.ts";

export interface BookSummary {
  book: string;
  settings: string;
  viewport: string;
  totalPages: number;
  chapters: {
    index: number;
    href: string;
    textLength: number;
    pageCount: number;
    /** [textStart, textEnd, first, last, tail?]，tail=1 表示贴章末的尾页 */
    pages: (string | number)[][];
  }[];
}

export function summarize(t: Trajectory): BookSummary {
  const chapters = [...t.chapters]
    .sort((a, b) => a.index - b.index)
    .map((c) => {
      const pages = t.pages.filter((p) => p.chapterIndex === c.index);
      return {
        index: c.index,
        href: c.href,
        textLength: c.textLength,
        pageCount: pages.length,
        pages: pages.map((p) => {
          const row: (string | number)[] = [p.textStart, p.textEnd, p.first, p.last];
          if (p.atMaxScroll) row.push(1);
          return row;
        }),
      };
    });
  return {
    book: t.bookId,
    settings: t.settingsId,
    viewport: `${t.viewport.width}x${t.viewport.height}@${t.viewport.dpr}`,
    totalPages: t.pages.length,
    chapters,
  };
}

export function summaryJson(t: Trajectory): string {
  return JSON.stringify(summarize(t), null, 2) + "\n";
}
