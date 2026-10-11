import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { BookActionsSheet } from './BookActionsSheet';
import { bookDisplayTitle } from './bookDisplay';
import { isCurrentWindowFullscreen, onMainWindowResized, setCurrentWindowFullscreen } from '../../lib/window';
import { useLibraryStore } from '../../stores/libraryStore';
import { getGlobalReadingSettings, saveGlobalReadingSettings } from '../../lib/tauri';
import { queueSettingsWrite } from '../reader/settingsPersistence';
import type { BookSummary, ReadingOverviewPeriod, ReadingSettings } from '../../types/models';
import { B2CloseoutPanel } from '../closeout/B2CloseoutPanel';
import { B3PrivateDataPanel } from '../closeout/B3PrivateDataPanel';
import { ArchiveSearchPage } from './ArchiveSearchPage';
import { NotesPage } from './NotesPage';
import { FootprintPage, LibraryInsights } from './ReadingInsights';
import { SeriesPage } from './SeriesPage';
import { TagsPage } from './TagsPage';

export type LibrarySection = 'library' | 'series' | 'search' | 'notes' | 'tags' | 'footprint' | 'settings';

interface BookShelfProps {
  activeSection: LibrarySection;
  onSectionChange: (section: LibrarySection) => void;
  onOpenBook: (book: BookSummary, initialHref?: string) => void;
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

function readReadingPeriodPreference(): ReadingOverviewPeriod {
  const stored = readLocalPreference(READING_PERIOD_STORAGE_KEY);
  return stored && READING_PERIOD_VALUES.includes(stored as ReadingOverviewPeriod)
    ? stored as ReadingOverviewPeriod
    : 'month';
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
  // Only the selected book is presentation state; all actions retain the real store.
  const [actionsBookId, setActionsBookId] = useState<string | null>(null);
  const [detailBookId, setDetailBookId] = useState<string | undefined>();
  const actionsBook = books.find((book) => book.id === actionsBookId) ?? null;
  const isCollectionSection = ['library', 'series', 'tags'].includes(activeSection);
  const mainSection = ['footprint', 'settings'].includes(activeSection) ? activeSection : 'library';

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    if (activeSection !== 'settings' || settings) return;
    let disposed = false;
    setSettingsError(null);
    void queueSettingsWrite(() => getGlobalReadingSettings())
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
    void isCurrentWindowFullscreen()
      .then((value) => { if (!disposed) setIsFullscreen(value); })
      .catch(() => undefined);
    let unlisten: (() => void) | undefined;
    void onMainWindowResized(() => {
      void isCurrentWindowFullscreen()
        .then((value) => { if (!disposed) setIsFullscreen(value); })
        .catch(() => undefined);
    }).then((cleanup) => { unlisten = cleanup; }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, [activeSection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      void isCurrentWindowFullscreen().then(async (fullscreen) => {
        if (!fullscreen) return;
        await setCurrentWindowFullscreen(false);
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
      setSettings(await queueSettingsWrite(() => saveGlobalReadingSettings(input)));
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingSettings(false);
    }
  };

  const toggleFullscreen = async () => {
    setFullscreenError(null);
    try {
      const next = !(await isCurrentWindowFullscreen());
      await setCurrentWindowFullscreen(next);
      setIsFullscreen(next);
    } catch (err) {
      setFullscreenError(err instanceof Error ? err.message : String(err));
    }
  };

  // 只有从某本书的操作面板进入时才预选该书；其他入口回到页面自身的默认选择。
  const changeSection = (section: LibrarySection, detailBook?: string) => {
    setActionsBookId(null);
    setDetailBookId(detailBook);
    onSectionChange(section);
  };
  const detailBookExists = books.some((book) => book.id === detailBookId);
  const initialDetailBookId = detailBookExists ? detailBookId : undefined;

  return (
    <div className="h-screen overflow-hidden bg-paper text-ink">
      <div className="flex h-full flex-col md:flex-row">
        <aside className="mobile-app-nav fixed inset-x-0 bottom-0 z-40 flex h-[calc(74px+env(safe-area-inset-bottom,0px))] shrink-0 items-start border-t border-line bg-surface px-2 pb-[env(safe-area-inset-bottom)] md:sticky md:inset-auto md:top-0 md:h-screen md:w-[88px] md:flex-col md:items-center md:justify-start md:border-r md:border-t-0 md:px-0 md:pb-0" aria-label="主导航">
          <div className="hidden items-center gap-3 md:flex md:flex-col md:gap-2">
            <div className="grid h-9 w-9 place-items-center border border-ink font-reading text-xl text-accent md:mt-6 md:h-10 md:w-10">E</div>
            <span className="hidden font-mono text-[0.55rem] leading-tight tracking-[0.18em] text-muted md:block md:text-center">EPUB<br />START</span>
          </div>
          <nav className="mobile-nav-list flex h-[74px] w-full items-stretch justify-around gap-1 md:mt-12 md:grid md:h-auto md:w-full md:gap-3" aria-label="版块">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.section}
                type="button"
                aria-current={mainSection === item.section ? 'page' : undefined}
                onClick={() => changeSection(item.section)}
                className={`mobile-nav-item relative grid min-w-[3.5rem] flex-1 place-content-center gap-1 px-2 py-1 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent md:min-w-0 md:py-2 ${mainSection === item.section ? 'text-accent' : 'text-muted hover:text-accent'}`}
              >
                {mainSection === item.section && <span className="mobile-nav-active absolute hidden md:block left-2 right-2 top-0 h-[2px] bg-accent md:bottom-0 md:left-0 md:right-auto md:h-auto md:w-[2px]" aria-hidden="true" />}
                <LibraryGlyph kind={item.section} />
                <span className="text-xs">{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="hidden text-center text-xs text-muted md:mt-auto md:mb-6 md:block">离线阅读</div>
        </aside>

        <main className="mobile-main-content relative flex h-full min-w-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-[calc(74px+env(safe-area-inset-bottom,0px))] md:pb-0">
          <header className="shrink-0 px-5 pb-[22px] pt-[max(2rem,env(safe-area-inset-top,0px))] sm:px-8 lg:px-16" aria-label="书架快捷入口">
            <div className="mx-auto flex max-w-[1500px] items-center gap-2">
              <h1 className="mr-auto font-reading text-[34px] font-semibold leading-tight text-ink">{mainSection === 'library' ? '藏书' : mainSection === 'footprint' ? '足迹' : '设置'}</h1>
              {mainSection === 'library' && <>
                <button type="button" onClick={() => changeSection('search')} aria-label="搜索藏书" className="grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-subtle focus-visible:ring-2 focus-visible:ring-accent"><LibraryGlyph kind="search" /></button>
                <button type="button" onClick={() => changeSection('notes')} aria-label="查看批注" className="grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-subtle focus-visible:ring-2 focus-visible:ring-accent"><LibraryGlyph kind="notes" /></button>
              </>}
              <button type="button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? '退出全屏' : '全屏'} title={isFullscreen ? '退出全屏' : '全屏'} aria-pressed={isFullscreen} className="desktop-fullscreen-control hidden h-10 md:grid w-10 place-items-center border border-line text-lg leading-none text-muted transition hover:border-accent hover:bg-surface hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent">⛶</button>
              {mainSection === 'library' && (
                <button type="button" onClick={() => void importFromDialog()} disabled={isLoading} aria-label="导入 EPUB" title="导入 EPUB" className="flex h-11 items-center gap-1 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-accent transition hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"><span className="text-xl" aria-hidden="true">+</span>导入</button>
              )}
            </div>
          </header>
          {fullscreenError && <div className="desktop-fullscreen-error mx-auto w-full max-w-[1500px] px-5 pt-3 text-right text-xs text-danger sm:px-8 lg:px-16" role="alert">全屏切换失败：{fullscreenError}</div>}

          <div className="mx-auto w-full max-w-[1500px] flex-1 px-5 pb-12 sm:px-8 lg:px-16">
            {import.meta.env.VITE_B2_CLOSEOUT === '1' && <B2CloseoutPanel />}
            {import.meta.env.VITE_B3_DIAGNOSTICS === '1' && <B3PrivateDataPanel />}

            {readerError && <ErrorNotice title="无法打开这本书" message={readerError} onDismiss={onDismissReaderError} />}
            {error && <ErrorNotice title="书架暂时没有更新" message={error} onDismiss={clearError} onRetry={() => void loadBooks()} />}

            {isCollectionSection && activeSection !== 'library' && <CollectionTabs section={activeSection} count={books.length} onChange={changeSection} />}

            {activeSection === 'library' && (
              <>
                <div>
                  <LibraryInsights onOpenBook={onOpenBook} period={readingPeriod} recommendationsEnabled={recommendationsEnabled} />
                </div>
                <CollectionTabs section={activeSection} count={books.length} onChange={changeSection} />
                <BookCollection
                  books={books}
                  isLoading={isLoading}
                  onImport={() => void importFromDialog()}
                  onRetryImport={() => void importFromDialog()}
                  onRelocate={(bookId) => void relocateSource(bookId)}
                  onMore={(book) => setActionsBookId(book.id)}
                />
              </>
            )}
            {activeSection === 'footprint' && <div className="pt-5 lg:pt-6"><FootprintPage /></div>}
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
            {activeSection === 'series' && <SeriesPage books={books} onBack={() => changeSection('library')} onOpenBook={onOpenBook} />}
            {activeSection === 'tags' && <TagsPage initialBookId={initialDetailBookId} books={books} onBack={() => changeSection('library')} onOpenBook={onOpenBook} />}
            {activeSection === 'search' && <ArchiveSearchPage books={books} onBack={() => changeSection('library')} onOpenBook={onOpenBook} />}
            {activeSection === 'notes' && <NotesPage initialBookId={initialDetailBookId} books={books} onBack={() => changeSection('library')} onOpenBook={onOpenBook} />}


          </div>
        </main>
        {actionsBook && (
          <BookActionsSheet
            book={actionsBook}
            busy={isLoading}
            onClose={() => setActionsBookId(null)}
            onOpen={() => { setActionsBookId(null); onOpenBook(actionsBook); }}
            onRelocate={() => { setActionsBookId(null); void relocateSource(actionsBook.id); }}
            onRetry={() => { setActionsBookId(null); void importFromDialog(); }}
            onDelete={() => { setActionsBookId(null); void removeBook(actionsBook.id); }}
            onSection={(section) => changeSection(section, actionsBook.id)}
          />
        )}
      </div>
    </div>
  );
}

// These entries reuse the existing series/tag workflows without changing their queries.
function CollectionTabs({ section, count, onChange }: {
  section: LibrarySection;
  count: number;
  onChange: (section: LibrarySection) => void;
}) {
  return (
    <nav className="mt-[18px] flex gap-2.5" aria-label="藏书分类">
      {([['library', `全部 ${count}`], ['series', '系列'], ['tags', '标签']] as const).map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-current={section === key ? 'page' : undefined}
          onClick={() => onChange(key)}
          className={`min-h-10 rounded-full border px-[18px] text-sm ${section === key ? 'border-ink bg-ink font-semibold text-paper' : 'border-line bg-surface text-ink hover:bg-subtle'}`}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function BookCollection({
  books,
  isLoading,
  onImport,
  onRetryImport,
  onRelocate,
  onMore,
}: {
  books: BookSummary[];
  isLoading: boolean;
  onImport: () => void;
  onRetryImport: () => void;
  onRelocate: (bookId: string) => void;
  onMore: (book: BookSummary) => void;
}) {
  return (
    <section className="mt-[18px]" aria-labelledby="all-books-title" aria-busy={isLoading}>
      <div className="sr-only"><h2 id="all-books-title">全部藏书</h2></div>

      {isLoading && books.length === 0 ? (
        <ShelfSkeleton />
      ) : books.length === 0 ? (
        <EmptyShelf onImport={onImport} />
      ) : (
        <div className={`library-book-grid grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 ${isLoading ? 'opacity-60' : ''}`}>
          {books.map((book) => (
            <ShelfBookCard
              key={book.id}
              book={book}
              disabled={isLoading}
              onOpen={() => onMore(book)}
              onRetryImport={onRetryImport}
              onRelocate={() => onRelocate(book.id)}
              onMore={() => onMore(book)}
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
  onRetryImport,
  onRelocate,
  onMore,
}: {
  book: BookSummary;
  disabled: boolean;
  onOpen: () => void;
  onRetryImport: () => void;
  onRelocate: () => void;
  onMore: () => void;
}) {
  const display = bookDisplayTitle(book.title);
  const canRelocate = book.status === 'missing';
  const canOpen = book.status !== 'error';
  return (
    <article className="library-book-card group relative min-w-0">
      <button type="button" onClick={onOpen} disabled={disabled || !canOpen} className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60">
        <ShelfCover book={book} />
        <div className="pt-3">
          <h3 className="library-book-card-title line-clamp-2 font-reading text-[17px] font-semibold leading-snug text-ink" title={book.title}>{display.heading}</h3>
          <p className="library-book-card-author mt-1 truncate text-xs text-muted">{display.subtitle ?? (book.authors.length > 0 ? book.authors.join(' · ') : '作者信息未提供')}</p>
          {book.status === 'error' && <span className="mt-3 inline-block border-b border-danger pb-1 text-xs text-danger">解析失败</span>}
          {book.status === 'missing' && <span className="mt-3 inline-block border-b border-accent pb-1 text-xs text-muted">文件缺失</span>}
        </div>
      </button>
      {/* 来源失败仍可直接恢复，正常书不额外占一行 EPUB 标签和操作栏。 */}
      {(canRelocate || book.status === 'error') && <div className="mt-2 text-xs">
        {canRelocate ? <button type="button" onClick={onRelocate} disabled={disabled} className="min-h-11 text-accent focus-visible:ring-2 focus-visible:ring-accent">重新选择</button> : <button type="button" onClick={onRetryImport} disabled={disabled} className="min-h-11 text-danger focus-visible:ring-2 focus-visible:ring-accent">重新导入</button>}
      </div>}
      <button type="button" onClick={onMore} disabled={disabled} aria-label={`更多操作：${book.title}`} className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-full bg-surface/90 text-xl text-muted opacity-80 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-accent">⋯</button>
    </article>
  );
}

function ShelfCover({ book }: { book: BookSummary }) {
  const [coverFailed, setCoverFailed] = useState(false);
  return (
    // The shared ratio spacer also works on older Android WebViews that lack aspect-ratio.
    <div className="library-shelf-cover relative overflow-hidden rounded-lg bg-accent shadow-sm">
      <div className="library-shelf-cover-content absolute bottom-0 left-0 right-0 top-0 p-3 text-surface">
        <span className="relative font-mono text-[0.62rem] tracking-[0.1em]">{book.format.toUpperCase()}</span>
        {book.cover_cache_path && !coverFailed ? (
          <img src={convertFileSrc(book.cover_cache_path)} alt="" onError={() => setCoverFailed(true)} className="absolute bottom-0 left-0 right-0 top-0 h-full w-full object-cover" />
        ) : (
          <span className="relative mt-auto block max-w-[8rem] font-reading text-xl leading-tight">{book.title}</span>
        )}
        <span className="absolute bottom-0 right-0 top-0 w-1 bg-white/30" aria-hidden="true" />
      </div>
    </div>
  );
}

// 线性图标沿用草稿，不使用平台字形各不相同的 Unicode 符号。
function LibraryGlyph({ kind }: { kind: LibrarySection }) {
  return <svg className="h-[23px] w-[23px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'library' && <><path d="M4 5a3 3 0 0 1 3-3h13v17H7a3 3 0 0 0-3 3V5Z" /><path d="M4 19h16" /></>}
    {kind === 'footprint' && <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4m8-4v4M3 10h18" /></>}
    {kind === 'settings' && <><path d="M4 7h10m4 0h2M4 17h2m4 0h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>}
    {kind === 'search' && <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>}
    {kind === 'notes' && <><path d="M4 20l4.3-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m14 7 3 3" /></>}
  </svg>;
}

function ShelfSkeleton() {
  return (
    <div className="library-book-grid grid grid-cols-2 gap-5 pt-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-label="正在读取书架">
      {Array.from({ length: 6 }, (_, index) => <div key={index} className="space-y-3 border-t border-subtle bg-surface p-3"><div className="library-shelf-cover rounded-lg bg-subtle" /><div className="h-5 w-4/5 bg-subtle" /><div className="h-3 w-1/2 bg-subtle" /></div>)}
    </div>
  );
}

function EmptyShelf({ onImport }: { onImport: () => void }) {
  return (
    <div className="mt-6 border-l border-accent bg-surface px-6 py-8">
      <p className="font-reading text-2xl text-ink">书架还没有书。</p>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">从本地选择 EPUB，书籍会留在这里。阅读记录、系列关系和标签都会围绕这份书架展开。</p>
      <button type="button" onClick={onImport} className="mt-5 border-b border-accent py-1 text-sm text-accent focus:outline-none focus:ring-2 focus:ring-accent">添加第一本 EPUB <span aria-hidden="true">→</span></button>
    </div>
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
    <div className="mt-6 flex items-start justify-between gap-4 border-l border-danger bg-surface px-5 py-4" role="alert">
      <div>
        <p className="text-sm font-medium text-danger">{title}</p>
        <p className="mt-1 break-words text-xs leading-relaxed text-danger">{message}</p>
        {onRetry && <button type="button" onClick={onRetry} className="mt-3 border-b border-danger text-xs text-danger focus:outline-none focus:ring-2 focus:ring-accent">重试</button>}
      </div>
      <button type="button" onClick={onDismiss} className="shrink-0 px-1 text-xl leading-none text-danger focus:outline-none focus:ring-2 focus:ring-accent" aria-label="关闭提示">×</button>
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
    ? 'mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-7'
    : 'absolute right-4 top-24 z-40 w-[min(22rem,calc(100vw-2rem))] border border-line bg-surface p-5 shadow-[0_20px_44px_rgba(24,39,44,0.14)]';

  return (
    <aside className={panelClassName} aria-label="书架设置">
      <div className="mb-4 flex items-start justify-between gap-4 border-b border-line pb-4">
        <div>

          <h2 className="font-reading text-2xl font-medium">全局阅读设置</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">新打开书籍默认使用这些设置；单书覆盖保持不变。</p>
        </div>
        <button type="button" onClick={onClose} className="text-2xl leading-none text-muted focus:outline-none focus:ring-2 focus:ring-accent" aria-label="关闭设置">×</button>
      </div>
      <section className="mb-6 border-b border-line pb-5" aria-labelledby="shelf-display-settings-title">
        <p id="shelf-display-settings-title" className="mb-3 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-accent">书架显示</p>
        <div className="space-y-3 text-sm">
          <ShelfSelect label="阅读时长周期" value={readingPeriod} options={READING_PERIOD_OPTIONS} onChange={(value) => onReadingPeriodChange(value as ReadingOverviewPeriod)} />
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block">推荐阅读</span>
              <span className="mt-1 block max-w-sm text-xs leading-relaxed text-muted">只使用书架关系和阅读状态；关闭后，藏书页不再显示这张卡。</span>
            </span>
            <input type="checkbox" checked={recommendationsEnabled} onChange={(event) => onRecommendationsEnabledChange(event.target.checked)} className="mt-1 h-4 w-4 accent-accent" />
          </label>
        </div>
      </section>
      {settings ? (
        <div className="space-y-3 text-sm">
          <ShelfSelect label="主题" value={settings.theme} options={[['light', '浅色'], ['sepia', '暖色'], ['dark', '深色']]} onChange={(value) => onChange({ ...settings, theme: value as ReadingSettings['theme'] })} />
          <ShelfSelect label="字体" value={settings.font_family} options={[['publisher', '出版方'], ['serif', '衬线'], ['sans', '无衬线'], ['system', '系统']]} onChange={(value) => onChange({ ...settings, font_family: value as ReadingSettings['font_family'] })} />
          <ShelfNumber label="字号" value={settings.font_size_px} min={12} max={32} step={1} unit="px" onChange={(value) => onChange({ ...settings, font_size_px: value })} />
          {/* Advanced fields keep exact saved values; collapsing only changes presentation. */}
          <details className="rounded-xl border border-line p-3"><summary className="cursor-pointer py-2 text-accent">更多排版</summary><div className="mt-3 space-y-3">
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
          </div></details>
          <div className="flex justify-end pt-2"><button type="button" disabled={isSaving} onClick={onSave} className="bg-ink px-3 py-2 text-xs text-surface transition hover:bg-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50">{isSaving ? '保存中…' : '保存设置'}</button></div>
        </div>
      ) : !error ? (
        <p className="text-sm text-muted">正在读取设置…</p>
      ) : null}
      {error && <p className="mt-3 text-xs leading-relaxed text-danger" role="alert">{error}</p>}
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
      <select value={value} onChange={(event) => onChange(event.target.value)} className="border border-line bg-paper px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
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
  // Keep exact numeric entry available alongside comfortable touch step buttons.
  const changeByStep = (direction: number) => onChange(Math.min(max, Math.max(min, Number((value + direction * step).toFixed(2)))));
  return (
    <label className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
      <span>{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-1">
        <button type="button" onClick={() => changeByStep(-1)} aria-label={`减小${label}`} className="h-11 w-9 shrink-0 rounded-lg border border-line bg-paper">−</button>
        <input
          aria-label={label}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => { const parsed = Number(event.target.value); if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed))); }}
          className="h-11 min-w-0 w-20 rounded-lg border border-line bg-paper px-2 text-center"
        />
        <button type="button" onClick={() => changeByStep(1)} aria-label={`增大${label}`} className="h-11 w-9 shrink-0 rounded-lg border border-line bg-paper">+</button>
        <span className="w-5 shrink-0 text-xs text-muted">{unit}</span>
      </span>
    </label>
  );
}
