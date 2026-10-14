// 测试矩阵：书 × 视口 × 设置。日常跑 smoke，夜间/发布前跑 full（E2E_MATRIX=full）。

import type { SettingsCase, ViewportCase } from "./types.ts";

export interface FixtureCase {
  id: string; // 必须和 scripts/make-fixtures.mjs 里的 id 一致
  file: string; // 相对 fixtures/ 目录
}

export const FIXTURES: FixtureCase[] = [
  { id: "long-chapter", file: "long-chapter.epub" },
  { id: "short-chapters", file: "short-chapters.epub" },
  { id: "chapter-top-image", file: "chapter-top-image.epub" },
  { id: "cjk-mixed", file: "cjk-mixed.epub" },
];

export const VIEWPORTS: ViewportCase[] = [
  { id: "desktop-1280x800@1", width: 1280, height: 800, dpr: 1 },
  // 非整数视口宽度 + 非整数 DPR：EPUB.js 多列最容易发生亚像素漂移的组合
  { id: "odd-1137x713@1.25", width: 1137, height: 713, dpr: 1.25 },
  { id: "phone-390x844@3", width: 390, height: 844, dpr: 3 },
  { id: "tablet-820x1180@2", width: 820, height: 1180, dpr: 2 },
];

export const SETTINGS: SettingsCase[] = [
  { id: "f16-single", fontSizePx: 16, spread: "single" },
  { id: "f22-single", fontSizePx: 22, spread: "single" },
  { id: "f16-double", fontSizePx: 16, spread: "double" },
];

/** 重排锚定测试用的“设置变化”序列 */
export const REFLOW_STEPS: { label: string; to: SettingsCase }[] = [
  { label: "字号 16→22", to: { id: "f22-single", fontSizePx: 22, spread: "single" } },
  { label: "单页→双页", to: { id: "f16-double", fontSizePx: 16, spread: "double" } },
];

export function matrix() {
  const full = process.env.E2E_MATRIX === "full";
  return {
    full,
    fixtures: FIXTURES,
    viewports: full ? VIEWPORTS : VIEWPORTS.filter((x) => x.id.startsWith("desktop") || x.id.startsWith("odd")),
    settings: full ? SETTINGS : SETTINGS.slice(0, 1),
  };
}
