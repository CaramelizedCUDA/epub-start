import { useEffect, useState } from 'react';
import {
  cancelSearchIndex,
  createSeries,
  ensureSeriesSearchIndex,
  getSearchIndexStatus,
  listSeries,
  rebuildSearchIndex,
  setBookSeries,
} from '../../lib/tauri';
import { useLibraryStore } from '../../stores/libraryStore';
import type { SearchIndexStatus, SearchTaskStatus } from '../../types/models';

const CLOSEOUT_SERIES_NAME = 'B2 Android Closeout';

type CloseoutSearchStatus = SearchIndexStatus | SearchTaskStatus;

/**
 * Build-gated Android storage/search diagnostic surface.
 * VITE_B2_CLOSEOUT is only enabled for the disposable AVD profile APK.
 */
export function B2CloseoutPanel() {
  const books = useLibraryStore((state) => state.books);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [status, setStatus] = useState<CloseoutSearchStatus | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availableBooks = books.filter((book) => book.status === 'available');

  useEffect(() => {
    if (!seriesId) return undefined;
    let disposed = false;

    const refreshStatus = async () => {
      try {
        const next = await getSearchIndexStatus({ seriesId });
        if (!disposed) setStatus(next);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [seriesId]);

  const prepareSeries = async (): Promise<string> => {
    if (availableBooks.length === 0) {
      throw new Error('B2_CLOSEOUT: 至少导入一本可用 EPUB 后才能建立索引系列。');
    }

    const existing = (await listSeries()).find((series) => series.name === CLOSEOUT_SERIES_NAME);
    const series = existing ?? await createSeries({ series: { name: CLOSEOUT_SERIES_NAME } });
    for (const [index, book] of availableBooks.entries()) {
      await setBookSeries({
        assignment: {
          book_id: book.id,
          series_id: series.id,
          volume_label: String(index + 1),
          sort_order: index,
        },
      });
    }
    setSeriesId(series.id);
    return series.id;
  };

  const handlePrepare = async () => {
    setIsPreparing(true);
    setError(null);
    try {
      await prepareSeries();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsPreparing(false);
    }
  };

  const handleStart = async (rebuild: boolean) => {
    setIsPreparing(true);
    setError(null);
    try {
      const id = seriesId ?? await prepareSeries();
      const next = rebuild
        ? await rebuildSearchIndex({ seriesId: id })
        : await ensureSeriesSearchIndex({ seriesId: id });
      setTaskId(next.task_id);
      setStatus(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsPreparing(false);
    }
  };

  const handleCancel = async () => {
    if (!taskId) return;
    setError(null);
    try {
      await cancelSearchIndex({ taskId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="mx-6 mt-4 rounded-lg border border-cyan-700/70 bg-cyan-950/40 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-cyan-200">B2 Android closeout</h2>
          <p className="text-xs text-cyan-100/70">仅出现在 VITE_B2_CLOSEOUT profile 构建，用于受控 AVD 证据。</p>
        </div>
        <span className="text-xs text-cyan-100/70">可用书籍：{availableBooks.length}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void handlePrepare()} disabled={isPreparing || availableBooks.length === 0} className="reader-control">
          {isPreparing ? '准备中…' : '准备测试系列'}
        </button>
        <button type="button" onClick={() => void handleStart(false)} disabled={isPreparing || !seriesId} className="reader-control">
          开始后台索引
        </button>
        <button type="button" onClick={() => void handleStart(true)} disabled={isPreparing || !seriesId} className="reader-control">
          重建索引
        </button>
        <button type="button" onClick={() => void handleCancel()} disabled={!taskId} className="reader-control">
          取消任务
        </button>
      </div>

      <div className="mt-3 grid gap-1 text-xs text-cyan-100/80">
        <p>series_id：{seriesId ?? '未准备'}</p>
        <p>task_id：{taskId ?? '无活动任务'}</p>
        <p>
          状态：{status?.status ?? '未开始'}；文档：{status ? `${status.indexed_documents}/${status.total_documents}` : '—'}
        </p>
        {status?.error_detail && <p className="text-red-300">任务错误：{status.error_detail}</p>}
        {error && <p className="text-red-300">closeout 错误：{error}</p>}
      </div>
    </section>
  );
}
