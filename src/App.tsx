import { useState, useCallback } from 'react';
import type { BookSummary } from './types/models';
import { BookShelf } from './features/library/BookShelf';
import { EpubReader } from './features/reader/EpubReader';
import { openBook as openBookIpc } from './lib/tauri';
import { useLibraryStore } from './stores/libraryStore';

type View =
  | { kind: 'shelf' }
  | { kind: 'reader'; bookId: string; epubRootUrl: string };

function App() {
  const [view, setView] = useState<View>({ kind: 'shelf' });
  const [readerError, setReaderError] = useState<string | null>(null);
  const loadBooks = useLibraryStore((state) => state.loadBooks);

  const handleOpenBook = useCallback(async (book: BookSummary) => {
    setReaderError(null);
    try {
      if (book.status === 'missing') {
        setReaderError('BOOK_SOURCE_UNAVAILABLE: 文件已移动，请重新选择。');
        return;
      }
      if (book.status === 'error') {
        setReaderError(`BOOK_PARSE_FAILED: ${book.status_detail ?? '未知解析错误'}`);
        return;
      }

      const result = await openBookIpc({ bookId: book.id });
      setView({
        kind: 'reader',
        bookId: result.book.id,
        epubRootUrl: result.epub_root_url,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('BOOK_SOURCE_UNAVAILABLE:')) {
        await loadBooks();
        setReaderError('文件已移动或不可读，请重新选择该书籍的来源文件。');
      } else {
        setReaderError(msg);
      }
    }
  }, [loadBooks]);

  const handleCloseReader = useCallback(() => {
    setView({ kind: 'shelf' });
  }, []);

  return (
    <div className="min-h-screen bg-gray-900">
      {view.kind === 'shelf' ? (
        <>
          {readerError && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-red-900/90 border border-red-700 rounded-xl shadow-2xl max-w-lg">
              <p className="text-red-200 text-sm">{readerError}</p>
              <button
                onClick={() => setReaderError(null)}
                className="mt-2 text-xs text-red-400 hover:text-red-200 underline"
              >
                关闭
              </button>
            </div>
          )}
          <BookShelf onOpenBook={handleOpenBook} />
        </>
      ) : (
        <EpubReader
          bookId={view.bookId}
          epubRootUrl={view.epubRootUrl}
          onClose={handleCloseReader}
        />
      )}
    </div>
  );
}

export default App;
