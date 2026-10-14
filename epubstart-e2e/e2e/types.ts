// 走书轨迹的数据结构。所有不变量检查、快照摘要都只依赖这里的类型，
// 不依赖浏览器、EPUB.js 或 Playwright，所以可以在纯 Node 里单测。
//
// 文本偏移约定（重要）：
//   textStart / textEnd / textLength 都是“章节内第 N 个可见非空白字符”的下标，
//   即只数“有渲染矩形的非空白字符”。这样源码里的缩进、换行、隐藏节点不会造成伪差异。
//   页面范围是半开区间 [textStart, textEnd)；该页没有文字（纯图页）时两者为 -1。

export interface ViewportCase {
  id: string;
  width: number;
  height: number;
  dpr: number;
}

export interface SettingsCase {
  id: string;
  fontSizePx: number;
  spread: "single" | "double";
}

export interface ChapterMeta {
  index: number; // spine 下标
  href: string;
  textLength: number; // 可见非空白字符总数
  imageOverflows: string[]; // 比视口还宽或还高、无法放进一页的图片（src）
}

export interface PageRecord {
  seq: number; // 走书过程中的访问顺序，从 0 开始
  chapterIndex: number;
  href: string;
  cfi: string;
  scrollLeft: number;
  scrollWidth: number;
  viewWidth: number; // 可见窗口宽度（单页=一页，双页=两页）
  step: number; // 一次翻页的滚动步长（EPUB.js 的 layout.delta）
  atMaxScroll: boolean; // 已经滚到本章最右端（尾页补丁产生的“贴章末”页就是这种）
  textStart: number;
  textEnd: number;
  first: string; // 本页前几个字符，仅用于快照可读性
  last: string;
  cutChars: number; // 被页边界切成两半的字符数（应为 0）
  holes: number; // [textStart,textEnd) 内不在本页可见窗口里的字符数（应为 0）
  straddlingImages: number; // 跨在本页边界上的图片数（应为 0）
  visibleImages: number; // 本页可见的图片数（用来区分“纯图页”和“空白页”）
}

export interface RoundTrip {
  seq: number; // 在第 seq 页做探测
  expectedPrev: string; // 前一页的签名 chapter:start:end
  afterPrev: string; // 执行 prev 之后实际到达页的签名
  expectedBack: string; // 本页的签名
  afterNext: string; // 再执行 next 之后实际到达页的签名
}

export interface Trajectory {
  bookId: string;
  settingsId: string;
  viewport: { width: number; height: number; dpr: number };
  chapters: ChapterMeta[];
  pages: PageRecord[];
  roundTrips: RoundTrip[];
  spineLength: number;
  stoppedBy: "end" | "maxPages" | "noRelocate" | "stuck";
}

export interface Violation {
  rule: string;
  message: string;
  pageSeq?: number;
  chapterIndex?: number;
}

export interface AnchorProbe {
  label: string;
  before: { chapterIndex: number; offset: number };
  after: PageRecord;
}

export function signature(p: Pick<PageRecord, "chapterIndex" | "textStart" | "textEnd">): string {
  return `${p.chapterIndex}:${p.textStart}:${p.textEnd}`;
}
