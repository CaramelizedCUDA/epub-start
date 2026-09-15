import { useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  cancelSearchIndex,
  getSearchIndexStatus,
  listSeries,
} from '../../lib/tauri';
import type { BookSummary, SearchIndexStatus, SearchResult, Series } from '../../types/models';
import { cancelOwnedSearchTask, searchSeriesChapters } from './seriesSearch';

interface ArchiveSearchPageProps {
  books: BookSummary[];
  onBack: () => void;
  onOpenBook: (book: BookSummary, initialHref?: string) => void;
}

type SearchScope = 'library' | 'series';

export function ArchiveSearchPage({ books, onBack, onOpenBook }: ArchiveSearchPageProps) {
  const [scope, setScope] = useState<SearchScope>('library');
  const [query, setQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [series, setSeries] = useState<Series[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState('');
  const [indexStatus, setIndexStatus] = useState<SearchIndexStatus | null>(null);
  const [contentResults, setContentResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const searchRunRef = useRef(0);
  const ownedTaskRef = useRef<string | null>(null);
  const retireSearch = () => {
    ++searchRunRef.current;
    const owned = ownedTaskRef.current;
    ownedTaskRef.current = null;
    if (owned) cancelOwnedSearchTask(owned);
  };
  useEffect(() => () => {
    ++searchRunRef.current;
    const owned = ownedTaskRef.current;
    ownedTaskRef.current = null;
    if (owned) cancelOwnedSearchTask(owned);
  }, []);

  const bookById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books]);
  const metadataResults = useMemo(() => {
    if (!searchedQuery) return [];
    const needle = searchedQuery.toLocaleLowerCase();
    return books.filter((book) => [book.title, ...book.authors].some((field) => field.toLocaleLowerCase().includes(needle)));
  }, [books, searchedQuery]);
  const selectedSeries = series.find((item) => item.id === selectedSeriesId) ?? null;

  useEffect(() => {
    let disposed = false;
    void listSeries()
      .then((nextSeries) => {
        if (disposed) return;
        setSeries(nextSeries);
        setSelectedSeriesId((current) => nextSeries.some((item) => item.id === current) ? current : (nextSeries[0]?.id ?? ''));
      })
      .catch((err: unknown) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!selectedSeriesId) {
      setIndexStatus(null);
      return;
    }
    let disposed = false;
    const runId = searchRunRef.current;
    setIndexStatus(null);
    void getSearchIndexStatus({ seriesId: selectedSeriesId })
      .then((status) => { if (!disposed && runId === searchRunRef.current) setIndexStatus(status); })
      .catch((err: unknown) => { if (!disposed && runId === searchRunRef.current) setError(err instanceof Error ? err.message : String(err)); });
    return () => { disposed = true; };
  }, [selectedSeriesId]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuery = query.trim();
    retireSearch();
    setIsSearching(false);
    setTaskId(null);
    if (!trimmedQuery || [...trimmedQuery].length > 200) {
      setError('请输入 1–200 个字符的搜索内容。');
      return;
    }
    setError(null);
    setSearchedQuery(trimmedQuery);
    setContentResults([]);
    if (scope === 'library') return;
    if (!selectedSeriesId) {
      setError('还没有可搜索的系列，请先在系列页建立关系。');
      return;
    }

    const runId = searchRunRef.current + 1;
    searchRunRef.current = runId;
    setIsSearching(true);
    setTaskId(null);
    let lastStatus: SearchIndexStatus | null = null;
    try {
      const results = await searchSeriesChapters(selectedSeriesId, trimmedQuery, {
        isCurrent: () => runId === searchRunRef.current,
        onTask: (owned) => { ownedTaskRef.current = owned; setTaskId(owned); },
        onStatus: (status) => { lastStatus = status; setIndexStatus(status); },
      });
      if (runId === searchRunRef.current && results !== null) setContentResults(results);
    } catch (err) {
      if (runId === searchRunRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (runId === searchRunRef.current) {
        // A timed-out or temporarily unavailable poll does not abandon its known task.
        const finished = lastStatus as SearchIndexStatus | null;
        if (finished?.status === 'ready' || finished?.status === 'error') ownedTaskRef.current = null;
        setIsSearching(false);
        setTaskId(ownedTaskRef.current);
      }
    }
  };

  const handleCancel = async () => {
    if (!taskId) return;
    const cancelledTask = taskId;
    const runId = ++searchRunRef.current;
    ownedTaskRef.current = null;
    setIsSearching(false);
    setTaskId(null);
    setError(null);
    try {
      await cancelSearchIndex({ taskId: cancelledTask });
      if (runId !== searchRunRef.current) return;
      const status = await getSearchIndexStatus({ seriesId: selectedSeriesId });
      if (runId === searchRunRef.current) setIndexStatus(status);
    } catch (err) {
      if (runId === searchRunRef.current) setError(err instanceof Error ? err.message : String(err));
    }
  };

  const changeSeries = (seriesId: string) => {
    retireSearch();
    setSelectedSeriesId(seriesId);
    setSearchedQuery('');
    setContentResults([]);
    setError(null);
    setIsSearching(false);
    setTaskId(null);
  };

  const switchScope = (nextScope: SearchScope) => {
    if (scope === nextScope) return;
    retireSearch();
    setScope(nextScope);
    setSearchedQuery('');
    setContentResults([]);
    setError(null);
    setIsSearching(false);
    setTaskId(null);
  };

  return (
    <section className="pt-8 lg:pt-10" aria-labelledby="archive-search-title">
      <div className="border-t-[3px] border-[#2e6e67] pt-5">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d0d9d4] pb-5">
          <div>
            <button type="button" onClick={onBack} className="mb-4 border-b border-transparent text-xs text-[#2e6e67] transition hover:border-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">← 藏书</button>
            <p className="mb-1 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[#2e6e67]">Search the archive</p>
            <h1 id="archive-search-title" className="font-serif text-4xl font-medium tracking-[-0.05em] text-[#18272c] sm:text-5xl">搜索</h1>
          </div>
          <p className="max-w-sm text-right text-sm leading-relaxed text-[#687571]">书名和作者即时搜索；系列正文搜索只在选定系列的本地索引中进行。</p>
        </div>
      </div>

      {error && <div className="mt-5 border-l-[3px] border-[#a54b45] bg-[#fff8f6] px-5 py-4" role="alert"><p className="break-words text-sm leading-relaxed text-[#7c3834]">{error}</p></div>}

      <div className="mt-7 border-t-[3px] border-[#c5a76b] bg-[#f9fbf7] p-4 sm:p-5">
        <div className="flex flex-wrap gap-2 border-b border-[#d0d9d4] pb-4" role="tablist" aria-label="搜索范围">
          <button type="button" role="tab" aria-selected={scope === 'library'} onClick={() => switchScope('library')} className={`border-b-2 px-1 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c5a76b] ${scope === 'library' ? 'border-[#2e6e67] text-[#18272c]' : 'border-transparent text-[#687571]'}`}>藏书信息</button>
          <button type="button" role="tab" aria-selected={scope === 'series'} onClick={() => switchScope('series')} className={`border-b-2 px-1 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c5a76b] ${scope === 'series' ? 'border-[#2e6e67] text-[#18272c]' : 'border-transparent text-[#687571]'}`}>系列正文</button>
        </div>
        <form onSubmit={(event) => void handleSubmit(event)} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label htmlFor="archive-search-query" className="min-w-0 flex-1">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[#687571]">{scope === 'library' ? '书名 / 作者' : '系列内正文'}</span>
            <input id="archive-search-query" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={scope === 'library' ? '输入书名或作者' : '输入章节中的词语'} className="mt-1 w-full border-b border-[#9fb4ac] bg-transparent px-1 py-2 font-serif text-xl text-[#18272c] outline-none placeholder:text-[#9aa7a1] focus:border-[#2e6e67]" />
          </label>
          {scope === 'series' && <label className="sm:w-56"><span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[#687571]">搜索范围</span><select value={selectedSeriesId} onChange={(event) => changeSeries(event.target.value)} className="mt-1 w-full border border-[#d0d9d4] bg-[#edf1ee] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[#c5a76b]"><option value="">选择系列</option>{series.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <button type="submit" disabled={isSearching} className="min-h-10 border border-[#18272c] bg-[#18272c] px-5 py-2 text-sm text-[#f9fbf7] transition hover:bg-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:opacity-50">{isSearching ? '索引中…' : '搜索'}</button>
        </form>
        {scope === 'series' && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#d0d9d4] pt-3 text-xs text-[#687571]">
            <span>{selectedSeries ? `“${selectedSeries.name}”的正文索引` : '选择系列后建立正文索引'}</span>
            {indexStatus && <IndexStatus status={indexStatus} isSearching={Boolean(taskId)} onCancel={() => void handleCancel()} />}
          </div>
        )}
      </div>

      {scope === 'series' && contentResults.length >= 50 && (
        <p className="mt-4 text-sm text-[#687571]" role="status">最多显示 50 条命中，请缩小关键词范围。</p>
      )}
      <section className="mt-8" aria-live="polite">
        {scope === 'library' ? (
          <SearchResultHeader count={metadataResults.length} label={searchedQuery ? `藏书信息 · “${searchedQuery}”` : '输入关键词开始查找'}>
            {searchedQuery && metadataResults.length === 0 ? <EmptySearch query={searchedQuery} scope="藏书信息" /> : metadataResults.map((book) => <MetadataResult key={book.id} book={book} onOpen={() => onOpenBook(book)} />)}
          </SearchResultHeader>
        ) : (
          <SearchResultHeader count={contentResults.length} label={searchedQuery ? `${selectedSeries?.name ?? '系列正文'} · “${searchedQuery}”` : '系列正文搜索结果'}>
            {searchedQuery && !isSearching && contentResults.length === 0 ? <EmptySearch query={searchedQuery} scope={selectedSeries?.name ?? '当前系列'} /> : contentResults.map((result) => <ContentResult key={`${result.book_id}-${result.href}-${result.spine_index}`} result={result} book={bookById.get(result.book_id) ?? null} onOpen={onOpenBook} />)}
          </SearchResultHeader>
        )}
      </section>
    </section>
  );
}

function IndexStatus({ status, isSearching, onCancel }: { status: SearchIndexStatus; isSearching: boolean; onCancel: () => void }) {
  const label = status.status === 'ready' ? (status.error_detail ? '部分就绪' : '已就绪') : status.status === 'building' ? '建立中' : status.status === 'error' ? '有错误' : '待建立';
  return (
    <span className="flex flex-wrap items-center gap-3">
      <span>{label} · {status.indexed_documents}/{status.total_documents || '—'} 章节</span>
      {status.error_detail && status.status !== 'building' && <span className="max-w-md text-[#8b7137]" title={status.error_detail}>部分章节可能不可搜索</span>}
      {isSearching && status.status === 'building' && <button type="button" onClick={onCancel} className="border-b border-[#a54b45] text-[#a54b45] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">取消索引</button>}
    </span>
  );
}

function SearchResultHeader({ count, label, children }: { count: number; label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[#d0d9d4]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d0d9d4] py-3"><span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[#687571]">{label}</span><span className="font-mono text-sm text-[#5c7397]">{count} 项</span></div>
      <div className="divide-y divide-[#d0d9d4]">{children}</div>
    </div>
  );
}

function MetadataResult({ book, onOpen }: { book: BookSummary; onOpen: () => void }) {
  return (
    <article className="grid gap-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <button type="button" onClick={onOpen} className="justify-self-start focus:outline-none focus:ring-2 focus:ring-[#c5a76b]"><div className="h-20 w-14 overflow-hidden"><span className="sr-only">打开 {book.title}</span><span className="block h-full w-full"><MiniCover book={book} /></span></div></button>
      <div className="min-w-0"><h2 className="truncate font-serif text-xl text-[#18272c]">{book.title}</h2><p className="mt-1 truncate text-sm text-[#687571]">{book.authors.length > 0 ? book.authors.join(' · ') : '作者信息未提供'}</p></div>
      <button type="button" onClick={onOpen} className="justify-self-start border-b border-[#2e6e67] py-1 text-xs text-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] sm:justify-self-end">打开这本书 →</button>
    </article>
  );
}

function ContentResult({ result, book, onOpen }: { result: SearchResult; book: BookSummary | null; onOpen: (book: BookSummary, initialHref?: string) => void }) {
  return (
    <article className="grid gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0"><p className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-[#2e6e67]">{book?.title ?? '书籍已不在书架'} · {result.title || result.href}</p><p className="mt-2 text-sm leading-relaxed text-[#18272c]">{result.snippet}</p><p className="mt-2 truncate text-xs text-[#687571]">章节来源：{result.href} · 跳转精度：章节级（非精确 CFI）</p></div>
      {book ? <button type="button" onClick={() => onOpen(book, result.href)} className="justify-self-start border-b border-[#2e6e67] py-1 text-xs text-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] sm:justify-self-end">打开命中章节 →</button> : <span className="text-xs text-[#a54b45]">无法打开</span>}
    </article>
  );
}

function EmptySearch({ query, scope }: { query: string; scope: string }) {
  return <div className="border-l-[3px] border-[#c5a76b] bg-[#f9fbf7] px-5 py-6 text-sm text-[#687571]">没有在{scope}中找到“{query}”。查询范围和关键词已保留，可以直接修改后重试。</div>;
}

function MiniCover({ book }: { book: BookSummary }) {
  return <div className="relative h-full w-full overflow-hidden bg-[#4d6188] p-1.5 text-[#f8faf5]"><span className="font-mono text-[0.45rem]">{book.format.toUpperCase()}</span>{book.cover_cache_path ? <img src={convertFileSrc(book.cover_cache_path)} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <span className="absolute bottom-1 left-1 right-1 font-serif text-xs leading-tight">{book.title}</span>}<span className="absolute bottom-0 right-0 top-0 w-0.5 bg-white/30" aria-hidden="true" /></div>;
}
