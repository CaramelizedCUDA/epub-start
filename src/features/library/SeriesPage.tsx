// Paper-and-ink presentation keeps the existing catalog queries and error states.
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [assignmentsSeriesId, setAssignmentsSeriesId] = useState('');
  const [isLoadingSeries, setIsLoadingSeries] = useState(true);
  const [isLoadingBooks, setIsLoadingBooks] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const writeLockRef = useRef(false);
  const selectedSeriesIdRef = useRef(selectedSeriesId);
  selectedSeriesIdRef.current = selectedSeriesId;

  const selectedSeries = series.find((item) => item.id === selectedSeriesId) ?? null;
  const selectedAssignments = assignmentsSeriesId === selectedSeriesId ? assignments : [];
  const assignedBookIds = useMemo(() => new Set(selectedAssignments.map((item) => item.book_id)), [selectedAssignments]);
  const assignedBooks = useMemo(
    () => selectedAssignments.map((assignment) => ({ assignment, book: books.find((item) => item.id === assignment.book_id) ?? null })),
    [selectedAssignments, books],
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
        const nextSelectedSeriesId = nextSeries.some((item) => item.id === selectedSeriesIdRef.current)
          ? selectedSeriesIdRef.current
          : (nextSeries[0]?.id ?? '');
        selectedSeriesIdRef.current = nextSelectedSeriesId;
        setIsLoadingBooks(Boolean(nextSelectedSeriesId));
        setSelectedSeriesId(nextSelectedSeriesId);
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
      setAssignmentsSeriesId('');
      setVolumeDrafts({});
      setIsLoadingBooks(false);
      return;
    }
    let disposed = false;
    setIsLoadingBooks(true);
    setAssignments([]);
    setAssignmentsSeriesId('');
    setVolumeDrafts({});
    setError(null);
    const requestedSeriesId = selectedSeriesId;
    void listSeriesBooks({ seriesId: requestedSeriesId })
      .then((nextAssignments) => {
        if (disposed || selectedSeriesIdRef.current !== requestedSeriesId) return;
        setAssignments(nextAssignments);
        setAssignmentsSeriesId(requestedSeriesId);
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

  const beginWrite = (key: string): boolean => {
    if (writeLockRef.current || isLoadingSeries || isLoadingBooks) return false;
    writeLockRef.current = true;
    setBusyKey(key);
    return true;
  };

  const endWrite = () => {
    writeLockRef.current = false;
    setBusyKey(null);
  };

  const isCurrentSelection = (seriesId: string) => selectedSeriesIdRef.current === seriesId;

  const handleSelectSeries = (seriesId: string) => {
    if (seriesId === selectedSeriesIdRef.current || writeLockRef.current || isLoadingBooks) return;
    selectedSeriesIdRef.current = seriesId;
    setAssignments([]);
    setAssignmentsSeriesId('');
    setVolumeDrafts({});
    setIsLoadingBooks(true);
    setSelectedSeriesId(seriesId);
  };

  const handleCreateSeries = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newSeriesName.trim();
    if (!name || !beginWrite('create-series')) return;
    setError(null);
    try {
      const created = await createSeries({ series: { name } });
      setSeries((current) => [...current, created]);
      selectedSeriesIdRef.current = created.id;
      setAssignments([]);
      setAssignmentsSeriesId('');
      setVolumeDrafts({});
      setIsLoadingBooks(true);
      setSelectedSeriesId(created.id);
      setNewSeriesName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      endWrite();
    }
  };

  const handleRenameSeries = async () => {
    if (!selectedSeries) return;
    const name = seriesNameDraft.trim();
    if (!name || name === selectedSeries.name) return;
    const seriesId = selectedSeries.id;
    if (!beginWrite('rename-series')) return;
    setError(null);
    try {
      const updated = await updateSeries({ series: { id: seriesId, name } });
      setSeries((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      endWrite();
    }
  };

  const handleDeleteSeries = async () => {
    if (!selectedSeries || !window.confirm(`删除系列“${selectedSeries.name}”？书籍不会被删除。`)) return;
    const deletedSeriesId = selectedSeries.id;
    if (!beginWrite('delete-series')) return;
    setError(null);
    try {
      await deleteSeries({ seriesId: deletedSeriesId });
      const nextSeries = series.filter((item) => item.id !== deletedSeriesId);
      setSeries(nextSeries);
      if (isCurrentSelection(deletedSeriesId)) {
        const nextSelectedSeriesId = nextSeries[0]?.id ?? '';
        selectedSeriesIdRef.current = nextSelectedSeriesId;
        setSelectedSeriesId(nextSelectedSeriesId);
        setAssignments([]);
        setAssignmentsSeriesId('');
        setVolumeDrafts({});
        setIsLoadingBooks(Boolean(nextSelectedSeriesId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      endWrite();
    }
  };

  const handleAssignBook = async (bookId: string) => {
    const seriesId = selectedSeriesId;
    if (!seriesId || !bookId || !beginWrite(`assign-${bookId}`)) return;
    const nextSortOrder = selectedAssignments.reduce((max, item) => Math.max(max, item.sort_order), -1) + 1;
    setError(null);
    try {
      const assignment = await setBookSeries({
        assignment: {
          book_id: bookId,
          series_id: seriesId,
          volume_label: newVolumeLabel.trim(),
          sort_order: nextSortOrder,
        },
      });
      if (isCurrentSelection(seriesId)) {
        setAssignments((current) => [...current.filter((item) => item.book_id !== bookId), assignment].sort((left, right) => left.sort_order - right.sort_order));
        setAssignmentsSeriesId(seriesId);
        setVolumeDrafts((current) => ({ ...current, [bookId]: assignment.volume_label }));
        setNewVolumeLabel('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      endWrite();
    }
  };

  const handleRemoveBook = async (bookId: string) => {
    const seriesId = selectedSeriesId;
    if (!seriesId || !beginWrite(`remove-${bookId}`)) return;
    setError(null);
    try {
      await clearBookSeries({ bookId });
      if (isCurrentSelection(seriesId)) {
        setAssignments((current) => current.filter((item) => item.book_id !== bookId));
        setAssignmentsSeriesId(seriesId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      endWrite();
    }
  };

  const handleSaveVolume = async (assignment: BookSeries) => {
    const seriesId = selectedSeriesId;
    if (!seriesId) return;
    const volumeLabel = volumeDrafts[assignment.book_id]?.trim() ?? '';
    if (volumeLabel === assignment.volume_label) return;
    if (!beginWrite(`volume-${assignment.book_id}`)) return;
    setError(null);
    try {
      const updated = await setBookSeries({ assignment: { ...assignment, series_id: seriesId, volume_label: volumeLabel } });
      if (isCurrentSelection(seriesId)) {
        setAssignments((current) => current.map((item) => item.book_id === updated.book_id ? updated : item));
        setAssignmentsSeriesId(seriesId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      endWrite();
    }
  };

  const handleMoveBook = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    const seriesId = selectedSeriesId;
    if (!seriesId || targetIndex < 0 || targetIndex >= selectedAssignments.length || !beginWrite('reorder-series')) return;
    const nextAssignments = [...selectedAssignments];
    [nextAssignments[index], nextAssignments[targetIndex]] = [nextAssignments[targetIndex], nextAssignments[index]];
    const positions = nextAssignments.map((item, position) => ({ book_id: item.book_id, sort_order: position }));
    setError(null);
    try {
      const reorderedAssignments = await reorderSeriesBooks({ seriesId, positions });
      if (isCurrentSelection(seriesId)) {
        setAssignments(reorderedAssignments);
        setAssignmentsSeriesId(seriesId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      endWrite();
    }
  };

  return (
    <section className="pt-8 lg:pt-10" aria-labelledby="series-page-title">
      <div className="border-t border-accent pt-5">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
          <div>
            <button type="button" onClick={onBack} className="mb-4 border-b border-transparent text-xs text-accent transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent">← 藏书</button>

            <h1 id="series-page-title" className="font-reading text-3xl font-medium tracking-[-0.02em] text-ink sm:text-4xl">系列</h1>
          </div>
          <p className="max-w-sm text-left sm:text-right text-sm leading-relaxed text-muted">把同一系列的书放在一起，并留下卷册顺序。一本书同时只归属于一个系列。</p>
        </div>
      </div>

      {error && <InlineError message={error} />}

      <div className="mt-7 grid gap-8 xl:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-line bg-surface" aria-label="系列列表">
          <div className="flex items-center justify-between border-b border-line px-4 py-4">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted">系列列表</span>
            <span className="font-mono text-sm text-accent">{series.length}</span>
          </div>
          {isLoadingSeries ? (
            <p className="px-4 py-5 text-sm text-muted">正在读取系列…</p>
          ) : series.length === 0 ? (
            <p className="px-4 py-5 text-sm leading-relaxed text-muted">还没有系列。可以先从下面建立一个。</p>
          ) : (
            <div className="divide-y divide-line">
              {series.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectSeries(item.id)}
                  disabled={isLoadingBooks || busyKey !== null}
                  className={`flex min-h-12 w-full items-center justify-between gap-3 border-l px-4 py-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent ${selectedSeriesId === item.id ? 'border-accent bg-paper text-ink' : 'border-transparent text-muted hover:bg-paper hover:text-ink'}`}
                >
                  <span className="truncate">{item.name}</span>
                  {selectedSeriesId === item.id && <span className="text-xs text-accent">当前</span>}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={(event) => void handleCreateSeries(event)} className="border-t border-line p-4">
            <label htmlFor="new-series-name" className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">新建系列</label>
            <div className="mt-2 flex gap-2">
              <input id="new-series-name" value={newSeriesName} onChange={(event) => setNewSeriesName(event.target.value)} placeholder="系列名称" className="min-w-0 flex-1 border-b border-line bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted focus:border-accent" />
              <button type="submit" disabled={isLoadingSeries || isLoadingBooks || busyKey !== null || !newSeriesName.trim()} className="border border-accent px-3 py-2 text-xs text-accent transition hover:bg-accent hover:text-surface focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-40">添加</button>
            </div>
          </form>
        </aside>

        <section className="min-w-0" aria-labelledby="series-detail-title">
          {!selectedSeries ? (
            <div className="border-l border-accent bg-surface px-5 py-6">
              <h2 className="font-reading text-2xl text-ink">先建立一个系列</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">系列是藏书之间的关系，不会改变原始 EPUB 文件。</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
                <div className="min-w-[min(100%,20rem)] flex-1">

                  <div className="flex flex-wrap items-center gap-3">
                    <input aria-label="系列名称" value={seriesNameDraft} onChange={(event) => setSeriesNameDraft(event.target.value)} className="min-w-[12rem] flex-1 border-b border-line bg-transparent py-1 font-reading text-3xl text-ink outline-none focus:border-accent" />
                    <button type="button" onClick={() => void handleRenameSeries()} disabled={isLoadingBooks || busyKey !== null || !seriesNameDraft.trim() || seriesNameDraft.trim() === selectedSeries.name} className="border-b border-accent py-1 text-xs text-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-40">保存名称</button>
                  </div>
                </div>
                <button type="button" onClick={() => void handleDeleteSeries()} disabled={isLoadingBooks || busyKey !== null} className="border-b border-transparent py-1 text-xs text-danger transition hover:border-danger focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-40">删除系列</button>
              </div>

              <div className="mt-6 border-l border-accent bg-surface px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">加入当前系列</p>
                    <p className="mt-1 text-xs text-muted">重新归属一本书会替换它原来的系列关系。</p>
                  </div>
                  <div className="flex min-w-[min(100%,24rem)] flex-1 flex-wrap justify-end gap-2 sm:flex-none">
                    <input aria-label="新书卷标" value={newVolumeLabel} placeholder="卷标，如 01" onChange={(event) => setNewVolumeLabel(event.target.value)} className="w-28 border-b border-line bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted focus:border-accent" />
                    <select aria-label="选择书籍" defaultValue="" onChange={(event) => { const bookId = event.target.value; void handleAssignBook(bookId); event.currentTarget.value = ''; }} disabled={isLoadingSeries || isLoadingBooks || availableBooks.length === 0 || busyKey !== null} className="min-w-[12rem] flex-1 border border-line bg-paper px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-accent sm:flex-none">
                      <option value="">{availableBooks.length === 0 ? '没有可加入的书' : '选择一本书'}</option>
                      {availableBooks.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="mt-7 flex items-center justify-between border-b border-line pb-3">
                <h2 id="series-detail-title" className="font-reading text-2xl text-ink">系列书目</h2>
                <span className="font-mono text-sm text-accent">{selectedAssignments.length} 本</span>
              </div>

              {isLoadingBooks ? (
                <p className="py-6 text-sm text-muted">正在读取系列书目…</p>
              ) : assignedBooks.length === 0 ? (
                <div className="border-b border-line px-1 py-8 text-sm text-muted">还没有书。用上方入口加入第一本。</div>
              ) : (
                <div className="divide-y divide-line">
                  {assignedBooks.map(({ assignment, book }, index) => (
                    <article key={assignment.book_id} className="grid gap-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                      <div className="flex items-center gap-3">
                        <span className="w-6 font-mono text-sm text-accent">{String(index + 1).padStart(2, '0')}</span>
                        {book ? <LibraryBookCover book={book} size="tiny" /> : <div className="h-16 w-12 bg-subtle" aria-label="书籍已不在书架" />}
                      </div>
                      <div className="min-w-0">
                        {book ? (
                          <button type="button" onClick={() => onOpenBook(book)} className="block max-w-full truncate text-left font-reading text-xl text-ink underline decoration-transparent underline-offset-4 transition hover:decoration-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-accent">{book.title}</button>
                        ) : <p className="text-sm text-danger">书籍已不在当前书架</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <label className="text-xs text-muted" htmlFor={`volume-${assignment.book_id}`}>卷标</label>
                          <input id={`volume-${assignment.book_id}`} value={volumeDrafts[assignment.book_id] ?? ''} onChange={(event) => setVolumeDrafts((current) => ({ ...current, [assignment.book_id]: event.target.value }))} onBlur={() => void handleSaveVolume(assignment)} disabled={isLoadingBooks || busyKey !== null} placeholder="未设置" className="w-32 border-b border-line bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted focus:border-accent" />
                          {busyKey === `volume-${assignment.book_id}` && <span className="text-[0.65rem] text-muted">保存中…</span>}
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-3 text-xs">
                        <div className="flex gap-1" aria-label="调整系列顺序">
                          <button type="button" onClick={() => void handleMoveBook(index, -1)} disabled={index === 0 || busyKey !== null} className="grid h-9 w-9 place-items-center border border-line text-base text-muted hover:border-accent hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-30" aria-label="上移">↑</button>
                          <button type="button" onClick={() => void handleMoveBook(index, 1)} disabled={index === selectedAssignments.length - 1 || busyKey !== null} className="grid h-9 w-9 place-items-center border border-line text-base text-muted hover:border-accent hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-30" aria-label="下移">↓</button>
                        </div>
                        <button type="button" onClick={() => void handleRemoveBook(assignment.book_id)} disabled={busyKey !== null} className="border-b border-transparent py-1 text-danger hover:border-danger focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-40">移出</button>
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
    <div className="mt-5 border-l border-danger bg-surface px-5 py-4" role="alert">
      <p className="break-words text-sm leading-relaxed text-danger">{message}</p>
    </div>
  );
}
