import {
  cancelSearchIndex,
  ensureSeriesSearchIndex,
  getSearchIndexStatus,
  listSeriesBooks,
  searchSeries,
} from '../../lib/tauri';
import type { SearchIndexStatus, SearchResult, SearchTaskStatus } from '../../types/models';

interface SearchCallbacks {
  isCurrent: () => boolean;
  onTask: (taskId: string) => void;
  onStatus: (status: SearchIndexStatus) => void;
}

/** Cancel only the task this UI request owns; never cancel by a guessed series ID. */
export function cancelOwnedSearchTask(taskId: string): void {
  void cancelSearchIndex({ taskId }).catch((error: unknown) => {
    console.warn('Could not cancel a retired series search task:', error);
  });
}

/** No local index or synthetic CFI: all series content still comes from the frozen IPC. */
export async function searchSeriesChapters(
  seriesId: string,
  query: string,
  callbacks: SearchCallbacks,
): Promise<SearchResult[] | null> {
  const { isCurrent, onTask, onStatus } = callbacks;
  const books = await listSeriesBooks({ seriesId });
  if (!isCurrent()) return null;
  if (books.length === 0) throw new Error('当前系列还没有书，暂时没有可搜索的正文。');

  const task = await ensureSeriesSearchIndex({ seriesId });
  if (!isCurrent()) {
    cancelOwnedSearchTask(task.task_id);
    return null;
  }
  onTask(task.task_id);
  const status = await waitForSeriesIndex(seriesId, task, onStatus, isCurrent);
  if (!status || !isCurrent()) return null;
  const results = await searchSeries({ seriesId, query, limit: 50 });
  // Switching scope/series or leaving the page can happen during the final query too.
  return isCurrent() ? results : null;
}

export async function waitForSeriesIndex(
  seriesId: string,
  task: SearchTaskStatus,
  onStatus: (status: SearchIndexStatus) => void,
  isCurrent: () => boolean,
): Promise<SearchIndexStatus | null> {
  for (let attempt = 0; attempt <= 240; attempt += 1) {
    if (!isCurrent()) return null;
    if (attempt > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
    if (!isCurrent()) return null;
    const status = await getSearchIndexStatus({ seriesId });
    if (!isCurrent()) return null;
    onStatus(status);
    if (status.status === 'ready') return status;
    if (status.status === 'error') throw new Error(status.error_detail ?? '系列正文索引建立失败。');
    if (status.error_detail?.startsWith('SEARCH_INDEX_CANCELLED:')
      || status.error_detail?.startsWith('SEARCH_INDEX_INTERRUPTED:')) {
      throw new Error(status.error_detail);
    }
  }
  throw new Error(`系列正文索引仍在建立（任务 ${task.task_id}），可以稍后继续搜索。`);
}
