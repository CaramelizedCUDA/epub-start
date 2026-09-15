interface KeyboardRendition {
  getContents(): Array<{ document: Document }>;
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
}

/** Bind directly: EPUB.js forwards key events from passive DOM listeners. */
export function installReaderKeyboard(
  rendition: KeyboardRendition,
  handleKey: (event: KeyboardEvent) => void,
): () => void {
  const documents = new Set<Document>();
  let disposed = false;
  const syncDocuments = () => {
    if (disposed) return;
    const current = new Set(rendition.getContents().map((content) => content.document));
    for (const document of documents) {
      if (!current.has(document)) {
        document.removeEventListener('keydown', handleKey);
        documents.delete(document);
      }
    }
    for (const document of current) {
      if (documents.has(document)) continue;
      document.addEventListener('keydown', handleKey, { passive: false });
      documents.add(document);
    }
  };
  rendition.on('rendered', syncDocuments);
  rendition.on('relocated', syncDocuments);
  syncDocuments();
  return () => {
    disposed = true;
    rendition.off('rendered', syncDocuments);
    rendition.off('relocated', syncDocuments);
    for (const document of documents) document.removeEventListener('keydown', handleKey);
    documents.clear();
  };
}

/** Composition and browser/OS shortcuts always win over Reader navigation. */
export function ignoreReaderShortcut(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || event.keyCode === 229
    || event.altKey || event.ctrlKey || event.metaKey;
}

export function isReaderPageKey(event: KeyboardEvent, overlayOpen: boolean): boolean {
  if (overlayOpen || ignoreReaderShortcut(event)) return false;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return false;
  const target = event.target as HTMLElement | null;
  return !target?.isContentEditable && !target?.closest?.(
    'input, select, textarea, button, [role="textbox"], [contenteditable]:not([contenteditable="false"])',
  );
}
