// 高亮与批注引擎：把 EPUB.js 的选区/批注事件适配到 React 状态。
//
// - Rendition 的 `selected` 事件在选区稳定后给出 CFI range 与 Contents；
//   这里把它换算为可保存的 cfi_range + 可独立定位的 cfi_start/cfi_end，
//   并把选区在阅读器视口中的坐标换算给浮动菜单。
// - 高亮标记通过 `rendition.annotations.highlight` 注册；EPUB.js 在每次
//   view 渲染（翻页/滚动加载/重建 Rendition）时通过 render hook 自动重注入，
//   因此重启后只需重新注册一次即可逐章恢复。
// - 点击高亮标记时 EPUB.js 把克隆的 click 事件派发到标记 <g> 元素上，
//   `onMarkClick` 负责换算菜单坐标；真实点击仍会冒泡到正文 document，
//   因此 imageInteractions 用 isPointOnHighlightMark 跳过翻页命中判定。
import { EpubCFI } from 'epubjs';
import type { Content, Rendition } from 'epubjs';
import type { Note, ReadingTheme } from '../../../types/models';

export interface SelectionInfo {
  cfiRange: string;
  cfiStart: string;
  cfiEnd: string;
  selectedText: string;
  point: { x: number; y: number };
}

export interface HighlightMarkClick {
  noteId: string;
  point: { x: number; y: number };
}

export interface HighlightEngineCallbacks {
  onSelect: (selection: SelectionInfo) => void;
  onMarkClick: (click: HighlightMarkClick) => void;
  onSelectionCleared: () => void;
  onDocumentInteraction: () => void;
}

export const HIGHLIGHT_CLASS = 'reader-highlight';
export const HIGHLIGHT_NOTE_ATTR = 'data-note-id';

/** 预设高亮色板；后端接受任意 #RRGGBB。 */
export const NOTE_COLORS = [
  '#ffff00',
  '#90ee90',
  '#87cefa',
  '#ffb6c1',
  '#ffa500',
] as const;

// 最近一次触发 `selected` 的 Contents，用于菜单操作后主动清除 iframe 选区。
let activeContents: Content | null = null;

export function clearActiveSelection(): void {
  activeContents?.window.getSelection()?.removeAllRanges();
  activeContents = null;
}

export function installHighlightEngine(
  rendition: Rendition,
  callbacks: HighlightEngineCallbacks,
): () => void {
  const cleanups = new Map<Document, () => void>();
  let disposed = false;

  const attach = (content: Content) => {
    if (disposed || cleanups.has(content.document)) return;
    const { document, window: contentWindow } = content;
    const onSelectionChange = () => {
      const selection = contentWindow.getSelection();
      if (selection && selection.isCollapsed) {
        callbacks.onSelectionCleared();
      }
    };
    const onPointerDown = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[' + HIGHLIGHT_NOTE_ATTR + ']')) return;
      callbacks.onDocumentInteraction();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerdown', onPointerDown, true);
    cleanups.set(document, () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerdown', onPointerDown, true);
    });
  };

  const attachCurrentViews = () => {
    if (disposed) return;
    for (const content of rendition.getContents()) attach(content);
  };

  const onSelected = (...args: unknown[]) => {
    if (disposed) return;
    const cfiRange = args[0];
    const contents = args[1] as Content | undefined;
    if (typeof cfiRange !== 'string' || !contents) return;
    try {
      const start = new EpubCFI(cfiRange);
      start.collapse(true);
      const end = new EpubCFI(cfiRange);
      end.collapse(false);
      const range = contents.range(cfiRange);
      activeContents = contents;
      callbacks.onSelect({
        cfiRange,
        cfiStart: start.toString(),
        cfiEnd: end.toString(),
        selectedText: range ? range.toString() : '',
        point: selectionPoint(contents),
      });
    } catch (err) {
      console.error('Failed to process text selection:', err);
    }
  };

  const onRendered = (...args: unknown[]) => {
    const view = args[1] as { contents?: Content } | undefined;
    if (view?.contents) attach(view.contents);
  };
  const onRelocated = () => attachCurrentViews();
  rendition.on('selected', onSelected);
  rendition.on('rendered', onRendered);
  rendition.on('relocated', onRelocated);

  // 与 imageInteractions 相同的策略：不依赖 relocated/rendered 时机，
  // 用 MutationObserver 覆盖 spread 右 View 的懒初始化。
  let rafId: number | null = null;
  const debouncedAttach = () => {
    if (disposed) return;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      attachCurrentViews();
      rafId = requestAnimationFrame(() => {
        rafId = null;
        attachCurrentViews();
      });
    });
  };
  const viewport = window.document.getElementById('epub-reader-viewport');
  let observer: MutationObserver | null = null;
  if (viewport) {
    observer = new MutationObserver(debouncedAttach);
    observer.observe(viewport, { childList: true, subtree: true });
  }

  attachCurrentViews();

  return () => {
    disposed = true;
    observer?.disconnect();
    if (rafId !== null) cancelAnimationFrame(rafId);
    rendition.off('selected', onSelected);
    rendition.off('rendered', onRendered);
    rendition.off('relocated', onRelocated);
    for (const cleanup of cleanups.values()) cleanup();
    cleanups.clear();
    activeContents = null;
  };
}

/** 渲染单个批注的高亮标记；重新调用会先移除旧标记，保证颜色/主题更新生效。 */
export function renderHighlight(
  rendition: Rendition,
  note: Note,
  theme: ReadingTheme | null,
  onMarkClick: (click: HighlightMarkClick) => void,
): void {
  if (!note.cfi_range) return;
  rendition.annotations.remove(note.cfi_range, 'highlight');
  rendition.annotations.highlight(
    note.cfi_range,
    { note_id: note.id },
    (event) => {
      onMarkClick({ noteId: note.id, point: markPointFromEvent(event) });
    },
    HIGHLIGHT_CLASS,
    highlightStyles(theme, note.color),
  );
}

export function removeHighlight(rendition: Rendition, cfiRange: string): void {
  rendition.annotations.remove(cfiRange, 'highlight');
}

/** 判断 iframe 内某视口坐标是否落在高亮标记上（供翻页命中判定避让）。 */
export function isPointOnHighlightMark(
  document: Document,
  x: number,
  y: number,
): boolean {
  const marks = Array.from(document.querySelectorAll('[' + HIGHLIGHT_NOTE_ATTR + ']'));
  for (const mark of marks) {
    for (const rect of Array.from(mark.querySelectorAll('rect'))) {
      const bounds = rect.getBoundingClientRect();
      if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
        return true;
      }
    }
  }
  return false;
}

function highlightStyles(theme: ReadingTheme | null, color: string): object {
  if (theme === 'dark') {
    return { fill: color, 'fill-opacity': '0.3', 'mix-blend-mode': 'screen' };
  }
  return { fill: color, 'fill-opacity': '0.35', 'mix-blend-mode': 'multiply' };
}

function selectionPoint(contents: Content): { x: number; y: number } {
  const frameRect = frameOffset(contents);
  const selection = contents.window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const rects = range ? range.getClientRects() : null;
  const last = rects && rects.length > 0 ? rects[rects.length - 1] : null;
  if (last) {
    return {
      x: frameRect.left + last.left,
      y: frameRect.top + last.bottom + 6,
    };
  }
  return { x: frameRect.left, y: frameRect.top };
}

function markPointFromEvent(event: unknown): { x: number; y: number } {
  const target = (event as Event)?.target as Element | null;
  if (target) {
    const bounds = target.getBoundingClientRect();
    const frame = frameOffsetFromElement(target);
    if (bounds.width > 0 || bounds.height > 0) {
      return {
        x: frame.left + bounds.left + bounds.width / 2,
        y: frame.top + bounds.bottom + 6,
      };
    }
  }
  const mouse = event as MouseEvent | null;
  return { x: mouse?.clientX ?? 0, y: (mouse?.clientY ?? 0) + 6 };
}

function frameOffsetFromElement(element: Element): { left: number; top: number } {
  const win = element.ownerDocument?.defaultView;
  const frame = win?.frameElement as HTMLElement | null;
  const rect = frame?.getBoundingClientRect();
  return { left: rect?.left ?? 0, top: rect?.top ?? 0 };
}

function frameOffset(contents: Content): { left: number; top: number } {
  const frame = contents.window.frameElement as HTMLElement | null;
  const rect = frame?.getBoundingClientRect();
  return { left: rect?.left ?? 0, top: rect?.top ?? 0 };
}
