import { useEffect, useRef, type ReactNode } from 'react';
import type { BookSummary } from '../../types/models';
import type { LibrarySection } from './BookShelf';
import { LibraryBookCover } from './LibraryBookCover';
import { bookDisplayTitle } from './bookDisplay';

interface BookActionsSheetProps {
  book: BookSummary;
  busy: boolean;
  onClose: () => void;
  onOpen: () => void;
  onRelocate: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onSection: (section: LibrarySection) => void;
}

type ActionIcon = 'book' | 'tag' | 'series' | 'notes' | 'trash';

// 单书面板只改变展示；打开、来源恢复、标签/系列和删除仍走现有真实回调。
export function BookActionsSheet({ book, busy, onClose, onOpen, onRelocate, onRetry, onDelete, onSection }: BookActionsSheetProps) {
  const display = bookDisplayTitle(book.title);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);

  return (
    <dialog ref={dialogRef} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 text-ink backdrop:bg-black/40">
      <section className="absolute inset-x-0 bottom-0 mx-auto max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] shadow-xl sm:bottom-8 sm:rounded-3xl" aria-labelledby="book-actions-title">
        <div className="mx-auto mb-3 mt-3 h-[5px] w-[55px] rounded-full bg-line" aria-hidden="true" />
        <div className="flex items-start gap-3.5 border-b border-line px-[22px] pb-[18px] pt-3">
          <LibraryBookCover book={book} size="sheet" />
          <div className="min-w-0 flex-1"><h2 id="book-actions-title" className="line-clamp-2 font-reading text-xl font-medium leading-snug">{display.heading}</h2><p className="mt-1.5 text-xs text-muted">{display.subtitle || book.authors.join(' · ') || '作者信息未提供'}</p></div>
          <button type="button" onClick={onClose} aria-label="关闭书籍操作" className="grid h-11 w-9 shrink-0 place-items-center rounded-full text-xl text-muted hover:bg-subtle">×</button>
        </div>
        {book.status !== 'available' && <p className="px-[22px] py-3 text-sm text-danger">{book.status === 'missing' ? '来源文件不可读，请重新选择。' : book.status_detail || '书籍解析失败，请重新导入。'}</p>}
        <div className="divide-y divide-line">
          <Action icon="book" onClick={onOpen} disabled={busy || book.status !== 'available'}>开始阅读</Action>
          {book.status === 'missing' && <Action icon="book" onClick={onRelocate} disabled={busy}>重新选择来源</Action>}
          {book.status === 'error' && <Action icon="book" onClick={onRetry} disabled={busy}>重新导入 EPUB</Action>}
          <Action icon="tag" onClick={() => onSection('tags')} disabled={busy}>标签</Action>
          <Action icon="series" onClick={() => onSection('series')} disabled={busy}>系列</Action>
          <Action icon="notes" onClick={() => onSection('notes')} disabled={busy}>查看批注</Action>
          <Action icon="trash" onClick={onDelete} disabled={busy} danger>从书架移除</Action>
        </div>
      </section>
    </dialog>
  );
}

function Action({ children, icon, onClick, disabled, danger = false }: { children: ReactNode; icon: ActionIcon; onClick: () => void; disabled: boolean; danger?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={`flex min-h-[62px] w-full items-center gap-4 px-[26px] py-3 text-left text-base focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 ${danger ? 'text-danger' : 'text-ink hover:text-accent'}`}><ActionGlyph icon={icon} />{children}</button>;
}

function ActionGlyph({ icon }: { icon: ActionIcon }) {
  return <svg aria-hidden="true" className="h-[23px] w-[23px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {icon === 'book' && <><path d="M4 5a3 3 0 0 1 3-3h13v17H7a3 3 0 0 0-3 3V5Z" /><path d="M4 19h16" /></>}
    {icon === 'tag' && <><path d="m20 13-7 7L3 10V3h7l10 10Z" /><circle cx="7.5" cy="7.5" r="1" /></>}
    {icon === 'series' && <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></>}
    {icon === 'notes' && <><path d="M4 20l4.3-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m14 7 3 3" /></>}
    {icon === 'trash' && <><path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14" /></>}
  </svg>;
}
