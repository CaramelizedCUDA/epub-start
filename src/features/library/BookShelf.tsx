import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useLibraryStore } from '../../stores/libraryStore';
import { getGlobalReadingSettings, saveGlobalReadingSettings } from '../../lib/tauri';
import type { BookSummary, ReadingOverviewPeriod, ReadingSettings } from '../../types/models';
import { B2CloseoutPanel } from '../closeout/B2CloseoutPanel';
import { B3PrivateDataPanel } from '../closeout/B3PrivateDataPanel';
import { FootprintPage, LibraryInsights } from './ReadingInsights';

export type LibrarySection = 'library' | 'series' | 'search' | 'notes' | 'footprint' | 'settings';

interface BookShelfProps {
  activeSection: LibrarySection;
  onSectionChange: (section: LibrarySection) => void;
  onOpenBook: (book: BookSummary) => void;
  readerError: string | null;
  onDismissReaderError: () => void;
}

const NAV_ITEMS: Array<{ section: LibrarySection; label: string; glyph: string }> = [
  { section: 'library', label: '藏书', glyph: '⌂' },
  { section: 'footprint', label: '足迹', glyph: '▦' },
  { section: 'settings', label: '设置', glyph: 'settings' },
];

const READING_PERIOD_OPTIONS: Array<[string, string]> = [
  ['day', '日'],
  ['week', '周'],
  ['month', '月'],
  ['quarter', '季度'],
];
const READING_PERIOD_VALUES: ReadingOverviewPeriod[] = ['day', 'week', 'month', 'quarter'];
const READING_PERIOD_STORAGE_KEY = 'epubstart.library.reading-period';
const RECOMMENDATIONS_STORAGE_KEY = 'epubstart.library.recommendations-enabled';

const SECTION_META: Record<LibrarySection, { eyebrow: string; title: string; subtitle: string }> = {
  library: {
    eyebrow: 'PERSONAL READING ARCHIVE',
    title: '今天想读哪一本？',
    subtitle: '先看看你在读什么，再决定下一页。',
  },
  series: {
    eyebrow: 'COLLECTION RELATIONSHIPS',
    title: '系列还在整理中。',
    subtitle: '先把位置留好，系列管理将在后续功能阶段接入。',
  },
  search: {
    eyebrow: 'SEARCH THE ARCHIVE',
    title: '搜索还没打开。',
    subtitle: '搜索入口已放在这里，真实查询将在后续功能阶段接入。',
  },
  notes: {
    eyebrow: 'MARGINALIA',
    title: '批注还没打开。',
    subtitle: '先保留阅读边栏的位置，批注消费将在 Reader 完成后接入。',
  },
  footprint: {
    eyebrow: 'READING HISTORY',
    title: '这一年留下的痕迹。',
    subtitle: '不评价读了多少，只把走过的日子留在这里。',
  },
  settings: {
    eyebrow: 'SHELF PREFERENCES',
    title: '把书架调成你的样子。',
    subtitle: '阅读时长的观察方式和推荐阅读，都可以在这里安静地调整。',
  },
};

function readReadingPeriodPreference(): ReadingOverviewPeriod {
  const stored = readLocalPreference(READING_PERIOD_STORAGE_KEY);
  return stored && READING_PERIOD_VALUES.includes(stored as ReadingOverviewPeriod)
    ? stored as ReadingOverviewPeriod
    : 'week';
}

function readRecommendationsPreference(): boolean {
  const stored = readLocalPreference(RECOMMENDATIONS_STORAGE_KEY);
  return stored === null ? true : stored === 'true';
}

function readLocalPreference(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalPreference(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A restricted WebView may disable storage; the setting remains usable in-memory.
  }
}

export function BookShelf({
  activeSection,
  onSectionChange,
  onOpenBook,
  readerError,
  onDismissReaderError,
}: BookShelfProps) {
  const {
    books,
    isLoading,
    error,
    loadBooks,
    importFromDialog,
    relocateSource,
    removeBook,
    clearError,
  } = useLibraryStore();
  const [settings, setSettings] = useState<ReadingSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [readingPeriod, setReadingPeriod] = useState<ReadingOverviewPeriod>(readReadingPeriodPreference);
  const [recommendationsEnabled, setRecommendationsEnabled] = useState(readRecommendationsPreference);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    if (activeSection !== 'settings' || settings) return;
    let disposed = false;
    setSettingsError(null);
    void getGlobalReadingSettings()
      .then((value) => { if (!disposed) setSettings(value); })
      .catch((err: unknown) => { if (!disposed) setSettingsError(err instanceof Error ? err.message : String(err)); });
    return () => { disposed = true; };
  }, [activeSection, settings]);

  useEffect(() => {
    writeLocalPreference(READING_PERIOD_STORAGE_KEY, readingPeriod);
  }, [readingPeriod]);

  useEffect(() => {
    writeLocalPreference(RECOMMENDATIONS_STORAGE_KEY, String(recommendationsEnabled));
  }, [recommendationsEnabled]);

  useEffect(() => {
    let disposed = false;
    const appWindow = getCurrentWindow();
    void appWindow.isFullscreen()
      .then((value) => { if (!disposed) setIsFullscreen(value); })
      .catch(() => undefined);
    let unlisten: (() => void) | undefined;
    void appWindow.onResized(() => {
      void appWindow.isFullscreen()
        .then((value) => { if (!disposed) setIsFullscreen(value); })
        .catch(() => undefined);
    }).then((cleanup) => { unlisten = cleanup; }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, [activeSection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const appWindow = getCurrentWindow();
      void appWindow.isFullscreen().then(async (fullscreen) => {
        if (!fullscreen) return;
        await appWindow.setFullscreen(false);
        setIsFullscreen(false);
      }).catch((err: unknown) => {
        setFullscreenError(err instanceof Error ? err.message : String(err));
      });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSection]);

  const persistSettings = async () => {
    if (!settings) return;
    setIsSavingSettings(true);
    setSettingsError(null);
    try {
      const { updated_at: _updatedAt, ...input } = settings;
      setSettings(await saveGlobalReadingSettings(input));
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingSettings(false);
    }
  };

  const toggleFullscreen = async () => {
    setFullscreenError(null);
    try {
      const appWindow = getCurrentWindow();
      const next = !(await appWindow.isFullscreen());
      await appWindow.setFullscreen(next);
      setIsFullscreen(next);
    } catch (err) {
      setFullscreenError(err instanceof Error ? err.message : String(err));
    }
  };

  const changeSection = (section: LibrarySection) => {
    onSectionChange(section);
  };

  return (
    <div className="min-h-screen bg-[#edf1ee] text-[#18272c]">
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="mobile-app-nav fixed inset-x-0 bottom-0 z-40 flex h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0 items-start border-t border-[#d0d9d4] bg-[#f9fbf7]/95 px-2 pb-[env(safe-area-inset-bottom)] md:sticky md:inset-auto md:top-0 md:h-screen md:w-[88px] md:flex-col md:items-center md:justify-start md:border-r md:border-t-0 md:px-0 md:pb-0" aria-label="主导航">
          <div className="hidden items-center gap-3 md:flex md:flex-col md:gap-2">
            <div className="grid h-9 w-9 place-items-center border border-[#18272c] font-serif text-xl text-[#5c7397] md:mt-6 md:h-10 md:w-10">E</div>
            <span className="hidden font-mono text-[0.55rem] leading-tight tracking-[0.18em] text-[#687571] md:block md:text-center">EPUB<br />START</span>
          </div>
          <nav className="mobile-nav-list flex h-16 w-full items-stretch justify-around gap-1 md:mt-12 md:grid md:h-auto md:w-full md:gap-3" aria-label="版块">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.section}
                type="button"
                aria-current={activeSection === item.section ? 'page' : undefined}
                onClick={() => changeSection(item.section)}
                className={`mobile-nav-item relative grid min-w-[3.5rem] flex-1 place-content-center gap-1 px-2 py-1 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c5a76b] md:min-w-0 md:py-2 ${activeSection === item.section ? 'text-[#2e6e67]' : 'text-[#687571] hover:text-[#2e6e67]'}`}
              >
                {activeSection === item.section && <span className="mobile-nav-active absolute left-2 right-2 top-0 h-[3px] bg-[#2e6e67] md:bottom-0 md:left-0 md:right-auto md:h-auto md:w-[3px]" aria-hidden="true" />}
                {item.section === 'settings' ? <SettingsGlyph /> : <span className="text-lg leading-none" aria-hidden="true">{item.glyph}</span>}
                <span className="text-[0.65rem]">{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="hidden text-center font-mono text-[0.58rem] leading-relaxed tracking-[0.12em] text-[#687571] md:mt-auto md:mb-6 md:block">A+C<br />READING SPACE</div>
        </aside>

        <main className="mobile-main-content relative flex min-w-0 flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
          <header className="border-b border-[#d0d9d4] px-5 py-3 sm:px-8 lg:px-16" aria-label="书架快捷入口">
            <div className="mx-auto flex max-w-[1500px] justify-end gap-2">
              <button type="button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? '退出全屏' : '全屏'} title={isFullscreen ? '退出全屏' : '全屏'} aria-pressed={isFullscreen} className="desktop-fullscreen-control grid h-10 w-10 place-items-center border border-[#d0d9d4] text-lg leading-none text-[#687571] transition hover:border-[#2e6e67] hover:bg-[#f9fbf7] hover:text-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">⛶</button>
              {activeSection === 'library' && (
                <button type="button" onClick={() => void importFromDialog()} disabled={isLoading} aria-label="导入 EPUB" title="导入 EPUB" className="grid h-10 w-10 place-items-center border border-[#d0d9d4] text-2xl leading-none text-[#18272c] transition hover:border-[#2e6e67] hover:bg-[#f9fbf7] hover:text-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:cursor-not-allowed disabled:opacity-50">+</button>
              )}
            </div>
          </header>
          {fullscreenError && <div className="desktop-fullscreen-error mx-auto w-full max-w-[1500px] px-5 pt-3 text-right text-xs text-[#a54b45] sm:px-8 lg:px-16" role="alert">全屏切换失败：{fullscreenError}</div>}

          <div className="mx-auto w-full max-w-[1500px] flex-1 px-5 pb-12 sm:px-8 lg:px-16">
            {import.meta.env.VITE_B2_CLOSEOUT === '1' && <B2CloseoutPanel />}
            {import.meta.env.VITE_B3_DIAGNOSTICS === '1' && <B3PrivateDataPanel />}

            {readerError && <ErrorNotice title="无法打开这本书" message={readerError} onDismiss={onDismissReaderError} />}
            {error && <ErrorNotice title="书架暂时没有更新" message={error} onDismiss={clearError} onRetry={() => void loadBooks()} />}

            {activeSection === 'library' && (
              <>
                <div className="pt-8 lg:pt-10">
                  <LibraryInsights onOpenBook={onOpenBook} period={readingPeriod} recommendationsEnabled={recommendationsEnabled} />
                </div>
                <BookCollection
                  books={books}
                  isLoading={isLoading}
                  onImport={() => void importFromDialog()}
                  onOpenBook={onOpenBook}
                  onOpenSection={changeSection}
                  onRelocate={(bookId) => void relocateSource(bookId)}
                  onDelete={(bookId) => void removeBook(bookId)}
                />
              </>
            )}
            {activeSection === 'footprint' && <div className="pt-8 lg:pt-10"><FootprintPage /></div>}
            {activeSection === 'settings' && (
              <SettingsPanel
                embedded
                readingPeriod={readingPeriod}
                onReadingPeriodChange={setReadingPeriod}
                recommendationsEnabled={recommendationsEnabled}
                onRecommendationsEnabledChange={setRecommendationsEnabled}
                settings={settings}
                error={settingsError}
                isSaving={isSavingSettings}
                onClose={() => changeSection('library')}
                onChange={setSettings}
                onSave={() => void persistSettings()}
              />
            )}
            {(activeSection === 'series' || activeSection === 'search' || activeSection === 'notes') && <PlaceholderPage section={activeSection} />}

            <footer className="mt-12 flex flex-col gap-2 border-t border-[#d0d9d4] pt-4 font-mono text-[0.62rem] tracking-[0.08em] text-[#687571] sm:flex-row sm:items-center sm:justify-between">
              <span>EpubStart · PERSONAL READING ARCHIVE</span>
              <span>F1 · 壳层与信息架构</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function BookCollection({
  books,
  isLoading,
  onImport,
  onOpenBook,
  onOpenSection,
  onRelocate,
  onDelete,
}: {
  books: BookSummary[];
  isLoading: boolean;
  onImport: () => void;
  onOpenBook: (book: BookSummary) => void;
  onOpenSection: (section: LibrarySection) => void;
  onRelocate: (bookId: string) => void;
  onDelete: (bookId: string) => void;
}) {
  return (
    <section className="mt-14 border-t-[3px] border-[#2e6e67] pt-5" aria-labelledby="all-books-title" aria-busy={isLoading}>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d0d9d4] pb-4">
        <div>
          <p className="mb-1 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[#2e6e67]">收藏现场</p>
          <h2 id="all-books-title" className="font-serif text-3xl font-medium tracking-[-0.04em]">全部藏书</h2>
        </div>
        <span className="font-mono text-2xl text-[#5c7397]">{String(books.length).padStart(2, '0')}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d0d9d4] py-3" aria-label="书架工具">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[#687571]">书架工具</span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {([
            ['series', '系列'],
            ['search', '搜索'],
            ['notes', '批注'],
          ] as const).map(([section, label]) => (
            <button key={section} type="button" onClick={() => onOpenSection(section)} className="border-b border-transparent py-1 text-[#2e6e67] transition hover:border-[#2e6e67] hover:text-[#18272c] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">
              {label} <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      </div>

      {isLoading && books.length === 0 ? (
        <ShelfSkeleton />
      ) : books.length === 0 ? (
        <EmptyShelf onImport={onImport} />
      ) : (
        <div className={`library-book-grid grid gap-x-4 gap-y-10 pt-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 ${isLoading ? 'opacity-60' : ''}`}>
          {books.map((book) => (
            <ShelfBookCard
              key={book.id}
              book={book}
              disabled={isLoading}
              onOpen={() => onOpenBook(book)}
              onRelocate={() => onRelocate(book.id)}
              onDelete={() => onDelete(book.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ShelfBookCard({
  book,
  disabled,
  onOpen,
  onRelocate,
  onDelete,
}: {
  book: BookSummary;
  disabled: boolean;
  onOpen: () => void;
  onRelocate: () => void;
  onDelete: () => void;
}) {
  const canRelocate = book.status === 'missing';
  const canOpen = book.status !== 'error';
  return (
    <article className="library-book-card group min-w-0 border-t-[3px] border-[#2e6e67] bg-[#f9fbf7] p-3 shadow-[0_14px_28px_rgba(24,39,44,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_rgba(24,39,44,0.1)]">
      <button type="button" onClick={onOpen} disabled={disabled || !canOpen} className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:cursor-not-allowed disabled:opacity-60">
        <ShelfCover book={book} />
        <div className="pt-3">
          <h3 className="library-book-card-title truncate font-serif text-lg font-medium text-[#18272c]" title={book.title}>{book.title}</h3>
          <p className="library-book-card-author mt-1 truncate text-xs text-[#687571]">{book.authors.length > 0 ? book.authors.join(' · ') : '作者信息未提供'}</p>
          {book.status === 'error' && <span className="mt-3 inline-block border-b border-[#a54b45] pb-1 text-xs text-[#a54b45]">解析失败</span>}
          {book.status === 'missing' && <span className="mt-3 inline-block border-b border-[#c5a76b] pb-1 text-xs text-[#8b7137]">文件缺失</span>}
        </div>
      </button>
      <div className="library-book-card-actions mt-4 flex min-h-6 items-center justify-between gap-2 text-xs">
        {canRelocate ? <button type="button" onClick={onRelocate} disabled={disabled} className="border-b border-[#c5a76b] text-[#8b7137] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:opacity-50">重新选择</button> : <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-[#687571]">{book.format}</span>}
        <button type="button" onClick={onDelete} disabled={disabled} className="border-b border-transparent text-[#687571] transition hover:border-[#a54b45] hover:text-[#a54b45] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:opacity-50">移除</button>
      </div>
    </article>
  );
}

function ShelfCover({ book }: { book: BookSummary }) {
  const [coverFailed, setCoverFailed] = useState(false);
  return (
    <div className="library-shelf-cover relative overflow-hidden bg-[#4d6188]">
      <div className="library-shelf-cover-content absolute bottom-0 left-0 right-0 top-0 p-3 text-[#f8faf5]">
        <span className="relative font-mono text-[0.62rem] tracking-[0.1em]">{book.format.toUpperCase()}</span>
        {book.cover_cache_path && !coverFailed ? (
          <img src={convertFileSrc(book.cover_cache_path)} alt="" onError={() => setCoverFailed(true)} className="absolute bottom-0 left-0 right-0 top-0 h-full w-full object-cover" />
        ) : (
          <span className="relative mt-auto block max-w-[8rem] font-serif text-xl leading-tight">{book.title}</span>
        )}
        <span className="absolute bottom-0 right-0 top-0 w-1 bg-white/30" aria-hidden="true" />
      </div>
    </div>
  );
}

function SettingsGlyph() {
  return (
    <svg className="h-[1.15rem] w-[1.15rem]" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
      <rect x="6" y="3.25" width="2.5" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1.15" />
      <rect x="12" y="8.25" width="2.5" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1.15" />
      <rect x="8.5" y="13.25" width="2.5" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  );
}

function ShelfSkeleton() {
  return (
    <div className="library-book-grid grid gap-4 pt-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-label="正在读取书架">
      {Array.from({ length: 6 }, (_, index) => <div key={index} className="space-y-3 border-t-[3px] border-[#d7e2de] bg-[#f9fbf7] p-3"><div className="library-shelf-cover bg-[#d7e2de]" /><div className="h-5 w-4/5 bg-[#d7e2de]" /><div className="h-3 w-1/2 bg-[#d7e2de]" /></div>)}
    </div>
  );
}

function EmptyShelf({ onImport }: { onImport: () => void }) {
  return (
    <div className="mt-6 border-l-[3px] border-[#c5a76b] bg-[#f9fbf7] px-6 py-8">
      <p className="font-serif text-2xl text-[#18272c]">书架还没有书。</p>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-[#687571]">从本地选择 EPUB，书籍会留在这里。阅读记录、系列关系和标签都会围绕这份书架展开。</p>
      <button type="button" onClick={onImport} className="mt-5 border-b border-[#2e6e67] py-1 text-sm text-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">添加第一本 EPUB <span aria-hidden="true">→</span></button>
    </div>
  );
}

function PlaceholderPage({ section }: { section: 'series' | 'search' | 'notes' }) {
  const meta = SECTION_META[section];
  return (
    <section className="mx-auto max-w-3xl px-2 pb-20 pt-20 lg:pt-28" aria-labelledby={`${section}-placeholder-title`}>
      <p className="mb-3 font-mono text-[0.68rem] uppercase tracking-[0.2em] text-[#2e6e67]">{meta.eyebrow}</p>
      <h2 id={`${section}-placeholder-title`} className="font-serif text-4xl font-medium tracking-[-0.05em] text-[#18272c] sm:text-5xl">{meta.title}</h2>
      <p className="mt-5 max-w-xl font-serif text-lg leading-relaxed text-[#687571]">{meta.subtitle}</p>
      <div className="mt-12 border-t border-[#d0d9d4] pt-5 text-sm leading-relaxed text-[#687571]">
        <p>F1 先确定入口、页面边界和空状态，不用假数据填充尚未接入的能力。</p>
        <span className="mt-4 inline-block border border-[#d0d9d4] px-3 py-2 font-mono text-[0.65rem] tracking-[0.1em] text-[#5c7397]">NEXT · F2 FUNCTIONAL CONSUMPTION</span>
      </div>
    </section>
  );
}

function ErrorNotice({
  title,
  message,
  onDismiss,
  onRetry,
}: {
  title: string;
  message: string;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  return (
    <div className="mt-6 flex items-start justify-between gap-4 border-l-[3px] border-[#a54b45] bg-[#fff8f6] px-5 py-4" role="alert">
      <div>
        <p className="text-sm font-medium text-[#7c3834]">{title}</p>
        <p className="mt-1 break-words text-xs leading-relaxed text-[#7c3834]">{message}</p>
        {onRetry && <button type="button" onClick={onRetry} className="mt-3 border-b border-[#a54b45] text-xs text-[#7c3834] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">重试</button>}
      </div>
      <button type="button" onClick={onDismiss} className="shrink-0 px-1 text-xl leading-none text-[#a54b45] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]" aria-label="关闭提示">×</button>
    </div>
  );
}

function SettingsPanel({
  embedded,
  readingPeriod,
  onReadingPeriodChange,
  recommendationsEnabled,
  onRecommendationsEnabledChange,
  settings,
  error,
  isSaving,
  onClose,
  onChange,
  onSave,
}: {
  embedded: boolean;
  readingPeriod: ReadingOverviewPeriod;
  onReadingPeriodChange: (period: ReadingOverviewPeriod) => void;
  recommendationsEnabled: boolean;
  onRecommendationsEnabledChange: (enabled: boolean) => void;
  settings: ReadingSettings | null;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onChange: (settings: ReadingSettings) => void;
  onSave: () => void;
}) {
  const panelClassName = embedded
    ? 'mt-8 border-t-[3px] border-[#2e6e67] bg-[#f9fbf7] p-5 sm:mt-10 sm:p-7'
    : 'absolute right-4 top-24 z-40 w-[min(22rem,calc(100vw-2rem))] border border-[#d0d9d4] bg-[#f9fbf7] p-5 shadow-[0_20px_44px_rgba(24,39,44,0.14)]';

  return (
    <aside className={panelClassName} aria-label="书架设置">
      <div className="mb-4 flex items-start justify-between gap-4 border-b border-[#d0d9d4] pb-4">
        <div>
          <p className="mb-1 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[#2e6e67]">Preferences</p>
          <h2 className="font-serif text-2xl font-medium">全局阅读设置</h2>
          <p className="mt-1 text-xs leading-relaxed text-[#687571]">新打开书籍默认使用这些设置；单书覆盖保持不变。</p>
        </div>
        <button type="button" onClick={onClose} className="text-2xl leading-none text-[#687571] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]" aria-label="关闭设置">×</button>
      </div>
      <section className="mb-6 border-b border-[#d0d9d4] pb-5" aria-labelledby="shelf-display-settings-title">
        <p id="shelf-display-settings-title" className="mb-3 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[#2e6e67]">书架显示</p>
        <div className="space-y-3 text-sm">
          <ShelfSelect label="阅读时长周期" value={readingPeriod} options={READING_PERIOD_OPTIONS} onChange={(value) => onReadingPeriodChange(value as ReadingOverviewPeriod)} />
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block">推荐阅读</span>
              <span className="mt-1 block max-w-sm text-xs leading-relaxed text-[#687571]">只使用书架关系和阅读状态；关闭后，藏书页不再显示这张卡。</span>
            </span>
            <input type="checkbox" checked={recommendationsEnabled} onChange={(event) => onRecommendationsEnabledChange(event.target.checked)} className="mt-1 h-4 w-4 accent-[#2e6e67]" />
          </label>
        </div>
      </section>
      {settings ? (
        <div className="space-y-3 text-sm">
          <ShelfSelect label="主题" value={settings.theme} options={[['light', '浅色'], ['sepia', '暖色'], ['dark', '深色']]} onChange={(value) => onChange({ ...settings, theme: value as ReadingSettings['theme'] })} />
          <ShelfSelect label="字体" value={settings.font_family} options={[['publisher', '出版方'], ['serif', '衬线'], ['sans', '无衬线'], ['system', '系统']]} onChange={(value) => onChange({ ...settings, font_family: value as ReadingSettings['font_family'] })} />
          <ShelfNumber label="字号" value={settings.font_size_px} min={12} max={32} step={1} unit="px" onChange={(value) => onChange({ ...settings, font_size_px: value })} />
          <ShelfNumber label="行距" value={settings.line_height_multiplier} min={1} max={3} step={0.1} onChange={(value) => onChange({ ...settings, line_height_multiplier: value })} />
          <ShelfNumber label="段落间距" value={settings.paragraph_spacing_multiplier} min={0} max={2} step={0.1} onChange={(value) => onChange({ ...settings, paragraph_spacing_multiplier: value })} />
          <ShelfNumber label="首行缩进" value={settings.text_indent_em} min={0} max={4} step={0.5} unit="em" onChange={(value) => onChange({ ...settings, text_indent_em: value })} />
          <ShelfNumber label="上边距" value={settings.margin_top_px} min={0} max={100} step={1} unit="px" onChange={(value) => onChange({ ...settings, margin_top_px: value })} />
          <ShelfNumber label="下边距" value={settings.margin_bottom_px} min={0} max={100} step={1} unit="px" onChange={(value) => onChange({ ...settings, margin_bottom_px: value })} />
          <ShelfNumber label="左边距" value={settings.margin_left_percent} min={0} max={20} step={1} unit="%" onChange={(value) => onChange({ ...settings, margin_left_percent: value })} />
          <ShelfNumber label="右边距" value={settings.margin_right_percent} min={0} max={20} step={1} unit="%" onChange={(value) => onChange({ ...settings, margin_right_percent: value })} />
          <ShelfNumber label="最大列宽" value={settings.max_column_width_px} min={300} max={1200} step={10} unit="px" onChange={(value) => onChange({ ...settings, max_column_width_px: value })} />
          <ShelfSelect label="排版" value={settings.flow} options={[['paginated', '分页'], ['scrolled', '滚动']]} onChange={(value) => onChange({ ...settings, flow: value as ReadingSettings['flow'] })} />
          <ShelfSelect label="跨页" value={settings.spread} options={[['auto', '自动'], ['none', '单页'], ['always', '双页']]} onChange={(value) => onChange({ ...settings, spread: value as ReadingSettings['spread'] })} />
          <div className="flex justify-end pt-2"><button type="button" disabled={isSaving} onClick={onSave} className="bg-[#18272c] px-3 py-2 text-xs text-[#f9fbf7] transition hover:bg-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:opacity-50">{isSaving ? '保存中…' : '保存设置'}</button></div>
        </div>
      ) : !error ? (
        <p className="text-sm text-[#687571]">正在读取设置…</p>
      ) : null}
      {error && <p className="mt-3 text-xs leading-relaxed text-[#a54b45]" role="alert">{error}</p>}
    </aside>
  );
}

function ShelfSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="border border-[#d0d9d4] bg-[#edf1ee] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

function ShelfNumber({ label, value, min, max, step, unit = '', onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[6rem_minmax(0,1fr)_2.5rem] items-center gap-2">
      <span>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => { const parsed = Number(event.target.value); if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed))); }} className="min-w-0 border border-[#d0d9d4] bg-[#edf1ee] px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-[#c5a76b]" />
      <span className="text-[#687571]">{unit}</span>
    </label>
  );
}
