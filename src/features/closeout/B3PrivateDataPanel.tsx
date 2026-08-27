import { useState } from 'react';
import { getB3PrivateDataReport } from '../../lib/tauri';
import type { B3PrivateDataReport } from '../../types/models';

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} B`;
}

/**
 * Build-gated B3 storage diagnostic surface. It is shown only when the
 * frontend is built with VITE_B3_DIAGNOSTICS=1 and the matching Rust feature.
 */
export function B3PrivateDataPanel() {
  const [report, setReport] = useState<B3PrivateDataReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const collectReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setReport(await getB3PrivateDataReport());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="mx-6 mt-4 rounded-lg border border-violet-700/70 bg-violet-950/40 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-violet-200">B3 私有数据诊断</h2>
          <p className="text-xs text-violet-100/70">仅用于 release-like 诊断构建；报告不写入应用数据目录。</p>
        </div>
        <button type="button" onClick={() => void collectReport()} disabled={isLoading} className="reader-control">
          {isLoading ? '采集中…' : '采集当前分项'}
        </button>
      </div>

      {report && (
        <div className="mt-3 grid gap-1 text-xs text-violet-100/85 sm:grid-cols-2">
          <p>总计：{formatBytes(report.total_bytes)}</p>
          <p>数据库文件：{formatBytes(report.database_bytes)}</p>
          <p>来源缓存：{formatBytes(report.source_cache_bytes)}</p>
          <p>封面缓存：{formatBytes(report.cover_cache_bytes)}</p>
          <p>其它私有文件：{formatBytes(report.other_bytes)}</p>
          <p>搜索索引账面：{formatBytes(report.search_index_text_bytes)}（{report.search_document_count} 个文档）</p>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-red-300">诊断错误：{error}</p>}
    </section>
  );
}
