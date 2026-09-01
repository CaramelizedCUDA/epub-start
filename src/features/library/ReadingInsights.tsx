import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useReadingInsightsStore, currentLocalYear } from '../../stores/readingInsightsStore';
import type {
  BookSummary,
  ContinueReadingItem,
  LibraryReadingOverview,
  ReadingDurationSummary,
  ReadingFootprint,
  ReadingFootprintDay,
  ReadingFootprintYear,
  ReadingOverviewPeriod,
  ReadingRecommendation,
  ReadingRecommendationReason,
} from '../../types/models';
import { convertFileSrc } from '@tauri-apps/api/core';

interface ReadingInsightsProps {
  onOpenBook: (book: BookSummary) => void;
  period: ReadingOverviewPeriod;
  recommendationsEnabled: boolean;
}

const PERIODS: Array<{ value: ReadingOverviewPeriod; label: string }> = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'quarter', label: '季度' },
];

export function LibraryInsights({ onOpenBook, period, recommendationsEnabled }: ReadingInsightsProps) {
  const [recommendationsCollapsed, setRecommendationsCollapsed] = useState(false);
  const overview = useReadingInsightsStore((state) => state.overview);
  const overviewLoading = useReadingInsightsStore((state) => state.overviewLoading);
  const overviewError = useReadingInsightsStore((state) => state.overviewError);
  const loadOverview = useReadingInsightsStore((state) => state.loadOverview);
  const clearOverviewError = useReadingInsightsStore((state) => state.clearOverviewError);
  const currentOverview = overview?.duration.period === period ? overview : null;

  useEffect(() => {
    void loadOverview(period);
  }, [loadOverview, period]);

  useEffect(() => {
    if (!recommendationsEnabled) setRecommendationsCollapsed(false);
  }, [recommendationsEnabled]);

  return (
    <div className="library-insights-grid grid gap-8 xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.9fr)]">
      <div className="min-w-0">
        <DurationPanel
          period={period}
          overview={currentOverview}
          isLoading={overviewLoading}
          error={overviewError}
          onRetry={() => {
            clearOverviewError();
            void loadOverview(period);
          }}
          continueItem={currentOverview?.continue_reading ?? null}
          isContinueLoading={overviewLoading && currentOverview === null}
          onOpenBook={onOpenBook}
        />
      </div>
      {recommendationsEnabled && (
        <RecommendationPanel
          recommendations={currentOverview?.recommendations ?? []}
          isLoading={overviewLoading && currentOverview === null}
          error={overviewError}
          onOpenBook={onOpenBook}
          collapsed={recommendationsCollapsed}
          onToggle={() => setRecommendationsCollapsed((value) => !value)}
        />
      )}
    </div>
  );
}

function DurationPanel({
  period,
  overview,
  isLoading,
  error,
  onRetry,
  continueItem,
  isContinueLoading,
  onOpenBook,
}: {
  period: ReadingOverviewPeriod;
  overview: LibraryReadingOverview | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  continueItem: ContinueReadingItem | null;
  isContinueLoading: boolean;
  onOpenBook: (book: BookSummary) => void;
}) {
  const duration = overview?.duration ?? null;
  const periodLabel = PERIODS.find((item) => item.value === period)?.label ?? '周';

  return (
    <section className="border-t-[3px] border-[#2e6e67]" aria-labelledby="reading-duration-title" aria-busy={isLoading}>
      <div className="flex flex-wrap items-start justify-between gap-5 border-b border-[#d0d9d4] pb-4 pt-5">
        <div>
          <p className="mb-1 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[#2e6e67]">阅读时长</p>
          <h2 id="reading-duration-title" className="font-serif text-3xl font-medium tracking-[-0.04em] text-[#18272c]">{periodLabel}的阅读</h2>
        </div>
        <span className="pt-2 text-xs text-[#687571]">周期可在设置中调整</span>
      </div>

      {error && !duration ? (
        <InlineError message={error} onRetry={onRetry} />
      ) : duration ? (
        <div className={`library-duration-layout grid grid-cols-2 items-center gap-x-4 gap-y-3 border-b border-[#d0d9d4] py-5 sm:grid-cols-[minmax(0,0.9fr)_minmax(13rem,1fr)] sm:gap-6 sm:py-7 ${isLoading ? 'opacity-60' : ''}`}>
          <DurationWheel duration={duration} />
          <ContinueReadingWidget item={continueItem} isLoading={isContinueLoading} error={error} onOpenBook={onOpenBook} />
        </div>
      ) : (
        <DurationSkeleton />
      )}
    </section>
  );
}

function DurationWheel({ duration }: { duration: ReadingDurationSummary }) {
  const style = useMemo<CSSProperties>(() => ({
    background: `conic-gradient(${durationGradient(duration)})`,
  }), [duration]);

  return (
    <div className="library-duration-wheel flex min-h-[8rem] items-center justify-center" role="img" aria-label={`阅读时长 ${formatDuration(duration.total_reading_ms)}，${formatDurationRange(duration.range_start_local_date, duration.range_end_local_date)}`}>
      <div className="library-duration-wheel-circle relative grid h-28 w-28 place-items-center rounded-full p-2 sm:h-52 sm:w-52 sm:p-[0.85rem]" style={style}>
        <div className="grid h-full w-full place-items-center rounded-full border border-[#c5a76b] bg-[#f9fbf7] text-center">
          <div>
            <strong className="block font-mono text-xl font-medium tracking-[-0.05em] text-[#18272c]">{formatDuration(duration.total_reading_ms)}</strong>
            <span className="mt-1 block font-mono text-[0.62rem] uppercase tracking-[0.15em] text-[#687571]">{durationPeriodLabel(duration.period)}</span>
            <span className="mt-1 block max-w-[7.5rem] font-mono text-[0.52rem] leading-tight tracking-[-0.01em] text-[#687571]">{formatDurationRange(duration.range_start_local_date, duration.range_end_local_date)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContinueReadingWidget({
  item,
  isLoading,
  error,
  onOpenBook,
}: {
  item: ContinueReadingItem | null;
  isLoading: boolean;
  error: string | null;
  onOpenBook: (book: BookSummary) => void;
}) {
  return (
    <section className="library-continue-widget min-w-0 border-l-[3px] border-[#2e6e67] bg-[#f9fbf7] p-3 sm:p-4" aria-labelledby="continue-reading-title">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="mb-1 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-[#2e6e67]">下一步</p>
          <h2 id="continue-reading-title" className="font-serif text-xl font-medium tracking-[-0.04em] text-[#18272c] sm:text-2xl">继续阅读</h2>
        </div>
        {item && (
          <button type="button" onClick={() => onOpenBook(item.book)} className="shrink-0 border-b border-[#2e6e67] px-0 py-1 text-xs text-[#2e6e67] transition hover:text-[#18272c] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">
            打开 <span aria-hidden="true">→</span>
          </button>
        )}
      </div>

      {isLoading ? (
        <ContinueReadingSkeleton />
      ) : error && !item ? (
        <InlineError message={error} />
      ) : item ? (
        <button type="button" onClick={() => onOpenBook(item.book)} className="mt-3 grid w-full min-w-0 grid-cols-[3rem_minmax(0,1fr)] items-center gap-3 text-left focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">
          <BookCover book={item.book} size="tiny" />
          <div className="min-w-0">
            <p className="mb-1 truncate text-[0.62rem] text-[#2e6e67]">{item.book.format.toUpperCase()} · {formatLastRead(item.last_read_at)}</p>
            <h3 className="truncate font-serif text-base font-medium leading-tight tracking-[-0.02em] text-[#18272c]">{item.book.title}</h3>
            <p className="mt-1 truncate text-[0.68rem] text-[#687571]">{formatAuthors(item.book)}</p>
            <div className="mt-3 h-[3px] bg-[#d7e2de]" aria-label={`阅读进度 ${formatProgress(item.book, item.progress?.progression)}`}>
              <span className="block h-full bg-[#2e6e67]" style={{ width: `${progressPercent(item.progress?.progression)}%` }} />
            </div>
            <div className="mt-1 flex justify-between gap-2 font-mono text-[0.58rem] text-[#687571]">
              <span className="truncate">{item.progress?.location_cfi ? '上次位置' : '第一页'}</span>
              <strong className="font-medium text-[#18272c]">{formatProgress(item.book, item.progress?.progression)}</strong>
            </div>
          </div>
        </button>
      ) : (
        <div className="mt-3 border-t border-[#d0d9d4] pt-3">
          <p className="font-serif text-base text-[#18272c]">还没有正在继续的书</p>
          <p className="mt-1 text-xs leading-relaxed text-[#687571]">从藏书中打开一本书，下一次就能从上次位置回来。</p>
        </div>
      )}
    </section>
  );
}

function RecommendationPanel({
  recommendations,
  isLoading,
  error,
  onOpenBook,
  collapsed,
  onToggle,
}: {
  recommendations: ReadingRecommendation[];
  isLoading: boolean;
  error: string | null;
  onOpenBook: (book: BookSummary) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside className="library-recommendation-panel border-l border-[#d0d9d4] pl-0 xl:pl-8" aria-labelledby="recommendations-title">
      <div className="border-t-[3px] border-[#c5a76b] pt-5">
        <div className="flex items-start justify-between gap-4 border-b border-[#d0d9d4] pb-4">
          <div>
            <p className="mb-1 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[#c5a76b]">从你的书架里</p>
            <h2 id="recommendations-title" className="font-serif text-3xl font-medium tracking-[-0.04em] text-[#18272c]">推荐阅读</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xl text-[#c5a76b]">{String(recommendations.length).padStart(2, '0')}</span>
            <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-controls="recommendations-body" className="border-b border-transparent px-1 py-1 text-xs text-[#687571] transition hover:border-[#2e6e67] hover:text-[#18272c] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">
              {collapsed ? '展开' : '收起'} <span aria-hidden="true">{collapsed ? '↓' : '↑'}</span>
            </button>
          </div>
        </div>
        <div id="recommendations-body">
          {collapsed ? (
            <p className="border-b border-[#d0d9d4] py-4 text-sm leading-relaxed text-[#687571]">推荐阅读已折叠，设置仍保持开启。</p>
          ) : (
            <>
              <p className="py-4 font-serif text-base leading-relaxed text-[#687571]">只根据书架关系和阅读状态，给你几个不剧透的方向。</p>

              {isLoading ? (
                <RecommendationSkeleton />
              ) : error && recommendations.length === 0 ? (
                <InlineError message={error} />
              ) : recommendations.length > 0 ? (
                <div>
                  {recommendations.map((recommendation) => (
                    <RecommendationItem key={recommendation.book.id} recommendation={recommendation} onOpenBook={onOpenBook} />
                  ))}
                </div>
              ) : (
                <div className="border-t border-[#d0d9d4] px-1 py-5">
                  <p className="font-serif text-xl text-[#18272c]">书架暂时没有推荐</p>
                  <p className="mt-1 text-sm text-[#687571]">多读几本或完成一次导入后，这里会出现基于书架关系的候选。</p>
                </div>
              )}

              <div className="mt-5 flex gap-3 border-t border-dashed border-[#d0d9d4] pt-4 text-xs leading-relaxed text-[#687571]">
                <span className="grid h-5 w-5 shrink-0 place-items-center border border-[#c5a76b] font-mono text-[#c5a76b]">i</span>
                <p>理由来自系列、进度和书架状态。正文摘录推荐将在 Reader 完成后另行评审。</p>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function RecommendationItem({
  recommendation,
  onOpenBook,
}: {
  recommendation: ReadingRecommendation;
  onOpenBook: (book: BookSummary) => void;
}) {
  return (
    <article className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 border-t border-[#d0d9d4] py-4">
      <BookCover book={recommendation.book} size="small" />
      <div className="min-w-0">
        <p className="mb-1 text-xs text-[#2e6e67]">{recommendationReasonLabel(recommendation.reason)}</p>
        <h3 className="font-serif text-lg font-medium leading-tight text-[#18272c]">{recommendation.book.title}</h3>
        <p className="mt-2 text-xs leading-relaxed text-[#687571]">{recommendationReasonText(recommendation.reason)}</p>
        <button type="button" onClick={() => onOpenBook(recommendation.book)} className="mt-3 border-b border-[#2e6e67] py-1 text-xs text-[#2e6e67] transition hover:text-[#18272c] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">
          打开这本 <span aria-hidden="true">↗</span>
        </button>
      </div>
    </article>
  );
}

export function FootprintPage() {
  const year = currentLocalYear();
  const [scope, setScope] = useState<'year' | 'all'>('year');
  const footprint = useReadingInsightsStore((state) => state.footprint);
  const footprintLoading = useReadingInsightsStore((state) => state.footprintLoading);
  const footprintError = useReadingInsightsStore((state) => state.footprintError);
  const loadFootprint = useReadingInsightsStore((state) => state.loadFootprint);
  const clearFootprintError = useReadingInsightsStore((state) => state.clearFootprintError);

  useEffect(() => {
    void loadFootprint(scope === 'all' ? { kind: 'all' } : { kind: 'year', year });
  }, [loadFootprint, scope, year]);

  const isCurrentScope = footprint?.scope.kind === scope;
  const currentFootprint = isCurrentScope ? footprint : null;
  const retry = () => {
    clearFootprintError();
    void loadFootprint(scope === 'all' ? { kind: 'all' } : { kind: 'year', year });
  };

  return (
    <section className="border-t border-[#d0d9d4] pt-6" aria-label="阅读足迹数据" aria-busy={footprintLoading}>
      <div className="flex justify-end border-b border-[#d0d9d4] pb-6">
        <div className="flex items-center gap-1" role="tablist" aria-label="足迹范围">
          <button type="button" role="tab" aria-selected={scope === 'year'} onClick={() => setScope('year')} className={scopeTabClass(scope === 'year')}>{year}</button>
          <button type="button" role="tab" aria-selected={scope === 'all'} onClick={() => setScope('all')} className={scopeTabClass(scope === 'all')}>总计</button>
        </div>
      </div>

      {footprintError && !currentFootprint ? (
        <InlineError message={footprintError} onRetry={retry} />
      ) : currentFootprint ? (
        <>
          <FootprintSummary footprint={currentFootprint} />
          {currentFootprint.years.length > 0 ? (
            <div className={footprintLoading ? 'opacity-60' : ''}>
              {currentFootprint.years.map((item) => <FootprintYear key={item.year} year={item} showTitle={scope === 'all'} />)}
              <FootprintLegend />
            </div>
          ) : (
            <EmptyFootprint />
          )}
        </>
      ) : (
        <FootprintSkeleton />
      )}
    </section>
  );
}

function FootprintSummary({ footprint }: { footprint: ReadingFootprint }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-6">
      <strong className="font-mono text-3xl font-medium tracking-[-0.06em] text-[#18272c]">{formatDuration(footprint.totals.reading_ms)}</strong>
      <span className="text-xs text-[#687571]">
        <b className="font-semibold text-[#18272c]">{footprint.totals.active_days}</b> 个阅读日 · <b className="font-semibold text-[#18272c]">{footprint.totals.distinct_books}</b> 本书 · <b className="font-semibold text-[#18272c]">{footprint.totals.distinct_series}</b> 个系列
      </span>
    </div>
  );
}

function FootprintYear({ year, showTitle }: { year: ReadingFootprintYear; showTitle: boolean }) {
  const maxReadingMs = Math.max(...year.days.map((day) => day.reading_ms), 0);
  const leadingCells = (new Date(year.year, 0, 1).getDay() + 6) % 7;
  const columns = Math.ceil((leadingCells + year.days.length) / 7);
  const cells: Array<ReadingFootprintDay | null> = [
    ...Array.from({ length: leadingCells }, () => null),
    ...year.days,
  ];

  return (
    <section className="border-t border-[#d0d9d4] py-5" aria-labelledby={showTitle ? `footprint-year-${year.year}` : undefined}>
      {showTitle && <h3 id={`footprint-year-${year.year}`} className="mb-4 font-mono text-sm tracking-[0.1em] text-[#2e6e67]">{year.year}</h3>}
      <div className="min-w-0 overflow-x-auto pb-1">
        <div className="min-w-[42rem]">
          <div className="grid grid-cols-12 gap-2 px-1 font-mono text-[0.62rem] text-[#687571]" aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => <span key={index}>{index + 1}月</span>)}
          </div>
          <div className="mt-2 grid grid-flow-col grid-rows-7 gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {cells.map((day, index) => day ? <FootprintCell key={day.local_date} day={day} maxReadingMs={maxReadingMs} /> : <span key={`blank-${index}`} aria-hidden="true" />)}
          </div>
        </div>
      </div>
    </section>
  );
}

function FootprintCell({ day, maxReadingMs }: { day: ReadingFootprintDay; maxReadingMs: number }) {
  const level = footprintLevel(day.reading_ms, maxReadingMs);
  const label = `${day.local_date} · ${formatDuration(day.reading_ms)} · ${day.distinct_books} 本书 · ${day.distinct_series} 个系列`;
  return <span className={`block min-h-3 min-w-2 border border-transparent ${footprintLevelClass(level)} focus:border-[#18272c] focus:outline-none`} title={label} aria-label={label} tabIndex={0} />;
}

function FootprintLegend() {
  return (
    <div className="flex items-center justify-end gap-1.5 pt-3 text-[0.68rem] text-[#687571]" aria-label="热力图图例">
      <span className="mr-1">没有记录</span>
      {[1, 2, 3, 4].map((level) => <span key={level} className={`h-2.5 w-2.5 ${footprintLevelClass(level)}`} aria-hidden="true" />)}
      <span className="ml-1">更久</span>
    </div>
  );
}

function EmptyFootprint() {
  return (
    <div className="border-l-[3px] border-[#c5a76b] bg-[#f9fbf7] px-5 py-6">
      <p className="font-serif text-xl text-[#18272c]">还没有阅读足迹</p>
      <p className="mt-1 text-sm text-[#687571]">当你在 Reader 中读过一段时间，这里会留下按日期整理的记录。</p>
    </div>
  );
}

function BookCover({ book, size }: { book: BookSummary; size: 'large' | 'small' | 'tiny' }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const dimensions = size === 'large' ? 'h-44 w-[5.5rem] sm:w-32' : size === 'tiny' ? 'h-16 w-12' : 'h-24 w-[4.5rem]';
  const title = book.title.length > 20 ? `${book.title.slice(0, 20)}…` : book.title;
  return (
    <div className={`relative flex shrink-0 flex-col justify-between overflow-hidden bg-[#4d6188] p-3 text-[#f8faf5] shadow-[0_14px_28px_rgba(24,39,44,0.12)] ${dimensions}`}>
      <span className="font-mono text-[0.62rem] tracking-[0.1em]">{book.format.toUpperCase()}</span>
      {book.cover_cache_path && !coverFailed ? (
        <img src={convertFileSrc(book.cover_cache_path)} alt="" onError={() => setCoverFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="relative font-serif text-xl leading-tight">{title}</span>
      )}
      <span className="relative max-w-[4.5rem] font-mono text-[0.5rem] uppercase tracking-[0.08em]">EPUBSTART</span>
      <span className="absolute bottom-0 right-0 top-0 w-1 bg-white/30" aria-hidden="true" />
    </div>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="my-5 border-l-[3px] border-[#a54b45] bg-[#fff8f6] px-5 py-4" role="alert">
      <p className="text-sm text-[#7c3834]">{message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="mt-3 border-b border-[#a54b45] text-xs text-[#7c3834] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">重试</button>}
    </div>
  );
}

function DurationSkeleton() {
  return <div className="library-duration-layout grid min-h-[12rem] grid-cols-2 items-center gap-x-4 gap-y-3 border-b border-[#d0d9d4] py-5 sm:grid-cols-[minmax(0,0.9fr)_minmax(13rem,1fr)] sm:gap-6 sm:py-7"><div className="library-duration-wheel mx-auto h-28 w-28 rounded-full border-2 border-[#d7e2de] sm:h-52 sm:w-52 sm:border-[0.85rem]" /><ContinueReadingSkeleton /></div>;
}

function ContinueReadingSkeleton() {
  return <div className="library-continue-widget min-w-0 bg-[#f9fbf7] p-3 sm:p-4"><div className="h-4 w-16 bg-[#d7e2de]" /><div className="mt-3 grid grid-cols-[3rem_minmax(0,1fr)] gap-3"><span className="h-16 w-12 bg-[#d7e2de]" /><div className="space-y-3 pt-1"><span className="block h-3 w-4/5 bg-[#d7e2de]" /><span className="block h-3 w-3/5 bg-[#d7e2de]" /><span className="block h-1 w-full bg-[#d7e2de]" /></div></div></div>;
}

function RecommendationSkeleton() {
  return <div>{[1, 2, 3].map((item) => <div key={item} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 border-t border-[#d0d9d4] py-4"><span className="h-24 w-[4.5rem] bg-[#d7e2de]" /><div className="space-y-3"><span className="block h-3 w-24 bg-[#d7e2de]" /><span className="block h-5 w-4/5 bg-[#d7e2de]" /><span className="block h-3 w-full bg-[#d7e2de]" /></div></div>)}</div>;
}

function FootprintSkeleton() {
  return <div className="space-y-4 py-6"><span className="block h-9 w-36 bg-[#d7e2de]" /><span className="block h-36 w-full bg-[#d7e2de]" /></div>;
}

function durationGradient(duration: ReadingDurationSummary): string {
  const total = duration.buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.reading_ms), 0);
  if (total <= 0) return '#d7e2de 0 100%';
  const colors = ['#2e6e67', '#5c7397', '#c5a76b', '#5c9086'];
  let offset = 0;
  const segments = duration.buckets.flatMap((bucket, index) => {
    const share = (Math.max(0, bucket.reading_ms) / total) * 100;
    if (share <= 0) return [];
    const end = Math.min(100, offset + share);
    const segment = `${colors[index % colors.length]} ${offset}% ${end}%`;
    offset = end;
    return [segment];
  });
  if (offset < 100) segments.push(`#d7e2de ${offset}% 100%`);
  return segments.join(', ');
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes}m`;
  return `${hours}h ${String(remainingMinutes).padStart(2, '0')}m`;
}

function durationPeriodLabel(period: ReadingOverviewPeriod): string {
  return PERIODS.find((item) => item.value === period)?.label ?? period;
}

function formatDurationRange(startLocalDate: string, endLocalDate: string): string {
  const sameYear = startLocalDate.slice(0, 4) === endLocalDate.slice(0, 4);
  const start = formatLocalDate(startLocalDate, !sameYear);
  const end = formatLocalDate(endLocalDate, !sameYear);
  if (startLocalDate === endLocalDate) return start;
  return `${start} — ${end}`;
}

function formatLocalDate(localDate: string, includeYear: boolean): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return localDate;
  const [, year, month, day] = match;
  return includeYear ? `${year}.${month}.${day}` : `${month}.${day}`;
}

function formatLastRead(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return `${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatAuthors(book: BookSummary): string {
  return book.authors.length > 0 ? book.authors.join(' · ') : '作者信息未提供';
}

function progressPercent(progression: number | null | undefined): number {
  if (progression === null || progression === undefined || !Number.isFinite(progression)) return 0;
  return Math.round(Math.max(0, Math.min(1, progression)) * 100);
}

function formatProgress(book: BookSummary, progression: number | null | undefined): string {
  if (progression === null || progression === undefined) return book.status === 'available' ? '未开始' : '不可用';
  return `${progressPercent(progression)}%`;
}

function recommendationReasonLabel(reason: ReadingRecommendationReason): string {
  switch (reason.kind) {
    case 'next_in_series': return '系列下一本';
    case 'unfinished_return': return '还没读完';
    case 'unstarted_in_library': return '书架里的新开始';
  }
}

function recommendationReasonText(reason: ReadingRecommendationReason): string {
  switch (reason.kind) {
    case 'next_in_series': return `${reason.series_name} 的下一本，接在《${reason.previous_book_title}》之后。`;
    case 'unfinished_return': return `你已经读过一部分，隔了 ${reason.days_since_last_read} 天，可以从上次位置回来。`;
    case 'unstarted_in_library': return '它还没有阅读记录，适合从第一页开始认识它。';
  }
}

function footprintLevel(readingMs: number, maxReadingMs: number): number {
  if (readingMs <= 0 || maxReadingMs <= 0) return 0;
  const ratio = readingMs / maxReadingMs;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function footprintLevelClass(level: number): string {
  switch (level) {
    case 1: return 'bg-[#c3d6cf]';
    case 2: return 'bg-[#8fb3aa]';
    case 3: return 'bg-[#5c9086]';
    case 4: return 'bg-[#2e6e67]';
    default: return 'bg-[#e3e9e5]';
  }
}

function scopeTabClass(selected: boolean): string {
  return `border-b px-2 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-[#c5a76b] ${selected ? 'border-[#2e6e67] text-[#18272c]' : 'border-transparent text-[#687571] hover:border-[#2e6e67] hover:text-[#18272c]'}`;
}
