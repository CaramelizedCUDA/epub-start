// 阅读展示壳只接受文字、页码与回调；EPUB 定位和翻页仍由 EpubReader 管理。
// 工具卡浮在正文上，显隐不占用布局空间；正文的固定视口由父组件管理。
import { bookDisplayTitle } from '../library/bookDisplay';

export type ReaderPanel = 'toc' | 'search' | 'notes' | 'settings';

interface ReaderChromeProps {
  bookTitle: string;
  chapterTitle: string;
  currentPage: number;
  totalPages: number;
  activePanel: ReaderPanel | null;
  visible: boolean;
  isFullscreen: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onPanel: (panel: ReaderPanel) => void;
  onFullscreen: () => void;
  onToggleVisible: () => void;
}

const TOOLS: Array<{ panel: ReaderPanel; label: string }> = [
  { panel: 'toc', label: '目录' },
  { panel: 'search', label: '搜索' },
  { panel: 'notes', label: '批注' },
  { panel: 'settings', label: '设置' },
];

const ICON_BUTTON = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-subtle hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

export function ReaderChrome({
  bookTitle, chapterTitle, currentPage, totalPages, activePanel, visible, isFullscreen,
  onClose, onPrevious, onNext, onPanel, onFullscreen, onToggleVisible,
}: ReaderChromeProps) {
  const display = bookDisplayTitle(bookTitle);
  const hasPages = totalPages > 0 && currentPage > 0;
  const pageLabel = hasPages ? `当前章节第 ${currentPage} 页，共 ${totalPages} 页` : '正在计算章节页码';
  // 这里只掌握章节分页，不冒充全书百分比，也不提供无真实定位能力的拖动滑块。
  const chapterProgress = hasPages ? Math.min(100, currentPage / totalPages * 100) : 0;
  const pageNumber = (
    <span data-reader-page aria-label={pageLabel} aria-live="polite" className="shrink-0 text-xs tabular-nums text-muted">
      {hasPages ? `${currentPage} / ${totalPages}` : '—'}
    </span>
  );

  return (
    <>
      {visible && (
        <header className="absolute left-[calc(1rem+var(--reader-safe-left,env(safe-area-inset-left,0px)))] right-[calc(1rem+var(--reader-safe-right,env(safe-area-inset-right,0px)))] top-[calc(1rem+var(--reader-safe-top,env(safe-area-inset-top,0px)))] z-40 flex h-[68px] items-center gap-1 rounded-[22px] border border-line bg-paper/90 px-1.5 text-ink shadow-lg backdrop-blur-md">
          <button type="button" data-reader-back onClick={onClose} aria-label="返回书架" className={ICON_BUTTON}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m14 5-7 7 7 7M7 12h14" /></svg>
          </button>
          <div className="min-w-0 flex-1 px-1">
            <h1 className="truncate font-reading text-base font-semibold" title={bookTitle}>{display.heading}</h1>
            {(display.subtitle || chapterTitle) && <p className="mt-0.5 truncate text-xs text-muted" title={display.subtitle || chapterTitle}>{display.subtitle || chapterTitle}</p>}
          </div>
          <button type="button" data-reader-tool="fullscreen" onClick={onFullscreen} className={`desktop-fullscreen-control ${ICON_BUTTON} hidden sm:flex`} aria-label={isFullscreen ? '退出全屏' : '全屏'} aria-pressed={isFullscreen}>
            <span aria-hidden="true" className="text-xl leading-none">⛶</span>
          </button>
          <button type="button" onClick={onToggleVisible} aria-label="收起阅读工具" className={ICON_BUTTON}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 15 6-6 6 6" /></svg>
          </button>
        </header>
      )}

      {visible ? (
        <nav data-reader-navigation aria-label="阅读工具" className="reader-navigation absolute bottom-[calc(1rem+var(--reader-safe-bottom,env(safe-area-inset-bottom,0px)))] left-[calc(1rem+var(--reader-safe-left,env(safe-area-inset-left,0px)))] right-[calc(1rem+var(--reader-safe-right,env(safe-area-inset-right,0px)))] z-40 rounded-[22px] border border-line bg-paper/90 px-3 pb-3 pt-3.5 text-ink shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 px-2 text-xs text-muted">
            <span className="min-w-0 truncate" title={chapterTitle}>{chapterTitle}</span>
            {pageNumber}
          </div>
          <div className="flex items-center gap-1" aria-label="章节翻页">
            <button type="button" onClick={onPrevious} className={ICON_BUTTON} aria-label="上一页">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m14 6-6 6 6 6" /></svg>
            </button>
            <span aria-hidden="true" className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-line">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${chapterProgress}%` }} />
            </span>
            <button type="button" onClick={onNext} className={ICON_BUTTON} aria-label="下一页">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m10 6 6 6-6 6" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-4 items-center gap-1">
            {TOOLS.map(({ panel, label }) => (
              <button key={panel} type="button" data-reader-tool={panel} aria-pressed={activePanel === panel} onClick={() => onPanel(panel)} className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${activePanel === panel ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-subtle hover:text-ink'}`}>
                <ToolIcon panel={panel} /><span>{label}</span>
              </button>
            ))}
          </div>
        </nav>
      ) : (
        // 与正文共享真实安全区；44px 命中区完整落在固定留白内，显隐不重排正文。
        <footer className="absolute bottom-[calc(0.25rem+var(--reader-safe-bottom,env(safe-area-inset-bottom,0px)))] left-[calc(2rem+var(--reader-safe-left,env(safe-area-inset-left,0px)))] right-[calc(2rem+var(--reader-safe-right,env(safe-area-inset-right,0px)))] z-40 text-muted">
          <button type="button" data-reader-navigation onClick={onToggleVisible} aria-label="显示阅读工具" title="显示阅读工具" className="flex h-11 w-full items-center justify-between gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            <span className="min-w-0 truncate text-xs" title={chapterTitle}>{chapterTitle || '阅读'}</span>
            {pageNumber}
          </button>
        </footer>
      )}
    </>
  );
}

function ToolIcon({ panel }: { panel: ReaderPanel }) {
  if (panel === 'settings') return <span aria-hidden="true" className="font-reading text-xl leading-5">Aa</span>;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {panel === 'toc' && <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>}
      {panel === 'search' && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>}
      {panel === 'notes' && <><path d="m15 4 5 5M4 20l4-1 12-12a2 2 0 0 0-4-4L4 15v5Z" /><path d="M12 20h8" /></>}
    </svg>
  );
}
