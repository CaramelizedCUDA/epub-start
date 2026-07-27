import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useLibraryStore } from '../../stores/libraryStore';
import { getGlobalReadingSettings, saveGlobalReadingSettings } from '../../lib/tauri';
import type { BookSummary, ReadingSettings } from '../../types/models';

interface BookShelfProps {
  onOpenBook: (book: BookSummary) => void;
}

export function BookShelf({ onOpenBook }: BookShelfProps) {
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
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<ReadingSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    let disposed = false;
    const appWindow = getCurrentWindow();
    void appWindow.isFullscreen().then((value) => { if (!disposed) setIsFullscreen(value); });
    let unlisten: (() => void) | undefined;
    void appWindow.onResized(() => {
      void appWindow.isFullscreen().then((value) => { if (!disposed) setIsFullscreen(value); });
    }).then((cleanup) => { unlisten = cleanup; });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const appWindow = getCurrentWindow();
      void appWindow.isFullscreen().then(async (fullscreen) => {
        if (!fullscreen) return;
        await appWindow.setFullscreen(false);
        setIsFullscreen(false);
      }).catch((err: unknown) => {
        setSettingsError(err instanceof Error ? err.message : String(err));
      });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const openSettings = async () => {
    setShowSettings(true);
    setSettingsError(null);
    if (settings) return;
    try {
      setSettings(await getGlobalReadingSettings());
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    }
  };

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
    setSettingsError(null);
    try {
      const appWindow = getCurrentWindow();
      const next = !(await appWindow.isFullscreen());
      await appWindow.setFullscreen(next);
      setIsFullscreen(next);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-700 shrink-0">
        <h1 className="text-xl font-bold tracking-wide">EpubStart</h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void openSettings()} className="reader-control">设置</button>
          <button type="button" onClick={() => void toggleFullscreen()} className="reader-control">
            {isFullscreen ? '退出全屏' : '全屏'}
          </button>
          <button
            onClick={importFromDialog}
            disabled={isLoading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium transition hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? '导入中…' : '+ 导入 EPUB'}
          </button>
        </div>
      </header>

      {showSettings && (
        <aside className="absolute right-6 top-16 z-40 w-80 rounded-lg border border-gray-700 bg-gray-800 p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">全局阅读设置</h2>
              <p className="text-xs text-gray-400">新打开书籍默认使用这些设置；单书覆盖保持不变。</p>
            </div>
            <button type="button" onClick={() => setShowSettings(false)} className="text-xl text-gray-400 hover:text-white">×</button>
          </div>
          {settings ? (
            <div className="space-y-3 text-sm">
              <ShelfSelect label="主题" value={settings.theme} options={[['light', '浅色'], ['sepia', '暖色'], ['dark', '深色']]} onChange={(value) => setSettings({ ...settings, theme: value as ReadingSettings['theme'] })} />
              <ShelfSelect label="字体" value={settings.font_family} options={[['publisher', '出版方'], ['serif', '衬线'], ['sans', '无衬线'], ['system', '系统']]} onChange={(value) => setSettings({ ...settings, font_family: value as ReadingSettings['font_family'] })} />
              <ShelfNumber label="字号" value={settings.font_size_px} min={12} max={32} step={1} unit="px" onChange={(value) => setSettings({ ...settings, font_size_px: value })} />
              <ShelfNumber label="行距" value={settings.line_height_multiplier} min={1} max={3} step={0.1} onChange={(value) => setSettings({ ...settings, line_height_multiplier: value })} />
              <ShelfNumber label="段落间距" value={settings.paragraph_spacing_multiplier} min={0} max={2} step={0.1} onChange={(value) => setSettings({ ...settings, paragraph_spacing_multiplier: value })} />
              <ShelfNumber label="首行缩进" value={settings.text_indent_em} min={0} max={4} step={0.5} unit="em" onChange={(value) => setSettings({ ...settings, text_indent_em: value })} />
              <ShelfNumber label="上边距" value={settings.margin_top_px} min={0} max={100} step={1} unit="px" onChange={(value) => setSettings({ ...settings, margin_top_px: value })} />
              <ShelfNumber label="下边距" value={settings.margin_bottom_px} min={0} max={100} step={1} unit="px" onChange={(value) => setSettings({ ...settings, margin_bottom_px: value })} />
              <ShelfNumber label="左边距" value={settings.margin_left_percent} min={0} max={20} step={1} unit="%" onChange={(value) => setSettings({ ...settings, margin_left_percent: value })} />
              <ShelfNumber label="右边距" value={settings.margin_right_percent} min={0} max={20} step={1} unit="%" onChange={(value) => setSettings({ ...settings, margin_right_percent: value })} />
              <ShelfNumber label="最大列宽" value={settings.max_column_width_px} min={300} max={1200} step={10} unit="px" onChange={(value) => setSettings({ ...settings, max_column_width_px: value })} />
              <ShelfSelect label="排版" value={settings.flow} options={[['paginated', '分页'], ['scrolled', '滚动']]} onChange={(value) => setSettings({ ...settings, flow: value as ReadingSettings['flow'] })} />
              <ShelfSelect label="跨页" value={settings.spread} options={[['auto', '自动'], ['none', '单页'], ['always', '双页']]} onChange={(value) => setSettings({ ...settings, spread: value as ReadingSettings['spread'] })} />
              <div className="flex justify-end">
                <button type="button" disabled={isSavingSettings} onClick={() => void persistSettings()} className="reader-control">
                  {isSavingSettings ? '保存中…' : '保存设置'}
                </button>
              </div>
            </div>
          ) : !settingsError ? (
            <p className="text-sm text-gray-400">正在读取设置…</p>
          ) : null}
          {settingsError && <p className="mt-3 text-xs text-red-300">{settingsError}</p>}
        </aside>
      )}

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-900/60 border border-red-700 rounded-lg flex items-start justify-between">
          <div>
            <p className="text-red-300 text-sm font-medium">导入错误</p>
            <p className="text-red-200 text-xs mt-1 break-all">{error}</p>
          </div>
          <button
            onClick={clearError}
            className="text-red-300 hover:text-white text-lg leading-none ml-4"
          >
            ×
          </button>
        </div>
      )}

      {/* Book list */}
      <main className="flex-1 overflow-y-auto p-6">
        {isLoading && books.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-400" />
          </div>
        ) : books.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500">
              <p className="text-lg mb-2">书架为空</p>
              <p className="text-sm">点击「+ 导入 EPUB」添加第一本书</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onOpen={() => onOpenBook(book)}
                onRelocate={() => relocateSource(book.id)}
                onDelete={() => removeBook(book.id)}
                disabled={isLoading}
              />
            ))}
          </div>
        )}
      </main>
    </div>
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
      <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded bg-gray-700 px-2 py-1">
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
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
        }}
        className="min-w-0 rounded bg-gray-700 px-2 py-1 text-right"
      />
      <span className="text-gray-400">{unit}</span>
    </label>
  );
}

function BookCard({
  book,
  onOpen,
  onRelocate,
  onDelete,
  disabled,
}: {
  book: BookSummary;
  onOpen: () => void;
  onRelocate: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const canRelocate = book.status === 'missing';

  return (
    <div className="relative group">
    <button
      onClick={onOpen}
      disabled={disabled || book.status === 'error'}
      className="flex flex-col items-center p-3 rounded-xl bg-gray-800
                 hover:bg-gray-700 disabled:opacity-50 transition text-left w-full
                 border border-gray-700 hover:border-gray-600"
    >
      {/* Cover or placeholder */}
      <div className="w-full aspect-[3/4] bg-gray-700 rounded-lg mb-3 flex items-center justify-center overflow-hidden">
        {book.cover_cache_path ? (
          <img
            src={convertFileSrc(book.cover_cache_path)}
            alt={book.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-4xl text-gray-500 select-none">📖</span>
        )}
      </div>

      <p className="text-sm font-medium text-gray-200 line-clamp-2 w-full">
        {book.title}
      </p>

      {book.authors.length > 0 && (
        <p className="text-xs text-gray-500 mt-1 w-full truncate">
          {book.authors.join(', ')}
        </p>
      )}

      {book.status === 'error' && (
        <span className="mt-2 text-xs px-2 py-0.5 bg-red-900/60 text-red-300 rounded">
          解析失败
        </span>
      )}
      {book.status === 'missing' && (
        <span className="mt-2 text-xs px-2 py-0.5 bg-yellow-900/60 text-yellow-300 rounded">
          文件缺失
        </span>
      )}
    </button>

      {canRelocate && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRelocate();
          }}
          disabled={disabled}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-yellow-700/90 px-3 py-1 text-xs text-yellow-50 hover:bg-yellow-600 disabled:opacity-50"
        >
          重新选择
        </button>
      )}

      {/* Delete button — visible on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        disabled={disabled}
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center
                   rounded-full bg-red-800/80 text-red-300 text-xs
                   opacity-0 group-hover:opacity-100 transition
                   hover:bg-red-700 disabled:opacity-0"
        title="删除"
      >
        ×
      </button>
    </div>
  );
}
