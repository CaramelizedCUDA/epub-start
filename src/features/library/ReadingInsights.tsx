import { useEffect, useState } from 'react';
import { getLibraryReadingOverview } from '../../lib/tauri';
import { bookDisplayTitle } from './bookDisplay';
import { useReadingInsightsStore, currentLocalYear } from '../../stores/readingInsightsStore';
import type {
  BookSummary,
  ContinueReadingItem,
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
  { value: 'day', label: '今日' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'quarter', label: '本季度' },
];

// Folding the summary never stops the real overview query or hides a query failure.
export function LibraryInsights({ onOpenBook, period, recommendationsEnabled }: ReadingInsightsProps) {
  const [expanded, setExpanded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const overview = useReadingInsightsStore((state) => state.overview);
  const overviewLoading = useReadingInsightsStore((state) => state.overviewLoading);
  const overviewError = useReadingInsightsStore((state) => state.overviewError);
  const loadOverview = useReadingInsightsStore((state) => state.loadOverview);
  const clearOverviewError = useReadingInsightsStore((state) => state.clearOverviewError);
  const currentOverview = overview?.duration.period === period ? overview : null;
  useEffect(() => { void loadOverview(period); }, [loadOverview, period]);
  const retry = () => { clearOverviewError(); setRetryKey((key) => key + 1); void loadOverview(period); };

  return (
    <div className="space-y-[18px]">
      <section className="overflow-hidden rounded-[19px] border border-line bg-surface" aria-label="阅读洞察" aria-busy={overviewLoading}>
        <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls="reading-insights-details" className="flex h-[74px] w-full items-center gap-3 px-5 text-left focus-visible:ring-2 focus-visible:ring-accent">
          <span className="flex h-6 shrink-0 items-end gap-1" aria-hidden="true"><i className="h-2.5 w-[3px] rounded bg-accent" /><i className="h-6 w-[3px] rounded bg-accent" /><i className="h-4 w-[3px] rounded bg-accent" /></span>
          <strong className="whitespace-nowrap text-[15px] font-semibold sm:text-base">{currentOverview ? `${durationPeriodLabel(period)} ${formatDuration(currentOverview.duration.total_reading_ms)}` : overviewLoading ? '正在读取…' : '阅读时长'}</strong>
          {recommendationsEnabled && currentOverview && <span className="whitespace-nowrap text-sm text-muted">· {currentOverview.recommendations.length} 条推荐</span>}
          <span className="ml-auto text-muted" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
        </button>
        {overviewError && <div className="px-5 pb-4"><InlineError message={overviewError} onRetry={retry} /></div>}
        {expanded && <div id="reading-insights-details" className="border-t border-line px-5 pb-4 pt-[18px]">
          {currentOverview ? <RecentReadingChart summary={currentOverview.duration} retryKey={retryKey} /> : <DurationSkeleton />}
          {recommendationsEnabled && <RecommendationPanel recommendations={currentOverview?.recommendations ?? []} isLoading={overviewLoading && !currentOverview} error={overviewError} onOpenBook={onOpenBook} />}
        </div>}
      </section>
      <ContinueReadingWidget item={currentOverview?.continue_reading ?? null} isLoading={overviewLoading && !currentOverview} error={overviewError} onOpenBook={onOpenBook} />
    </div>
  );
}

// 后端的 week 是自然周，不是“最近 7 天”。按真实月级日桶取滚动窗口，
// 跨月时再读取前一个月；不能将自然周换个标题或把缺少的日期伪造成实测。
function RecentReadingChart({ summary, retryKey }: { summary: ReadingDurationSummary; retryKey: number }) {
  const [days, setDays] = useState<Array<{ date: string; readingMs: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    setDays(null);
    setError(null);
    const dates = recentLocalDates();
    const months = Array.from(new Set(dates.map((date) => date.slice(0, 7))));
    const requests = months.map(async (month) => {
      // 本地重试必须重取数据，不能永久复用导致缺桶错误的那份响应。
      if (retry === 0 && summary.period === 'month' && summary.range_start_local_date.startsWith(month)) return summary;
      const result = await getLibraryReadingOverview({ period: 'month', anchorLocalDate: `${month}-01`, utcOffsetMinutes: -new Date().getTimezoneOffset() });
      return result.duration;
    });
    void Promise.all(requests).then((summaries) => {
      if (disposed) return;
      const values = new Map(summaries.flatMap((item) => item.buckets.filter((bucket) => bucket.kind === 'day').map((bucket) => [bucket.start_local_date, Math.max(0, bucket.reading_ms)] as const)));
      // 契约返回完整日桶。缺桶是数据不可用，不把不完整响应显示为零分钟。
      if (dates.some((date) => !values.has(date))) throw new Error('最近 7 天的阅读记录暂时不完整，请重试。');
      setDays(dates.map((date) => ({ date, readingMs: values.get(date)! })));
    }).catch((err: unknown) => {
      if (disposed) return;
      const message = err instanceof Error ? err.message : String(err);
      // 与洞察 store 遵守同一展示契约：内部错误不直接作为用户文案。
      setError(message.startsWith('INTERNAL_ERROR:') ? '阅读记录暂时不可用，请重试。' : message);
    });
    return () => { disposed = true; };
  }, [summary, retryKey, retry]);

  if (error) return <InlineError message={error} onRetry={() => setRetry((key) => key + 1)} />;
  if (!days) return <DurationSkeleton />;
  const max = Math.max(...days.map((day) => day.readingMs), 1);
  return (
    <section aria-label="最近 7 天阅读时长">
      <div className="mb-3 flex items-center justify-between text-xs text-muted"><span>最近 7 天</span><span>{formatDurationRange(days[0].date, days[6].date)}</span></div>
      <ol className="grid h-[114px] grid-cols-7 gap-2 border-b border-line pb-7">
        {days.map((day, index) => (
          <li key={day.date} className="relative flex min-w-0 flex-col items-center justify-end" aria-label={`${day.date} ${formatDuration(day.readingMs)}`} title={`${day.date} · ${formatDuration(day.readingMs)}`}>
            {/* 小标签限制在本列内；完整日期和时长保留在无障碍描述及悬停提示中。 */}
            {day.readingMs > 0 && <span aria-hidden="true" className="mb-1 max-w-full truncate text-[10px] tabular-nums text-ink">{formatChartDuration(day.readingMs)}</span>}
            <span aria-hidden="true" className={day.readingMs > 0 ? 'w-full max-w-12 rounded-t-md rounded-b-sm bg-accent' : 'h-0.5 w-3.5 bg-line'} style={day.readingMs > 0 ? { height: `${Math.max(2, day.readingMs / max * 64)}px` } : undefined} />
            <span className={`absolute -bottom-6 text-xs ${index === 6 ? 'font-semibold text-accent' : 'text-muted'}`}>{['日', '一', '二', '三', '四', '五', '六'][new Date(`${day.date}T12:00:00`).getDay()]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function recentLocalDates(): string[] {
  const now = new Date();
  // 用本地日历取今天，再以 UTC 日历递减，避免 DST 日只有 23/25 小时的偏移。
  const end = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Array.from({ length: 7 }, (_, index) => new Date(end - (6 - index) * 86_400_000).toISOString().slice(0, 10));
}

// 既有 progression 来自章内页码，不能当成全书完成比例；这里只展示保存位置是否存在。
function ContinueReadingWidget({ item, isLoading, error, onOpenBook }: {
  item: ContinueReadingItem | null;
  isLoading: boolean;
  error: string | null;
  onOpenBook: (book: BookSummary) => void;
}) {
  if (isLoading) return <ContinueReadingSkeleton />;
  if (error && !item) return <section className="rounded-[19px] border border-line bg-surface p-4" aria-label="继续阅读"><InlineError message={error} /></section>;
  if (!item) return <section className="rounded-[19px] border border-line bg-surface p-4" aria-label="继续阅读"><h2 className="font-reading text-lg">继续阅读</h2><p className="mt-1 text-xs text-muted">从藏书中打开一本，下一次就从这里继续。</p></section>;

  const display = bookDisplayTitle(item.book.title);
  const savedPositionLabel = item.progress?.location_cfi?.trim() ? '已保存阅读位置' : '尚无保存位置';
  return (
    <button type="button" onClick={() => onOpenBook(item.book)} className="grid w-full grid-cols-[76px_minmax(0,1fr)] items-center gap-4 rounded-[19px] border border-line bg-surface px-4 py-3.5 text-left" aria-label={`继续阅读：${item.book.title}，${savedPositionLabel}`} title={`上次阅读：${formatLastRead(item.last_read_at)}`}>
      <BookCover book={item.book} size="continue" />
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-accent">继续阅读</span>
        <span className="mt-1.5 line-clamp-2 font-reading text-[23px] font-medium leading-tight text-ink">{display.heading}</span>
        {display.subtitle && <span className="mt-1 line-clamp-2 font-reading text-[13px] leading-[1.35] text-muted">{display.subtitle}</span>}
        <span className="mt-2.5 block text-xs text-muted">{savedPositionLabel}</span>
      </span>
    </button>
  );
}

function RecommendationPanel({ recommendations, isLoading, error, onOpenBook }: {
  recommendations: ReadingRecommendation[];
  isLoading: boolean;
  error: string | null;
  onOpenBook: (book: BookSummary) => void;
}) {
  return <section className="mt-[18px]" aria-labelledby="recommendations-title">
    <h2 id="recommendations-title" className="mb-1 text-sm font-medium text-ink">接下来读什么</h2>
    {isLoading ? <RecommendationSkeleton /> : error && recommendations.length === 0 ? <p className="py-3 text-xs text-muted">推荐暂时不可用，请重试上方阅读洞察。</p> : recommendations.length ? recommendations.map((recommendation) => <RecommendationItem key={recommendation.book.id} recommendation={recommendation} onOpenBook={onOpenBook} />) : <p className="py-3 text-xs text-muted">书架暂时没有推荐。</p>}
  </section>;
}

function RecommendationItem({ recommendation, onOpenBook }: { recommendation: ReadingRecommendation; onOpenBook: (book: BookSummary) => void }) {
  return (
    <button type="button" onClick={() => onOpenBook(recommendation.book)} className="grid w-full grid-cols-[45px_minmax(0,1fr)_18px] items-center gap-3 border-b border-line py-2.5 text-left last:border-b-0" title={recommendationReasonText(recommendation.reason)}>
      <BookCover book={recommendation.book} size="tiny" />
      <span className="min-w-0"><span className="block text-xs font-semibold leading-5 text-accent">{recommendationReasonLabel(recommendation.reason)}</span><span className="line-clamp-2 font-reading text-[15px] leading-5 text-ink">{recommendation.book.title}</span></span>
      <span className="text-muted" aria-hidden="true">›</span>
    </button>
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
    <section className="border-t border-line pt-6" aria-label="阅读足迹数据" aria-busy={footprintLoading}>
      <div className="flex justify-end border-b border-line pb-6">
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
      <strong className="font-mono text-3xl font-medium tracking-[-0.06em] text-ink">{formatDuration(footprint.totals.reading_ms)}</strong>
      <span className="text-xs text-muted">
        <b className="font-semibold text-ink">{footprint.totals.active_days}</b> 个阅读日 · <b className="font-semibold text-ink">{footprint.totals.distinct_books}</b> 本书 · <b className="font-semibold text-ink">{footprint.totals.distinct_series}</b> 个系列
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
    <section className="border-t border-line py-5" aria-labelledby={showTitle ? `footprint-year-${year.year}` : undefined}>
      {showTitle && <h3 id={`footprint-year-${year.year}`} className="mb-4 font-mono text-sm tracking-[0.1em] text-accent">{year.year}</h3>}
      <div className="min-w-0 overflow-x-auto pb-1">
        <div className="min-w-[42rem]">
          <div className="grid grid-cols-12 gap-2 px-1 font-mono text-[0.62rem] text-muted" aria-hidden="true">
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
  return <span className={`block min-h-3 min-w-2 border border-transparent ${footprintLevelClass(level)} focus:border-ink focus:outline-none`} title={label} aria-label={label} tabIndex={0} />;
}

function FootprintLegend() {
  return (
    <div className="flex items-center justify-end gap-1.5 pt-3 text-[0.68rem] text-muted" aria-label="热力图图例">
      <span className="mr-1">没有记录</span>
      {[1, 2, 3, 4].map((level) => <span key={level} className={`h-2.5 w-2.5 ${footprintLevelClass(level)}`} aria-hidden="true" />)}
      <span className="ml-1">更久</span>
    </div>
  );
}

function EmptyFootprint() {
  return (
    <div className="border-l border-accent bg-surface px-5 py-6">
      <p className="font-reading text-xl text-ink">还没有阅读足迹</p>
      <p className="mt-1 text-sm text-muted">当你在 Reader 中读过一段时间，这里会留下按日期整理的记录。</p>
    </div>
  );
}

function BookCover({ book, size }: { book: BookSummary; size: 'continue' | 'tiny' }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const dimensions = size === 'continue' ? 'h-[108px] w-[76px]' : 'h-16 w-[45px]';
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-md bg-subtle text-ink shadow-sm ${dimensions}`}>
      {book.cover_cache_path && !coverFailed ? <img src={convertFileSrc(book.cover_cache_path)} alt="" onError={() => setCoverFailed(true)} className="absolute inset-0 h-full w-full object-cover" /> : <span className="absolute inset-0 flex items-center justify-center px-2 text-center font-reading text-xs leading-relaxed line-clamp-3">{book.title}</span>}
      <span className="absolute bottom-0 left-0 top-0 w-1 bg-ink/5" aria-hidden="true" />
    </div>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="my-5 border-l border-danger bg-surface px-5 py-4" role="alert">
      <p className="text-sm text-danger">{message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="mt-3 border-b border-danger text-xs text-danger focus:outline-none focus:ring-2 focus:ring-accent">重试</button>}
    </div>
  );
}

function DurationSkeleton() {
  return <div className="h-36 animate-pulse border-b border-line" aria-label="正在读取最近 7 天"><div className="h-3 w-20 rounded bg-subtle" /><div className="mt-5 grid h-20 grid-cols-7 items-end gap-2">{[2, 4, 3, 6, 2, 5, 4].map((height, index) => <span key={index} className="rounded-t bg-subtle" style={{ height: `${height * 10}px` }} />)}</div></div>;
}

function ContinueReadingSkeleton() {
  return <div className="grid h-[138px] grid-cols-[76px_minmax(0,1fr)] gap-4 rounded-[19px] border border-line bg-surface p-4" aria-label="正在读取继续阅读"><span className="rounded bg-subtle" /><div className="space-y-3 pt-1"><span className="block h-3 w-16 bg-subtle" /><span className="block h-4 w-4/5 bg-subtle" /><span className="block h-3 w-3/5 bg-subtle" /><span className="block h-1 w-full bg-subtle" /></div></div>;
}

function RecommendationSkeleton() {
  return <div>{[1, 2].map((item) => <div key={item} className="grid grid-cols-[45px_minmax(0,1fr)] gap-3 border-b border-line py-2.5"><span className="h-16 rounded bg-subtle" /><div className="space-y-2 pt-2"><span className="block h-3 w-24 bg-subtle" /><span className="block h-4 w-4/5 bg-subtle" /></div></div>)}</div>;
}

function FootprintSkeleton() {
  return <div className="space-y-4 py-6"><span className="block h-9 w-36 bg-subtle" /><span className="block h-36 w-full bg-subtle" /></div>;
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes} 分钟`;
  return remainingMinutes ? `${hours} 小时 ${remainingMinutes} 分钟` : `${hours} 小时`;
}

// 七列手机图表不能容纳“1 小时 30 分钟”；换成等价分钟，不对真实时长再取近似值。
function formatChartDuration(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  return minutes >= 60 ? `${minutes}分` : formatDuration(milliseconds);
}

function durationPeriodLabel(period: ReadingOverviewPeriod): string {
  return PERIODS.find((item) => item.value === period)?.label ?? period;
}

function formatDurationRange(startLocalDate: string, endLocalDate: string): string {
  const sameYear = startLocalDate.slice(0, 4) === endLocalDate.slice(0, 4);
  const start = formatLocalDate(startLocalDate, !sameYear);
  const end = formatLocalDate(endLocalDate, !sameYear);
  if (startLocalDate === endLocalDate) return start;
  return `${start} – ${end}`;
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

function recommendationReasonLabel(reason: ReadingRecommendationReason): string {
  switch (reason.kind) {
    case 'next_in_series': return '系列下一本';
    case 'unfinished_return': return `${reason.days_since_last_read} 天前读到一半`;
    case 'unstarted_in_library': return '还没开始读';
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
    case 1: return 'bg-accent/25';
    case 2: return 'bg-accent/45';
    case 3: return 'bg-accent/70';
    case 4: return 'bg-accent';
    default: return 'bg-subtle';
  }
}

function scopeTabClass(selected: boolean): string {
  return `border-b px-2 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-accent ${selected ? 'border-accent text-ink' : 'border-transparent text-muted hover:border-accent hover:text-ink'}`;
}
