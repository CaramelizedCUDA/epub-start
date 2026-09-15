import { useState, useCallback, useRef } from 'react';
import type { BookSummary } from './types/models';
import { BookShelf, type LibrarySection } from './features/library/BookShelf';
import { EpubReader } from './features/reader/EpubReader';
import { openBook as openBookIpc } from './lib/tauri';
import { useLibraryStore } from './stores/libraryStore';

type View =
  | { kind: 'shelf'; section: LibrarySection }
  | { kind: 'reader'; bookId: string; epubRootUrl: string; initialHref?: string; returnSection: LibrarySection };

function App() {
  const [view, setView] = useState<View>({ kind: 'shelf', section: 'library' });
  const [readerError, setReaderError] = useState<string | null>(null);
  const openRequestRef = useRef(0);
  const loadBooks = useLibraryStore((state) => state.loadBooks);

  const handleOpenBook = useCallback(async (book: BookSummary, initialHref?: string) => {
    const requestId = ++openRequestRef.current;
    setReaderError(null);
    const returnSection = view.kind === 'shelf' ? view.section : 'library';
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
      if (requestId !== openRequestRef.current) return;
      setView({
        kind: 'reader',
        bookId: result.book.id,
        epubRootUrl: result.epub_root_url,
        returnSection,
        initialHref,
      });
    } catch (err) {
      if (requestId !== openRequestRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('BOOK_SOURCE_UNAVAILABLE:')) {
        await loadBooks();
        if (requestId !== openRequestRef.current) return;
        setReaderError('文件已移动或不可读，请重新选择该书籍的来源文件。');
      } else {
        setReaderError(msg);
      }
    }
  }, [loadBooks, view]);

  const handleCloseReader = useCallback(() => {
    ++openRequestRef.current;
    setView((current) => current.kind === 'reader'
      ? { kind: 'shelf', section: current.returnSection }
      : current);
  }, []);

  if (view.kind === 'reader') {
    return (
      <EpubReader
        key={view.bookId}
        bookId={view.bookId}
        epubRootUrl={view.epubRootUrl}
        initialHref={view.initialHref}
        onClose={handleCloseReader}
      />
    );
  }

  return (
    <BookShelf
      activeSection={view.section}
      onSectionChange={(section) => { ++openRequestRef.current; setView({ kind: 'shelf', section }); }}
      onOpenBook={handleOpenBook}
      readerError={readerError}
      onDismissReaderError={() => setReaderError(null)}
    />
  );
}

export default App;
