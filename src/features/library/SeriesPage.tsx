import { useEffect, useMemo, useState } from 'react';
import {
  clearBookSeries,
  createSeries,
  deleteSeries,
  listSeries,
  listSeriesBooks,
  reorderSeriesBooks,
  setBookSeries,
  updateSeries,
} from '../../lib/tauri';
import type { BookSeries, BookSummary, Series } from '../../types/models';
import { LibraryBookCover } from './LibraryBookCover';

interface SeriesPageProps {
  books: BookSummary[];
  onBack: () => void;
  onOpenBook: (book: BookSummary) => void;
}

export function SeriesPage({ books, onBack, onOpenBook }: SeriesPageProps) {
  const [series, setSeries] = useState<Series[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState('');
  const [assignments, setAssignments] = useState<BookSeries[]>([]);
  const [newSeriesName, setNewSeriesName] = useState('');
  const [newVolumeLabel, setNewVolumeLabel] = useState('');
  const [seriesNameDraft, setSeriesNameDraft] = useState('');
  const [volumeDrafts, setVolumeDrafts] = useState<Record<string, string>>({});
  const [isLoadingSeries, setIsLoadingSeries] = useState(true);
  const [isLoadingBooks, setIsLoadingBooks] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedSeries = series.find((item) => item.id === selectedSeriesId) ?? null;
  const assignedBookIds = useMemo(() => new Set(assignments.map((item) => item.book_id)), [assignments]);
  const assignedBooks = useMemo(
    () => assignments.map((assignment) => ({ assignment, book: books.find((item) => item.id === assignment.book_id) ?? null })),
    [assignments, books],
  );
  const availableBooks = useMemo(
    () => books.filter((book) => !assignedBookIds.has(book.id)),
    [assignedBookIds, books],
  );

  useEffect(() => {
    let disposed = false;
    setIsLoadingSeries(true);
    setError(null);
    void listSeries()
      .then((nextSeries) => {
        if (disposed) return;
        setSeries(nextSeries);
        setSelectedSeriesId((current) => nextSeries.some((item) => item.id === current) ? current : (nextSeries[0]?.id ?? ''));
      })
      .catch((err: unknown) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!disposed) setIsLoadingSeries(false);
      });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    setSeriesNameDraft(selectedSeries?.name ?? '');
  }, [selectedSeries]);

  useEffect(() => {
    if (!selectedSeriesId) {
      setAssignments([]);
      setVolumeDrafts({});
      return;
    }
    let disposed = false;
    setIsLoadingBooks(true);
    setError(null);
    void listSeriesBooks({ seriesId: selectedSeriesId })
      .then((nextAssignments) => {
        if (disposed) return;
        setAssignments(nextAssignments);
        setVolumeDrafts(Object.fromEntries(nextAssignments.map((item) => [item.book_id, item.volume_label])));
      })
      .catch((err: unknown) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!disposed) setIsLoadingBooks(false);
      });
    return () => { disposed = true; };
  }, [selectedSeriesId]);

  const handleCreateSeries = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newSeriesName.trim();
    if (!name) return;
    setBusyKey('create-series');
    setError(null);
    try {
      const created = await createSeries({ series: { name } });
      setSeries((current) => [...current, created]);
      setSelectedSeriesId(created.id);
      setNewSeriesName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleRenameSeries = async () => {
    if (!selectedSeries) return;
    const name = seriesNameDraft.trim();
    if (!name || name === selectedSeries.name) return;
    setBusyKey('rename-series');
    setError(null);
    try {
      const updated = await updateSeries({ series: { id: selectedSeries.id, name } });
      setSeries((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteSeries = async () => {
    if (!selectedSeries || !window.confirm(`删除系列“${selectedSeries.name}”？书籍不会被删除。`)) return;
    setBusyKey('delete-series');
    setError(null);
    try {
      await deleteSeries({ seriesId: selectedSeries.id });
      const nextSeries = series.filter((item) => item.id !== selectedSeries.id);
      setSeries(nextSeries);
      setSelectedSeriesId(nextSeries[0]?.id ?? '');
      setAssignments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleAssignBook = async (bookId: string) => {
    if (!selectedSeriesId || !bookId) return;
    const nextSortOrder = assignments.reduce((max, item) => Math.max(max, item.sort_order), -1) + 1;
    setBusyKey(`assign-${bookId}`);
    setError(null);
    try {
      const assignment = await setBookSeries({
        assignment: {
          book_id: bookId,
          series_id: selectedSeriesId,
          volume_label: newVolumeLabel.trim(),
          sort_order: nextSortOrder,
        },
      });
      setAssignments((current) => [...current.filter((item) => item.book_id !== bookId), assignment].sort((left, right) => left.sort_order - right.sort_order));
      setVolumeDrafts((current) => ({ ...current, [bookId]: assignment.volume_label }));
      setNewVolumeLabel('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemoveBook = async (bookId: string) => {
    setBusyKey(`remove-${bookId}`);
    setError(null);
    try {
      await clearBookSeries({ bookId });
      setAssignments((current) => current.filter((item) => item.book_id !== bookId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveVolume = async (assignment: BookSeries) => {
    if (!selectedSeriesId) return;
    const volumeLabel = volumeDrafts[assignment.book_id]?.trim() ?? '';
    if (volumeLabel === assignment.volume_label) return;
    setBusyKey(`volume-${assignment.book_id}`);
    setError(null);
    try {
      const updated = await setBookSeries({ assignment: { ...assignment, volume_label: volumeLabel } });
      setAssignments((current) => current.map((item) => item.book_id === updated.book_id ? updated : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleMoveBook = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (!selectedSeriesId || targetIndex < 0 || targetIndex >= assignments.length) return;
    const nextAssignments = [...assignments];
    [nextAssignments[index], nextAssignments[targetIndex]] = [nextAssignments[targetIndex], nextAssignments[index]];
    const positions = nextAssignments.map((item, position) => ({ book_id: item.book_id, sort_order: position }));
    setBusyKey('reorder-series');
    setError(null);
    try {
      setAssignments(await reorderSeriesBooks({ seriesId: selectedSeriesId, positions }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="pt-8 lg:pt-10" aria-labelledby="series-page-title">
      <div className="border-t-[3px] border-[#2e6e67] pt-5">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d0d9d4] pb-5">
          <div>
            <button type="button" onClick={onBack} className="mb-4 border-b border-transparent text-xs text-[#2e6e67] transition hover:border-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">← 藏书</button>
            <p className="mb-1 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[#2e6e67]">Collection relationships</p>
            <h1 id="series-page-title" className="font-serif text-4xl font-medium tracking-[-0.05em] text-[#18272c] sm:text-5xl">系列</h1>
          </div>
          <p className="max-w-sm text-right text-sm leading-relaxed text-[#687571]">把同一系列的书放在一起，并留下卷册顺序。一本书同时只归属于一个系列。</p>
        </div>
      </div>

      {error && <InlineError message={error} />}

      <div className="mt-7 grid gap-8 xl:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="border-t-[3px] border-[#c5a76b] bg-[#f9fbf7]" aria-label="系列列表">
          <div className="flex items-center justify-between border-b border-[#d0d9d4] px-4 py-4">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[#687571]">Series index</span>
            <span className="font-mono text-sm text-[#5c7397]">{series.length}</span>
          </div>
          {isLoadingSeries ? (
            <p className="px-4 py-5 text-sm text-[#687571]">正在读取系列…</p>
          ) : series.length === 0 ? (
            <p className="px-4 py-5 text-sm leading-relaxed text-[#687571]">还没有系列。可以先从下面建立一个。</p>
          ) : (
            <div className="divide-y divide-[#d0d9d4]">
              {series.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedSeriesId(item.id)}
                  className={`flex min-h-12 w-full items-center justify-between gap-3 border-l-[3px] px-4 py-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#c5a76b] ${selectedSeriesId === item.id ? 'border-[#2e6e67] bg-[#edf1ee] text-[#18272c]' : 'border-transparent text-[#687571] hover:bg-[#edf1ee] hover:text-[#18272c]'}`}
                >
                  <span className="truncate">{item.name}</span>
                  {selectedSeriesId === item.id && <span className="font-mono text-[0.6rem] text-[#2e6e67]">OPEN</span>}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={(event) => void handleCreateSeries(event)} className="border-t border-[#d0d9d4] p-4">
            <label htmlFor="new-series-name" className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[#687571]">新建系列</label>
            <div className="mt-2 flex gap-2">
              <input id="new-series-name" value={newSeriesName} onChange={(event) => setNewSeriesName(event.target.value)} placeholder="系列名称" className="min-w-0 flex-1 border-b border-[#b9c9c2] bg-transparent px-1 py-2 text-sm outline-none placeholder:text-[#9aa7a1] focus:border-[#2e6e67]" />
              <button type="submit" disabled={busyKey === 'create-series' || !newSeriesName.trim()} className="border border-[#2e6e67] px-3 py-2 text-xs text-[#2e6e67] transition hover:bg-[#2e6e67] hover:text-[#f9fbf7] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:opacity-40">添加</button>
            </div>
          </form>
        </aside>

        <section className="min-w-0" aria-labelledby="series-detail-title">
          {!selectedSeries ? (
            <div className="border-l-[3px] border-[#c5a76b] bg-[#f9fbf7] px-5 py-6">
              <h2 className="font-serif text-2xl text-[#18272c]">先建立一个系列</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#687571]">系列是藏书之间的关系，不会改变原始 EPUB 文件。</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d0d9d4] pb-4">
                <div className="min-w-[min(100%,20rem)] flex-1">
                  <p className="mb-1 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[#2e6e67]">Selected series</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <input aria-label="系列名称" value={seriesNameDraft} onChange={(event) => setSeriesNameDraft(event.target.value)} className="min-w-[12rem] flex-1 border-b border-[#b9c9c2] bg-transparent py-1 font-serif text-3xl text-[#18272c] outline-none focus:border-[#2e6e67]" />
                    <button type="button" onClick={() => void handleRenameSeries()} disabled={busyKey === 'rename-series' || !seriesNameDraft.trim() || seriesNameDraft.trim() === selectedSeries.name} className="border-b border-[#2e6e67] py-1 text-xs text-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:opacity-40">保存名称</button>
                  </div>
                </div>
                <button type="button" onClick={() => void handleDeleteSeries()} disabled={busyKey === 'delete-series'} className="border-b border-transparent py-1 text-xs text-[#a54b45] transition hover:border-[#a54b45] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:opacity-40">删除系列</button>
              </div>

              <div className="mt-6 border-l-[3px] border-[#2e6e67] bg-[#f9fbf7] px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[#687571]">加入当前系列</p>
                    <p className="mt-1 text-xs text-[#687571]">重新归属一本书会替换它原来的系列关系。</p>
                  </div>
                  <div className="flex min-w-[min(100%,24rem)] flex-1 flex-wrap justify-end gap-2 sm:flex-none">
                    <input aria-label="新书卷标" value={newVolumeLabel} placeholder="卷标，如 01" onChange={(event) => setNewVolumeLabel(event.target.value)} className="w-28 border-b border-[#b9c9c2] bg-transparent px-1 py-2 text-sm outline-none placeholder:text-[#9aa7a1] focus:border-[#2e6e67]" />
                    <select aria-label="选择书籍" defaultValue="" onChange={(event) => { const bookId = event.target.value; void handleAssignBook(bookId); event.currentTarget.value = ''; }} disabled={isLoadingBooks || availableBooks.length === 0 || busyKey !== null} className="min-w-[12rem] flex-1 border border-[#d0d9d4] bg-[#edf1ee] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[#c5a76b] sm:flex-none">
                      <option value="">{availableBooks.length === 0 ? '没有可加入的书' : '选择一本书'}</option>
                      {availableBooks.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="mt-7 flex items-center justify-between border-b border-[#d0d9d4] pb-3">
                <h2 id="series-detail-title" className="font-serif text-2xl text-[#18272c]">系列书目</h2>
                <span className="font-mono text-sm text-[#5c7397]">{assignments.length} 本</span>
              </div>

              {isLoadingBooks ? (
                <p className="py-6 text-sm text-[#687571]">正在读取系列书目…</p>
              ) : assignedBooks.length === 0 ? (
                <div className="border-b border-[#d0d9d4] px-1 py-8 text-sm text-[#687571]">还没有书。用上方入口加入第一本。</div>
              ) : (
                <div className="divide-y divide-[#d0d9d4]">
                  {assignedBooks.map(({ assignment, book }, index) => (
                    <article key={assignment.book_id} className="grid gap-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                      <div className="flex items-center gap-3">
                        <span className="w-6 font-mono text-sm text-[#5c7397]">{String(index + 1).padStart(2, '0')}</span>
                        {book ? <LibraryBookCover book={book} size="tiny" /> : <div className="h-16 w-12 bg-[#d7e2de]" aria-label="书籍已不在书架" />}
                      </div>
                      <div className="min-w-0">
                        {book ? (
                          <button type="button" onClick={() => onOpenBook(book)} className="block max-w-full truncate text-left font-serif text-xl text-[#18272c] underline decoration-transparent underline-offset-4 transition hover:decoration-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">{book.title}</button>
                        ) : <p className="text-sm text-[#a54b45]">书籍已不在当前书架</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <label className="text-xs text-[#687571]" htmlFor={`volume-${assignment.book_id}`}>卷标</label>
                          <input id={`volume-${assignment.book_id}`} value={volumeDrafts[assignment.book_id] ?? ''} onChange={(event) => setVolumeDrafts((current) => ({ ...current, [assignment.book_id]: event.target.value }))} onBlur={() => void handleSaveVolume(assignment)} placeholder="未设置" className="w-32 border-b border-[#b9c9c2] bg-transparent px-1 py-1 text-sm outline-none placeholder:text-[#9aa7a1] focus:border-[#2e6e67]" />
                          {busyKey === `volume-${assignment.book_id}` && <span className="text-[0.65rem] text-[#687571]">保存中…</span>}
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-3 text-xs">
                        <div className="flex gap-1" aria-label="调整系列顺序">
                          <button type="button" onClick={() => void handleMoveBook(index, -1)} disabled={index === 0 || busyKey !== null} className="grid h-9 w-9 place-items-center border border-[#d0d9d4] text-base text-[#687571] hover:border-[#2e6e67] hover:text-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:opacity-30" aria-label="上移">↑</button>
                          <button type="button" onClick={() => void handleMoveBook(index, 1)} disabled={index === assignments.length - 1 || busyKey !== null} className="grid h-9 w-9 place-items-center border border-[#d0d9d4] text-base text-[#687571] hover:border-[#2e6e67] hover:text-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:opacity-30" aria-label="下移">↓</button>
                        </div>
                        <button type="button" onClick={() => void handleRemoveBook(assignment.book_id)} disabled={busyKey !== null} className="border-b border-transparent py-1 text-[#a54b45] hover:border-[#a54b45] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:opacity-40">移出</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="mt-5 border-l-[3px] border-[#a54b45] bg-[#fff8f6] px-5 py-4" role="alert">
      <p className="break-words text-sm leading-relaxed text-[#7c3834]">{message}</p>
    </div>
  );
}
