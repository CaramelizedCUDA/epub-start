// Paper-and-ink presentation keeps the existing catalog queries and error states.
import { useEffect, useMemo, useState } from 'react';
import { listNotes } from '../../lib/tauri';
import type { BookSummary, Note } from '../../types/models';
import { LibraryBookCover } from './LibraryBookCover';

interface NotesPageProps {
  books: BookSummary[];
  initialBookId?: string;
  onBack: () => void;
  onOpenBook: (book: BookSummary) => void;
}

export function NotesPage({ books, initialBookId, onBack, onOpenBook }: NotesPageProps) {
  // A book action opens this existing page with the chosen book, without a new IPC.
  const [selectedBookId, setSelectedBookId] = useState(initialBookId ?? '');
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedBook = useMemo(() => books.find((book) => book.id === selectedBookId) ?? null, [books, selectedBookId]);

  useEffect(() => {
    setSelectedBookId((current) => books.some((book) => book.id === current) ? current : (books[0]?.id ?? ''));
  }, [books]);

  useEffect(() => {
    if (!selectedBookId) {
      setNotes([]);
      return;
    }
    let disposed = false;
    setIsLoading(true);
    setError(null);
    void listNotes({ bookId: selectedBookId })
      .then((nextNotes) => { if (!disposed) setNotes([...nextNotes].sort((left, right) => right.created_at - left.created_at)); })
      .catch((err: unknown) => { if (!disposed) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!disposed) setIsLoading(false); });
    return () => { disposed = true; };
  }, [selectedBookId]);

  return (
    <section className="pt-8 lg:pt-10" aria-labelledby="notes-page-title">
      <div className="border-t border-accent pt-5">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
          <div>
            <button type="button" onClick={onBack} className="mb-4 border-b border-transparent text-xs text-accent transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent">← 藏书</button>

            <h1 id="notes-page-title" className="font-reading text-3xl font-medium tracking-[-0.02em] text-ink sm:text-4xl">批注</h1>
          </div>
          <p className="max-w-sm text-right text-sm leading-relaxed text-muted">选择书籍回看批注；打开阅读器可定位原文、编辑或删除。</p>
        </div>
      </div>

      {error && <div className="mt-5 border-l border-danger bg-surface px-5 py-4" role="alert"><p className="break-words text-sm leading-relaxed text-danger">{error}</p></div>}

      {!selectedBook ? (
        <div className="mt-7 border-l border-accent bg-surface px-5 py-6"><h2 className="font-reading text-2xl text-ink">书架还没有书</h2><p className="mt-2 text-sm text-muted">导入 EPUB 后，这里会显示对应的批注。</p></div>
      ) : (
        <>
          <div className="mt-7 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-4 sm:px-5">
            <label className="flex min-w-0 flex-1 items-center gap-3"><span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">查看书籍</span><select value={selectedBookId} onChange={(event) => setSelectedBookId(event.target.value)} className="min-w-0 flex-1 border-b border-line bg-transparent px-1 py-2 font-reading text-lg text-ink outline-none focus:border-accent"><option value="">选择一本书</option>{books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label>
            <button type="button" onClick={() => onOpenBook(selectedBook)} className="border-b border-accent py-1 text-xs text-accent focus:outline-none focus:ring-2 focus:ring-accent">在阅读器中打开 →</button>
          </div>

          <div className="mt-7 flex items-center justify-between border-b border-line pb-3"><div className="flex items-center gap-3"><LibraryBookCover book={selectedBook} size="tiny" /><div><h2 className="font-reading text-2xl text-ink">已有批注</h2><p className="mt-1 text-xs text-muted">{selectedBook.title}</p></div></div><span className="font-mono text-sm text-accent">{notes.length} 条</span></div>

          {isLoading ? <p className="py-6 text-sm text-muted">正在读取批注…</p> : notes.length === 0 ? <div className="border-b border-line px-1 py-8 text-sm text-muted">这本书还没有批注。</div> : <div className="divide-y divide-line">{notes.map((note) => <NoteItem key={note.id} note={note} />)}</div>}
        </>
      )}
    </section>
  );
}

function NoteItem({ note }: { note: Note }) {
  const timestamp = noteTimestamp(note.created_at);
  return (
    <article className="grid gap-4 py-5 sm:grid-cols-[0.45rem_minmax(0,1fr)_auto] sm:items-start">
      <span className="h-full min-h-16 w-1" style={{ backgroundColor: note.color || '#c5a76b' }} aria-hidden="true" />
      <div className="min-w-0">
        <blockquote className="border-l border-line pl-4 font-reading text-lg leading-relaxed text-ink">“{note.selected_text || '未保存选中文字'}”</blockquote>
        {note.content && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted">{note.content}</p>}
      </div>
      <time className="text-xs text-muted" dateTime={new Date(timestamp).toISOString()}>{formatNoteDate(timestamp)}</time>
    </article>
  );
}

function formatNoteDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

function noteTimestamp(timestamp: number): number {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}
