// 阅读器回归：走书 + 不变量 + 快照 + 重排锚定。
// 本文件是草稿：在真实应用上跑通之前，需要先按 adapter.ts 里的 TODO(adapt) 接好钩子。

import { test, expect } from "@playwright/test";
import { applySettings, openFixture, resizeViewport, TARGET } from "./adapter.ts";
import {
  checkAll,
  checkAnchorPreserved,
  formatViolations,
} from "./invariants.ts";
import { matrix, REFLOW_STEPS, SETTINGS } from "./matrix.ts";
import { summaryJson } from "./summary.ts";
import { advance, installWalker, readAnchor, readCurrent, readFontStatus, walkBook } from "./walk.ts";
import { signature } from "./types.ts";

// 已知问题先在这里挂起（写清楚原因和链接），不要让它们把整套测试长期染红。
// 例：{ "long-chapter": ["roundtrip-prev"] }  // EPUB.js 在尾页补丁后 prev 落到半页，见 issue #xx
const KNOWN: Record<string, string[]> = {};

const M = matrix();

for (const vp of M.viewports) {
  test.describe(`视口 ${vp.id}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr });

    for (const fx of M.fixtures) {
      for (const st of M.settings) {
        test(`走书不变量 ${fx.id} / ${st.id}`, async ({ page }, testInfo) => {
          await installWalker(page);
          await openFixture(page, fx.file);
          await applySettings(page, st);

          if (TARGET !== "mock") {
            const fontStatus = await readFontStatus(page);
            expect(fontStatus.bodyFontFamily).toContain("E2EFont");
            expect(fontStatus.faces).toContainEqual({ family: "E2EFont", status: "loaded" });
          }

          const traj = await walkBook(page, {
            bookId: fx.id,
            settingsId: st.id,
            viewport: vp,
            skipInitialDisplay: false,
          });

          // 失败时最有用的排查材料：整份轨迹 + 当前页截图
          await testInfo.attach("trajectory.json", { body: JSON.stringify(traj, null, 2), contentType: "application/json" });
          await testInfo.attach("last-page.png", { body: await page.screenshot(), contentType: "image/png" });

          const violations = checkAll(traj, { skipRules: KNOWN[fx.id] });
          expect(violations, formatViolations(violations)).toEqual([]);

          // 结构快照：有变化就必须人为确认。更新用 npm run test:e2e:update
          // 按目标分目录：基线（harness）和应用（app）的排版本来就可能不同，不能共用同一份快照
          expect(summaryJson(traj)).toMatchSnapshot([TARGET, `${fx.id}__${vp.id}__${st.id}.json`]);
        });
      }
    }
  });
}

// ---- 重排锚定：设置变化后，原来的阅读位置必须仍在当前页内 ----
// 锚定是 reflow.ts 的职责。纯 EPUB.js 基线没有这层，重排后丢位置是预期行为，默认不跑；
// 想看基线到底丢不丢（做归因），设 E2E_ANCHOR_BASELINE=1。
test.describe("重排锚定", () => {
  test.skip(TARGET === "mock", "模拟页没有可调设置");
  test.skip(TARGET === "harness" && !process.env.E2E_ANCHOR_BASELINE, "基线没有 reflow.ts，见上方说明");
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  for (const fx of M.fixtures) {
    for (const step of REFLOW_STEPS) {
      test(`${fx.id}：${step.label}`, async ({ page }) => {
        await installWalker(page);
        await openFixture(page, fx.file);
        await applySettings(page, SETTINGS[0]!);

        await advance(page, 7); // 走到靠中间的位置，避开书首书尾
        const before = await readAnchor(page);

        await applySettings(page, step.to);
        const after = await readCurrent(page);

        const violations = checkAnchorPreserved({ label: step.label, before, after });
        expect(violations, formatViolations(violations)).toEqual([]);
      });
    }

    test(`${fx.id}：窗口缩放`, async ({ page }) => {
      await installWalker(page);
      await openFixture(page, fx.file);
      await applySettings(page, SETTINGS[0]!);

      await advance(page, 7);
      const before = await readAnchor(page);

      await resizeViewport(page, 1000, 700);
      const after = await readCurrent(page);

      const violations = checkAnchorPreserved({ label: "窗口 1280x800→1000x700", before, after });
      expect(violations, formatViolations(violations)).toEqual([]);
    });
  }
});

// ---- 点击区：左右各 25% ----
// TODO(adapt)：点击发生在 iframe 内，harness 目标下 EPUB.js 没有 25% 点击区，只对 app 目标有意义。
test.describe("点击区", () => {
  test.skip(TARGET !== "app", "仅 app 目标");
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  const cases: { name: string; xRatio: number; dir: "next" | "prev" | "none" }[] = [
    { name: "左 24%", xRatio: 0.24, dir: "prev" },
    { name: "左 26%", xRatio: 0.26, dir: "none" },
    { name: "右 74%", xRatio: 0.74, dir: "none" },
    { name: "右 76%", xRatio: 0.76, dir: "next" },
  ];

  for (const c of cases) {
    test(c.name, async ({ page }) => {
      await installWalker(page);
      await openFixture(page, "long-chapter.epub");
      await applySettings(page, SETTINGS[0]!);
      await advance(page, 3);
      const before = signature(await readCurrent(page));

      await page.mouse.click(1280 * c.xRatio, 400);
      await page.waitForTimeout(400);
      const after = signature(await readCurrent(page));

      if (c.dir === "none") expect(after).toBe(before);
      else expect(after).not.toBe(before);
    });
  }
});
