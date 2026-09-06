import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { BookSummary } from '../../types/models';

export function LibraryBookCover({
  book,
  size = 'small',
}: {
  book: BookSummary;
  size?: 'tiny' | 'small';
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  const dimensions = size === 'tiny' ? 'h-16 w-12' : 'h-28 w-[4.5rem] sm:h-32 sm:w-20';
  const title = book.title.length > 24 ? `${book.title.slice(0, 24)}…` : book.title;

  return (
    <div className={`relative flex shrink-0 flex-col justify-between overflow-hidden bg-[#4d6188] p-2.5 text-[#f8faf5] shadow-[0_10px_22px_rgba(24,39,44,0.1)] ${dimensions}`}>
      <span className="font-mono text-[0.55rem] tracking-[0.1em]">{book.format.toUpperCase()}</span>
      {book.cover_cache_path && !coverFailed ? (
        <img
          src={convertFileSrc(book.cover_cache_path)}
          alt=""
          onError={() => setCoverFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span className="relative font-serif text-base leading-tight">{title}</span>
      )}
      <span className="relative max-w-[4rem] font-mono text-[0.45rem] uppercase tracking-[0.08em]">EPUBSTART</span>
      <span className="absolute bottom-0 right-0 top-0 w-1 bg-white/30" aria-hidden="true" />
    </div>
  );
}
