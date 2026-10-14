// 不变量检查：全部是对 Trajectory 的纯函数，没有浏览器依赖。
// 新增规则的方式：每修一个 bug，就在这里加一条能抓住它的规则，再给它配一条单测。

import type { AnchorProbe, PageRecord, Trajectory, Violation } from "./types.ts";
import { signature } from "./types.ts";

export interface InvariantOptions {
  /** scrollLeft 允许偏离“步长整数倍”的像素误差（非整数视口/DPR 下会产生亚像素漂移） */
  alignTolPx?: number;
  /** 规则 id 白名单：已知问题先挂起，避免一条旧 bug 让整套测试长期红着 */
  skipRules?: string[];
}

const DEFAULTS = { alignTolPx: 1.5 };

function v(rule: string, message: string, p?: PageRecord, chapterIndex?: number): Violation {
  const out: Violation = { rule, message };
  if (p) {
    out.pageSeq = p.seq;
    out.chapterIndex = p.chapterIndex;
  } else if (chapterIndex !== undefined) {
    out.chapterIndex = chapterIndex;
  }
  return out;
}

/** 按章节分组，保持访问顺序 */
function groupByChapter(pages: PageRecord[]): Map<number, PageRecord[]> {
  const m = new Map<number, PageRecord[]>();
  for (const p of pages) {
    const list = m.get(p.chapterIndex);
    if (list) list.push(p);
    else m.set(p.chapterIndex, [p]);
  }
  return m;
}

/** 章节顺序、跳章、卡住 */
export function checkProgress(t: Trajectory): Violation[] {
  const out: Violation[] = [];
  let prev: PageRecord | undefined;
  for (const p of t.pages) {
    if (prev) {
      if (p.chapterIndex < prev.chapterIndex) {
        out.push(v("chapter-order", `章节倒退：${prev.chapterIndex} -> ${p.chapterIndex}`, p));
      }
      if (
        p.chapterIndex === prev.chapterIndex &&
        p.scrollLeft === prev.scrollLeft &&
        signature(p) === signature(prev)
      ) {
        out.push(v("stuck", `连续两页完全相同（scrollLeft=${p.scrollLeft}），next 没有产生任何移动`, p));
      }
    }
    prev = p;
  }
  const seen = new Set(t.pages.map((p) => p.chapterIndex));
  const unseen: number[] = [];
  for (let i = 0; i < t.spineLength; i++) if (!seen.has(i)) unseen.push(i);
  if (t.stoppedBy === "end" && unseen.length) {
    out.push(v("chapter-skipped", `走到书尾但从未访问这些 spine 章节：${unseen.join(",")}`));
  }
  const last = t.pages[t.pages.length - 1];
  if (t.stoppedBy === "noRelocate") {
    out.push(v("walk-aborted", "next 之后没有触发 relocated，走书在书尾之前中断", last));
  }
  if (t.stoppedBy === "stuck") {
    out.push(v("walk-stuck", "next 触发了 relocated 但位置没有变化，且不在书尾（翻页卡住）", last));
  }
  if (t.stoppedBy === "maxPages") {
    out.push(v("walk-runaway", "走书超过页数上限仍未到书尾（分页可能在循环）", last));
  }
  return out;
}

/**
 * 文字完整性：章内相邻页必须首尾相接，整章必须被完整覆盖。
 *  - 有缺口 -> 丢字
 *  - 重叠   -> 重复显示；唯一的豁免是 atMaxScroll 的“贴章末尾页”（尾页补丁的设计行为）
 */
export function checkTextContinuity(t: Trajectory): Violation[] {
  const out: Violation[] = [];
  const byChapter = groupByChapter(t.pages);
  for (const [ci, pages] of byChapter) {
    const meta = t.chapters.find((c) => c.index === ci);
    const textPages = pages.filter((p) => p.textStart >= 0);
    if (!textPages.length) continue;
    const first = textPages[0]!;
    if (first.textStart !== 0) {
      out.push(v("chapter-start", `章节首个有文字的页从偏移 ${first.textStart} 开始，开头 ${first.textStart} 个字没显示过`, first));
    }
    for (let i = 1; i < textPages.length; i++) {
      const a = textPages[i - 1]!;
      const b = textPages[i]!;
      const gap = b.textStart - a.textEnd;
      if (gap > 0) {
        out.push(v("text-lost", `第 ${a.seq}->${b.seq} 页之间丢了 ${gap} 个字（${a.textEnd}..${b.textStart}）`, b));
      } else if (gap < 0 && !b.atMaxScroll) {
        out.push(v("text-duplicated", `第 ${a.seq}->${b.seq} 页重复显示了 ${-gap} 个字（非章末贴边页）`, b));
      }
    }
    const lastPage = textPages[textPages.length - 1]!;
    if (meta && lastPage.textEnd !== meta.textLength) {
      out.push(
        v(
          "chapter-end",
          `章节有 ${meta.textLength} 个字，最后一页只到 ${lastPage.textEnd}，结尾 ${meta.textLength - lastPage.textEnd} 个字没显示过`,
          lastPage,
        ),
      );
    }
  }
  return out;
}

/** 单页内的几何问题：对齐、字被切开、页内空洞、图片跨页 */
export function checkPageGeometry(t: Trajectory, opts: InvariantOptions = {}): Violation[] {
  const tol = opts.alignTolPx ?? DEFAULTS.alignTolPx;
  const out: Violation[] = [];
  for (const p of t.pages) {
    if (!p.atMaxScroll && p.step > 0) {
      const k = Math.round(p.scrollLeft / p.step);
      const drift = Math.abs(p.scrollLeft - k * p.step);
      if (drift > tol) {
        out.push(v("scroll-misaligned", `scrollLeft=${p.scrollLeft} 不是步长 ${p.step} 的整数倍（偏 ${drift.toFixed(2)}px）`, p));
      }
    }
    if (p.cutChars > 0) out.push(v("char-cut", `${p.cutChars} 个字符被页边界切成两半`, p));
    if (p.holes > 0) out.push(v("page-hole", `页内文字范围里有 ${p.holes} 个字符不在可见窗口内（文字顺序/分栏错乱）`, p));
    if (p.straddlingImages > 0) out.push(v("image-straddle", `${p.straddlingImages} 张图片跨在页边界上`, p));
    if (p.textStart < 0 && p.visibleImages === 0) {
      out.push(v("blank-page", "这一页既没有文字也没有图片（空白页）", p));
    }
  }
  for (const c of t.chapters) {
    for (const src of c.imageOverflows) {
      out.push(v("image-overflow", `图片 ${src} 比一页还大，放不进视口`, undefined, c.index));
    }
  }
  return out;
}

/** next/prev 往返：prev 回到上一页，再 next 回到本页 */
export function checkRoundTrip(t: Trajectory): Violation[] {
  const out: Violation[] = [];
  for (const r of t.roundTrips) {
    const page = t.pages.find((p) => p.seq === r.seq);
    if (r.afterPrev !== r.expectedPrev) {
      out.push(v("roundtrip-prev", `第 ${r.seq} 页执行 prev 后到达 ${r.afterPrev}，期望 ${r.expectedPrev}`, page));
    }
    if (r.afterNext !== r.expectedBack) {
      out.push(v("roundtrip-next", `prev 之后再 next，到达 ${r.afterNext}，没有回到第 ${r.seq} 页 ${r.expectedBack}`, page));
    }
  }
  return out;
}

/** 重排锚定：设置变化之后，原来第一条可见文字必须仍在当前页里 */
export function checkAnchorPreserved(probe: AnchorProbe): Violation[] {
  const { before, after, label } = probe;
  const out: Violation[] = [];
  if (after.chapterIndex !== before.chapterIndex) {
    out.push(v("anchor-chapter", `${label}：重排后章节从 ${before.chapterIndex} 变成 ${after.chapterIndex}`, after));
  } else if (!(after.textStart <= before.offset && before.offset < after.textEnd)) {
    out.push(
      v("anchor-lost", `${label}：重排前阅读位置在字符 ${before.offset}，重排后当前页只显示 [${after.textStart}, ${after.textEnd})`, after),
    );
  }
  return out;
}

export function checkAll(t: Trajectory, opts: InvariantOptions = {}): Violation[] {
  const all = [
    ...checkProgress(t),
    ...checkTextContinuity(t),
    ...checkPageGeometry(t, opts),
    ...checkRoundTrip(t),
  ];
  const skip = new Set(opts.skipRules ?? []);
  return all.filter((x) => !skip.has(x.rule));
}

export function formatViolations(vs: Violation[], limit = 20): string {
  if (!vs.length) return "无违规";
  const lines = vs.slice(0, limit).map((x) => {
    const where = [x.chapterIndex !== undefined ? `章${x.chapterIndex}` : "", x.pageSeq !== undefined ? `页#${x.pageSeq}` : ""]
      .filter(Boolean)
      .join(" ");
    return `[${x.rule}] ${where ? where + " " : ""}${x.message}`;
  });
  if (vs.length > limit) lines.push(`…… 还有 ${vs.length - limit} 条`);
  return lines.join("\n");
}
