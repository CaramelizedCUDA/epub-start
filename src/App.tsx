import { useState, useCallback } from 'react';
import type { BookSummary } from './types/models';
import { BookShelf, type LibrarySection } from './features/library/BookShelf';
import { EpubReader } from './features/reader/EpubReader';
import { openBook as openBookIpc } from './lib/tauri';
import { useLibraryStore } from './stores/libraryStore';

type View =
  | { kind: 'shelf'; section: LibrarySection }
  | { kind: 'reader'; bookId: string; epubRootUrl: string };

function App() {
  const [view, setView] = useState<View>({ kind: 'shelf', section: 'library' });
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
    setView({ kind: 'shelf', section: 'library' });
  }, []);

  if (view.kind === 'reader') {
    return (
      <EpubReader
        bookId={view.bookId}
        epubRootUrl={view.epubRootUrl}
        onClose={handleCloseReader}
      />
    );
  }

  return (
    <BookShelf
      activeSection={view.section}
      onSectionChange={(section) => setView({ kind: 'shelf', section })}
      onOpenBook={handleOpenBook}
      readerError={readerError}
      onDismissReaderError={() => setReaderError(null)}
    />
  );
}

export default App;
