// 不变量规则的单测：全部是纯函数，不需要浏览器。
//   node --test tests/        （Node >= 22.18，直接跑 .ts）
//
// 约定：每条规则至少有一个“该报”和一个“不该报”的用例。
// 以后每修一个 bug、加一条规则，就在这里补一对用例。

import test from "node:test";
import assert from "node:assert/strict";
import {
  checkAll,
  checkAnchorPreserved,
  checkPageGeometry,
  checkProgress,
  checkRoundTrip,
  checkTextContinuity,
} from "../e2e/invariants.ts";
import { summarize } from "../e2e/summary.ts";
import type { ChapterMeta, PageRecord, Trajectory } from "../e2e/types.ts";

// ---- 构造测试数据 ----

function page(seq: number, chapterIndex: number, textStart: number, textEnd: number, o: Partial<PageRecord> = {}): PageRecord {
  return {
    seq,
    chapterIndex,
    href: `ch${chapterIndex}.xhtml`,
    cfi: `cfi-${seq}`,
    scrollLeft: seq * 600,
    scrollWidth: 6000,
    viewWidth: 600,
    step: 600,
    atMaxScroll: false,
    textStart,
    textEnd,
    first: "ab",
    last: "yz",
    cutChars: 0,
    holes: 0,
    straddlingImages: 0,
    visibleImages: 0,
    ...o,
  };
}

function traj(pages: PageRecord[], o: Partial<Trajectory> = {}): Trajectory {
  const chapterIdx = [...new Set(pages.map((p) => p.chapterIndex))];
  const chapters: ChapterMeta[] = chapterIdx.map((index) => ({
    index,
    href: `ch${index}.xhtml`,
    textLength: Math.max(...pages.filter((p) => p.chapterIndex === index).map((p) => p.textEnd)),
    imageOverflows: [],
  }));
  return {
    bookId: "b",
    settingsId: "s",
    viewport: { width: 600, height: 400, dpr: 1 },
    chapters,
    pages,
    roundTrips: [],
    spineLength: chapterIdx.length,
    stoppedBy: "end",
    ...o,
  };
}

const rules = (vs: { rule: string }[]) => vs.map((v) => v.rule).sort();

/** 一本健康的两章书：章0 三页，章1 两页 */
function healthy(): Trajectory {
  return traj([
    page(0, 0, 0, 100),
    page(1, 0, 100, 200),
    page(2, 0, 200, 250, { atMaxScroll: true, scrollLeft: 1234 }),
    page(3, 1, 0, 80),
    page(4, 1, 80, 120, { atMaxScroll: true, scrollLeft: 777 }),
  ]);
}

// ---- 健康轨迹 ----

test("健康的轨迹：零违规", () => {
  assert.deepEqual(checkAll(healthy()), []);
});

// ---- checkProgress ----

test("章节倒退", () => {
  const t = healthy();
  t.pages[3] = page(3, 0, 0, 80); // 回到章 0
  t.pages[2] = page(2, 1, 200, 250);
  assert.ok(rules(checkProgress(t)).includes("chapter-order"));
});

test("连续两页完全相同 -> stuck", () => {
  const t = healthy();
  t.pages[1] = { ...t.pages[0]!, seq: 1 };
  assert.ok(rules(checkProgress(t)).includes("stuck"));
});

test("书尾前中断：chapter-skipped / walk-aborted / walk-stuck / walk-runaway", () => {
  const t = healthy();
  t.spineLength = 3;
  assert.ok(rules(checkProgress(t)).includes("chapter-skipped"));

  assert.ok(rules(checkProgress({ ...healthy(), stoppedBy: "noRelocate" })).includes("walk-aborted"));
  assert.ok(rules(checkProgress({ ...healthy(), stoppedBy: "stuck" })).includes("walk-stuck"));
  assert.ok(rules(checkProgress({ ...healthy(), stoppedBy: "maxPages" })).includes("walk-runaway"));
});

test("没走到书尾时不报 chapter-skipped（避免连锁噪声）", () => {
  const t = healthy();
  t.spineLength = 3;
  t.stoppedBy = "stuck";
  assert.ok(!rules(checkProgress(t)).includes("chapter-skipped"));
});

// ---- checkTextContinuity ----

test("页间缺口 -> text-lost", () => {
  const t = healthy();
  t.pages[1] = page(1, 0, 120, 200); // 100..120 没显示过
  const vs = checkTextContinuity(t);
  assert.deepEqual(rules(vs), ["text-lost"]);
  assert.match(vs[0]!.message, /20 个字/);
});

test("页间重叠 -> text-duplicated，但章末贴边页（尾页补丁）豁免", () => {
  const dup = healthy();
  dup.pages[1] = page(1, 0, 90, 200);
  assert.deepEqual(rules(checkTextContinuity(dup)), ["text-duplicated"]);

  const tail = healthy();
  tail.pages[2] = page(2, 0, 180, 250, { atMaxScroll: true }); // 与上一页重叠 20 字，但是贴章末页
  assert.deepEqual(checkTextContinuity(tail), []);
});

test("章首没从 0 开始 / 章尾没到末尾", () => {
  const head = healthy();
  head.pages[0] = page(0, 0, 10, 100);
  assert.ok(rules(checkTextContinuity(head)).includes("chapter-start"));

  const end = healthy();
  end.chapters[0]!.textLength = 300; // 章有 300 字，最后一页只到 250
  assert.deepEqual(rules(checkTextContinuity(end)), ["chapter-end"]);
});

test("纯图页（textStart=-1）不参与文字连续性", () => {
  const t = traj([
    page(0, 0, 0, 100),
    page(1, 0, -1, -1, { visibleImages: 1 }),
    page(2, 0, 100, 150, { atMaxScroll: true }),
  ]);
  assert.deepEqual(checkTextContinuity(t), []);
});

// ---- checkPageGeometry ----

test("scrollLeft 不是步长整数倍：超出容差才报，亚像素漂移放行", () => {
  const drift = healthy();
  drift.pages[1] = page(1, 0, 100, 200, { scrollLeft: 600.9 });
  assert.deepEqual(checkPageGeometry(drift), []);

  const bad = healthy();
  bad.pages[1] = page(1, 0, 100, 200, { scrollLeft: 640 });
  assert.deepEqual(rules(checkPageGeometry(bad)), ["scroll-misaligned"]);
});

test("贴章末的页（atMaxScroll）不要求对齐步长", () => {
  assert.deepEqual(checkPageGeometry(healthy()), []);
});

test("字符被切开 / 页内空洞 / 图片跨页 / 空白页 / 图片放不进视口", () => {
  const t = healthy();
  t.pages[0] = page(0, 0, 0, 100, { cutChars: 2 });
  t.pages[1] = page(1, 0, 100, 200, { holes: 5 });
  t.pages[3] = page(3, 1, 0, 80, { straddlingImages: 1 });
  t.pages.push(page(5, 1, -1, -1)); // 没文字也没图
  t.chapters[0]!.imageOverflows = ["big.png"];
  assert.deepEqual(rules(checkPageGeometry(t)), ["blank-page", "char-cut", "image-overflow", "image-straddle", "page-hole"]);
});

// ---- checkRoundTrip ----

test("往返：prev 没回到上一页 / 再 next 没回到本页", () => {
  const ok = healthy();
  ok.roundTrips = [{ seq: 1, expectedPrev: "0:0:100", afterPrev: "0:0:100", expectedBack: "0:100:200", afterNext: "0:100:200" }];
  assert.deepEqual(checkRoundTrip(ok), []);

  const bad = healthy();
  bad.roundTrips = [{ seq: 2, expectedPrev: "0:100:200", afterPrev: "0:150:250", expectedBack: "0:200:250", afterNext: "1:0:80" }];
  assert.deepEqual(rules(checkRoundTrip(bad)), ["roundtrip-next", "roundtrip-prev"]);
});

// ---- checkAnchorPreserved ----

test("重排锚定：原位置仍在当前页内才算通过（半开区间）", () => {
  const after = page(9, 2, 400, 520);
  assert.deepEqual(checkAnchorPreserved({ label: "字号", before: { chapterIndex: 2, offset: 400 }, after }), []);
  assert.deepEqual(checkAnchorPreserved({ label: "字号", before: { chapterIndex: 2, offset: 519 }, after }), []);
  assert.deepEqual(
    rules(checkAnchorPreserved({ label: "字号", before: { chapterIndex: 2, offset: 520 }, after })),
    ["anchor-lost"],
  );
  assert.deepEqual(
    rules(checkAnchorPreserved({ label: "字号", before: { chapterIndex: 1, offset: 450 }, after })),
    ["anchor-chapter"],
  );
});

// ---- checkAll / summarize ----

test("skipRules 可以挂起已知问题，但只挂起指定规则", () => {
  const t = healthy();
  t.pages[1] = page(1, 0, 120, 200, { cutChars: 1 });
  assert.deepEqual(rules(checkAll(t)), ["char-cut", "text-lost"]);
  assert.deepEqual(rules(checkAll(t, { skipRules: ["text-lost"] })), ["char-cut"]);
});

test("快照摘要：只含排版结果，贴章末页带标记，不含 scrollLeft/cfi", () => {
  const s = summarize(healthy());
  assert.equal(s.totalPages, 5);
  assert.equal(s.chapters[0]!.pageCount, 3);
  assert.deepEqual(s.chapters[0]!.pages[2], [200, 250, "ab", "yz", 1]);
  assert.deepEqual(s.chapters[0]!.pages[0], [0, 100, "ab", "yz"]);
  const json = JSON.stringify(s);
  assert.ok(!json.includes("scrollLeft") && !json.includes("cfi"));
});
