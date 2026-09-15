import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useReaderStore } from '../../stores/readerStore';
import {
  clearBookReadingSettings,
  getReadingSettings,
  saveBookImage,
  saveBookReadingSettings,
  saveGlobalReadingSettings,
} from '../../lib/tauri';
import type { Note, ReadingSettings, ReadingSettingsResult } from '../../types/models';
import type { TocItem } from 'epubjs';
import { readingBackground } from './engine/reflow';
import { createPageTurnController, type PageTurnDirection } from './engine/pageTurn';
import {
  installImageInteractions,
  type ReaderImageMenuRequest,
  type ReaderImageTarget,
} from './engine/imageInteractions';
import {
  clearActiveSelection,
  installHighlightEngine,
  NOTE_COLORS,
  type SelectionInfo,
} from './engine/highlights';
import { ImageViewer } from './ImageViewer';
import { NotesPanel } from './NotesPanel';
import { NoteEditorModal, NoteMenu, SelectionMenu } from './AnnotationMenu';
import { useReadingActivity } from './useReadingActivity';
import { queueSettingsWrite } from './settingsPersistence';
import { ignoreReaderShortcut, installReaderKeyboard, isReaderPageKey } from './engine/keyboard';

const RESIZE_DEBOUNCE_MS = 300;
const SETTINGS_SAVE_DEBOUNCE_MS = 300;
const PAGE_TURN_EFFECT_MS = 320;
const PAGE_TURN_GESTURE_CANCEL_MS = 180;
const PAGE_TURN_GESTURE_RELEASE_MS = 260;

interface EpubReaderProps {
  bookId: string;
  epubRootUrl: string;
  initialHref?: string;
  onClose: () => void;
}

type EditorDraft =
  | { kind: 'new'; selection: SelectionInfo; color: string }
  | { kind: 'edit'; note: Note };

type ReaderPanel = 'toc' | 'search' | 'notes' | 'settings';
type PageTurnEffectPhase = 'playing' | 'dragging' | 'settling' | 'canceling';
interface PageTurnEffect {
  contentDriven: boolean;
  direction: PageTurnDirection;
  id: number;
  phase: PageTurnEffectPhase;
  progress: number;
}

export function EpubReader({ bookId, epubRootUrl, initialHref, onClose }: EpubReaderProps) {
  const {
    open,
    close,
    nextPage,
    prevPage,
    currentPage,
    totalPages,
    isLoading,
    error,
    toc,
    currentChapterHref,
    rendition,
    searchResults,
    isSearching,
    hasSearched,
    searchError,
    searchLimited,
    goToHref,
    searchCurrentBook,
    applyReadingSettings,
    reflowViewport,
    toggleFullscreen,
    exitFullscreen,
    notes,
    pendingSelection,
    clickedNote,
    loadNotes,
    setPendingSelection,
    setClickedNote,
    addNote,
    editNote,
    removeNote,
    jumpToNote,
  } = useReaderStore();

  const openedRef = useRef(false);
  const [activePanel, setActivePanel] = useState<ReaderPanel | null>(null);
  const [isNavigationVisible, setIsNavigationVisible] = useState(true);
  const [settingsResult, setSettingsResult] = useState<ReadingSettingsResult | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<ReadingSettings | null>(null);
  const [settingsScope, setSettingsScope] = useState<'global' | 'book'>('global');
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [query, setQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageTarget, setImageTarget] = useState<ReaderImageTarget | null>(null);
  const [imageMenu, setImageMenu] = useState<ReaderImageMenuRequest | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<EditorDraft | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const settingsDraftRef = useRef<ReadingSettings | null>(null);
  const settingsResultRef = useRef<ReadingSettingsResult | null>(null);
  const settingsScopeRef = useRef<'global' | 'book'>('global');
  const saveTimerRef = useRef<number | null>(null);
  const saveGenerationRef = useRef(0);
  const readerEpochRef = useRef(0);
  const pendingSettingsSaveRef = useRef<(() => void) | null>(null);
  const pageTurnEffectIdRef = useRef(0);
  const pageTurnEffectTimerRef = useRef<number | null>(null);
  const pageTurnEffectRef = useRef<PageTurnEffect | null>(null);
  const pageTurnEffectElementRef = useRef<HTMLDivElement | null>(null);
  const pageTurnControllerRef = useRef<ReturnType<typeof createPageTurnController> | null>(null);
  useEffect(() => {
    const controller = createPageTurnController(rendition);
    pageTurnControllerRef.current = controller;
    return () => {
      controller.dispose();
      if (pageTurnControllerRef.current === controller) pageTurnControllerRef.current = null;
    };
  }, [rendition]);
  const [pageTurnEffect, setPageTurnEffect] = useState<PageTurnEffect | null>(null);

  const togglePanel = (panel: ReaderPanel) => {
    setActivePanel((current) => current === panel ? null : panel);
    setIsNavigationVisible(true);
  };

  useReadingActivity({
    bookId,
    isReady: Boolean(rendition) && !isLoading && !error,
  });

  useEffect(() => { settingsDraftRef.current = settingsDraft; }, [settingsDraft]);
  useEffect(() => { settingsResultRef.current = settingsResult; }, [settingsResult]);
  useEffect(() => { settingsScopeRef.current = settingsScope; }, [settingsScope]);

  useEffect(() => {
    let active = true;
    ++readerEpochRef.current;
    queueSettingsWrite(() => getReadingSettings({ bookId }))
      .then((result) => {
        if (!active) return;
        setSettingsResult(result);
        setSettingsDraft(result.effective);
        setSettingsScope(result.book_override ? 'book' : 'global');
        if (active && !openedRef.current) {
          openedRef.current = true;
          return open(bookId, epubRootUrl, result.effective, initialHref);
        }
        return undefined;
      })
      .catch((err: unknown) => {
        if (!active) return;
        setSettingsResult(null);
        setSettingsDraft(null);
        setSettingsError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
      ++readerEpochRef.current;
      close();
      openedRef.current = false;
    };
  }, [bookId, epubRootUrl, initialHref, open, close]);

  const changeSettingsScope = (scope: 'global' | 'book') => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSettingsSaveRef.current;
    pendingSettingsSaveRef.current = null;
    pending?.();
    settingsScopeRef.current = scope;
    setSettingsScope(scope);
    if (scope === 'global' && settingsResult) {
      setSettingsDraft(settingsResult.global);
    } else if (scope === 'book' && settingsResult) {
      setSettingsDraft(settingsResult.book_override
        ? mergeReadingSettings(settingsResult.global, settingsResult.book_override)
        : settingsResult.global);
    }
  };

  const persistSettings = useCallback(async (
    draft: ReadingSettings,
    scope: 'global' | 'book',
    readerEpoch: number,
  ) => {
    const generation = ++saveGenerationRef.current;
    const isCurrent = () => readerEpoch === readerEpochRef.current
      && generation === saveGenerationRef.current;
    if (isCurrent()) {
      setIsSavingSettings(true);
      setSettingsError(null);
    }
    const saveOnce = async () => {
      if (scope === 'global') {
        await saveGlobalReadingSettings(stripUpdatedAt(draft));
      } else {
        await saveBookReadingSettings({
          settings: { book_id: bookId, ...stripUpdatedAt(draft) },
        });
      }
      // Read the authoritative merged settings inside the same queue. An older
      // cross-scope response must not leave the next save using a stale global.
      const next = await getReadingSettings({ bookId });
      if (isCurrent()) {
        settingsResultRef.current = next;
        setSettingsResult(next);
      }
    };
    try {
      await queueSettingsWrite(async () => {
        try {
          await saveOnce();
        } catch {
          await saveOnce();
        }
      });
    } catch (err) {
      if (isCurrent()) setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isCurrent()) setIsSavingSettings(false);
    }
  }, [bookId]);

  const previewSettings = useCallback((draft: ReadingSettings) => {
    settingsDraftRef.current = draft;
    setSettingsDraft(draft);
    const readerEpoch = readerEpochRef.current;
    const override = settingsResultRef.current?.book_override;
    const preview = settingsScopeRef.current === 'global' && override
      ? mergeReadingSettings(draft, override)
      : draft;
    applyReadingSettings(preview).catch((err: unknown) => {
      if (readerEpoch === readerEpochRef.current) {
        setSettingsError(err instanceof Error ? err.message : String(err));
      }
    });
  }, [applyReadingSettings]);

  const scheduleSettingsSave = useCallback((draft: ReadingSettings) => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    const scope = settingsScopeRef.current;
    const readerEpoch = readerEpochRef.current;
    const save = () => { void persistSettings(draft, scope, readerEpoch); };
    pendingSettingsSaveRef.current = save;
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      pendingSettingsSaveRef.current = null;
      save();
    }, SETTINGS_SAVE_DEBOUNCE_MS);
  }, [persistSettings]);

  const updateNumericSetting = useCallback((
    key: NumericSettingKey,
    value: number,
    persist: boolean,
  ) => {
    const current = settingsDraftRef.current;
    if (!current) return;
    const draft = { ...current, [key]: value };
    previewSettings(draft);
    if (persist) scheduleSettingsSave(draft);
  }, [previewSettings, scheduleSettingsSave]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const pending = pendingSettingsSaveRef.current;
    pendingSettingsSaveRef.current = null;
    pending?.();
  }, [bookId]);

  const clearBookOverride = async () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    pendingSettingsSaveRef.current = null;
    const readerEpoch = readerEpochRef.current;
    const generation = ++saveGenerationRef.current;
    const isCurrent = () => readerEpoch === readerEpochRef.current
      && generation === saveGenerationRef.current;
    setIsSavingSettings(true);
    setSettingsError(null);
    try {
      const result = await queueSettingsWrite(async () => {
        await clearBookReadingSettings({ bookId });
        return getReadingSettings({ bookId });
      });
      if (!isCurrent()) return;
      settingsResultRef.current = result;
      settingsDraftRef.current = result.effective;
      settingsScopeRef.current = 'global';
      setSettingsResult(result);
      setSettingsDraft(result.effective);
      setSettingsScope('global');
      await applyReadingSettings(result.effective);
    } catch (err) {
      if (isCurrent()) setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isCurrent()) setIsSavingSettings(false);
    }
  };

  const showPageTurnEffect = useCallback((direction: PageTurnDirection) => {
    if (pageTurnEffectTimerRef.current !== null) {
      window.clearTimeout(pageTurnEffectTimerRef.current);
    }
    pageTurnEffectIdRef.current += 1;
    const effect: PageTurnEffect = {
      contentDriven: false,
      direction,
      id: pageTurnEffectIdRef.current,
      phase: 'playing',
      progress: 0,
    };
    pageTurnEffectRef.current = effect;
    setPageTurnEffect(effect);
    const effectId = effect.id;
    pageTurnEffectTimerRef.current = window.setTimeout(() => {
      if (pageTurnEffectRef.current?.id !== effectId) return;
      pageTurnEffectTimerRef.current = null;
      pageTurnEffectRef.current = null;
      setPageTurnEffect(null);
    }, PAGE_TURN_EFFECT_MS);
  }, []);

  const restorePageTurnSurfaceImmediately = useCallback(() => {
    pageTurnControllerRef.current?.reset();
  }, []);

  const updatePageTurnGesture = useCallback((
    direction: PageTurnDirection,
    progress: number,
    distancePx: number,
  ) => {
    const boundedProgress = Math.max(0, Math.min(1, progress));
    const contentDriven = pageTurnControllerRef.current?.update(direction, distancePx) ?? false;
    const current = pageTurnEffectRef.current;
    if (!current || current.phase !== 'dragging' || current.direction !== direction) {
      if (pageTurnEffectTimerRef.current !== null) {
        window.clearTimeout(pageTurnEffectTimerRef.current);
        pageTurnEffectTimerRef.current = null;
      }
      pageTurnEffectIdRef.current += 1;
      const effect: PageTurnEffect = {
        contentDriven,
        direction,
        id: pageTurnEffectIdRef.current,
        phase: 'dragging',
        progress: boundedProgress,
      };
      pageTurnEffectRef.current = effect;
      setPageTurnEffect(effect);
      return;
    }
    current.progress = boundedProgress;
    current.contentDriven = contentDriven;
    pageTurnEffectElementRef.current?.style.setProperty(
      '--reader-page-turn-edge-position',
      `${(direction === 'next' ? 1 - boundedProgress : boundedProgress) * 100}%`,
    );
  }, []);

  const cancelPageTurnGesture = useCallback(() => {
    const current = pageTurnEffectRef.current;
    if (!current || current.phase !== 'dragging') return;
    if (pageTurnEffectTimerRef.current !== null) {
      window.clearTimeout(pageTurnEffectTimerRef.current);
    }
    const effect: PageTurnEffect = { ...current, phase: 'canceling' };
    pageTurnEffectRef.current = effect;
    setPageTurnEffect(effect);
    pageTurnControllerRef.current?.cancel(PAGE_TURN_GESTURE_CANCEL_MS);
    const effectId = effect.id;
    pageTurnEffectTimerRef.current = window.setTimeout(() => {
      if (pageTurnEffectRef.current?.id !== effectId) return;
      pageTurnEffectTimerRef.current = null;
      pageTurnEffectRef.current = null;
      setPageTurnEffect(null);
    }, PAGE_TURN_GESTURE_CANCEL_MS);
  }, []);

  const commitPageTurnGesture = useCallback((
    direction: PageTurnDirection,
    progress: number,
    _distancePx: number,
  ) => {
    if (pageTurnEffectTimerRef.current !== null) {
      window.clearTimeout(pageTurnEffectTimerRef.current);
      pageTurnEffectTimerRef.current = null;
    }
    const boundedProgress = Math.max(0, Math.min(1, progress));
    const current = pageTurnEffectRef.current;
    const effect: PageTurnEffect = current
      && current.phase === 'dragging'
      && current.direction === direction
      ? { ...current, phase: 'settling', progress: boundedProgress }
      : {
        contentDriven: false,
        direction,
        id: ++pageTurnEffectIdRef.current,
        phase: 'settling',
        progress: boundedProgress,
      };
    pageTurnEffectRef.current = effect;
    setPageTurnEffect(effect);

    if (!pageTurnControllerRef.current?.commit(direction, PAGE_TURN_GESTURE_RELEASE_MS)) {
      // Chapter edges, RTL, and continuous flow use EPUB.js navigation.
      if (direction === 'previous') prevPage();
      else nextPage();
    }

    const effectId = effect.id;
    pageTurnEffectTimerRef.current = window.setTimeout(() => {
      if (pageTurnEffectRef.current?.id !== effectId) return;
      pageTurnEffectTimerRef.current = null;
      pageTurnEffectRef.current = null;
      setPageTurnEffect(null);
    }, PAGE_TURN_GESTURE_RELEASE_MS);
  }, [nextPage, prevPage]);

  const handlePreviousPage = useCallback(() => {
    restorePageTurnSurfaceImmediately();
    prevPage();
    showPageTurnEffect('previous');
  }, [prevPage, restorePageTurnSurfaceImmediately, showPageTurnEffect]);

  const handleNextPage = useCallback(() => {
    restorePageTurnSurfaceImmediately();
    nextPage();
    showPageTurnEffect('next');
  }, [nextPage, restorePageTurnSurfaceImmediately, showPageTurnEffect]);

  useEffect(() => () => {
    if (pageTurnEffectTimerRef.current !== null) {
      window.clearTimeout(pageTurnEffectTimerRef.current);
      pageTurnEffectTimerRef.current = null;
    }
    restorePageTurnSurfaceImmediately();
    pageTurnEffectRef.current = null;
  }, [restorePageTurnSurfaceImmediately]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (ignoreReaderShortcut(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (imageMenu || imageTarget) {
          setImageMenu(null);
          setImageTarget(null);
          return;
        }
        if (editorDraft) {
          setEditorDraft(null);
          clearActiveSelection();
          return;
        }
        if (pendingSelection || clickedNote) {
          setPendingSelection(null);
          setClickedNote(null);
          clearActiveSelection();
          return;
        }
        if (activePanel) {
          setActivePanel(null);
          return;
        }
        exitFullscreen()
          .then((exited) => { if (exited) setIsFullscreen(false); })
          .catch((err: unknown) => setSettingsError(err instanceof Error ? err.message : String(err)));
        return;
      }
      if (!isReaderPageKey(e, Boolean(isLoading || error || activePanel || editorDraft
        || imageTarget || imageMenu || pendingSelection || clickedNote))) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        handleNextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        handlePreviousPage();
      }
    };
    window.addEventListener('keydown', handleKey);
    // Keyboard events inside EPUB iframes do not bubble to the parent window.
    const cleanupKeyboard = rendition ? installReaderKeyboard(rendition, handleKey) : undefined;
    return () => {
      window.removeEventListener('keydown', handleKey);
      cleanupKeyboard?.();
    };
  }, [handleNextPage, handlePreviousPage, exitFullscreen, editorDraft, pendingSelection, clickedNote, activePanel, setPendingSelection, setClickedNote, rendition, imageTarget, imageMenu, isLoading, error]);

  useEffect(() => {
    if (!rendition || isLoading) return;
    let resizeTimer: number | null = null;
    const handleResize = () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        reflowViewport().catch((err: unknown) => {
          setSettingsError(err instanceof Error ? err.message : String(err));
        });
      }, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    };
  }, [rendition, isLoading, reflowViewport]);

  useEffect(() => {
    if (!rendition || isLoading) return;
    return installImageInteractions(rendition, epubRootUrl, bookId, {
      onOpen: (target) => {
        setImageError(null);
        setImageMenu(null);
        setImageTarget(target);
      },
      onContextMenu: (request) => {
        setImageError(null);
        setImageMenu(request);
      },
      onError: (message) => {
        setImageMenu(null);
        setImageError(message);
      },
      onPreviousPage: handlePreviousPage,
      onNextPage: handleNextPage,
      onPageTurnGestureMove: updatePageTurnGesture,
      onPageTurnGestureCancel: cancelPageTurnGesture,
      onPageTurnGestureCommit: commitPageTurnGesture,
      onToggleNavigation: () => setIsNavigationVisible((visible) => !visible),
      isPaginated: () => settingsDraftRef.current?.flow !== 'scrolled',
    });
  }, [
    rendition,
    isLoading,
    epubRootUrl,
    bookId,
    handlePreviousPage,
    handleNextPage,
    updatePageTurnGesture,
    cancelPageTurnGesture,
    commitPageTurnGesture,
  ]);

  // 打开完成后加载批注并恢复高亮标记。
  useEffect(() => {
    if (isLoading || !openedRef.current) return;
    let active = true;
    loadNotes().catch((err: unknown) => {
      if (!active) return;
      setNotesError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      active = false;
    };
  }, [bookId, isLoading, loadNotes]);

  // 选区与高亮标记点击的引擎适配：selection → 浮动菜单，标记点击 → 批注菜单。
  useEffect(() => {
    if (!rendition || isLoading) return;
    return installHighlightEngine(rendition, {
      onSelect: (selection) => {
        setClickedNote(null);
        setPendingSelection(selection);
      },
      onMarkClick: (click) => {
        setPendingSelection(null);
        setClickedNote(click);
      },
      onSelectionCleared: () => setPendingSelection(null),
      onDocumentInteraction: () => setClickedNote(null),
    });
  }, [rendition, isLoading, setPendingSelection, setClickedNote]);

  const handleHighlight = (color: string) => {
    const selection = pendingSelection;
    if (!selection) return;
    setPendingSelection(null);
    clearActiveSelection();
    setNotesError(null);
    setIsSavingNote(true);
    addNote({
      book_id: bookId,
      cfi_start: selection.cfiStart,
      cfi_end: selection.cfiEnd,
      cfi_range: selection.cfiRange,
      selected_text: selection.selectedText,
      content: '',
      color,
    })
      .catch((err: unknown) => setNotesError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsSavingNote(false));
  };

  const openNoteEditorForSelection = () => {
    const selection = pendingSelection;
    if (!selection) return;
    setPendingSelection(null);
    setEditorDraft({ kind: 'new', selection, color: NOTE_COLORS[0] });
  };

  const openNoteEditorForNote = (note: Note) => {
    setClickedNote(null);
    setNotesError(null);
    setEditorDraft({ kind: 'edit', note });
  };

  const saveEditorDraft = (content: string, color: string) => {
    if (!editorDraft) return;
    setNotesError(null);
    setIsSavingNote(true);
    const readerEpoch = readerEpochRef.current;
    const run =
      editorDraft.kind === 'new'
        ? addNote({
            book_id: bookId,
            cfi_start: editorDraft.selection.cfiStart,
            cfi_end: editorDraft.selection.cfiEnd,
            cfi_range: editorDraft.selection.cfiRange,
            selected_text: editorDraft.selection.selectedText,
            content: content.trim(),
            color,
          })
        : editNote({
            id: editorDraft.note.id,
            cfi_start: editorDraft.note.cfi_start,
            cfi_end: editorDraft.note.cfi_end,
            cfi_range: editorDraft.note.cfi_range,
            selected_text: editorDraft.note.selected_text,
            content: content.trim(),
            color,
          });
    run
      .then(() => {
        if (readerEpoch !== readerEpochRef.current) return;
        clearActiveSelection();
        setEditorDraft(null);
      })
      .catch((err: unknown) => setNotesError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsSavingNote(false));
  };

  const handleDeleteNote = (noteId: string) => {
    setNotesError(null);
    setIsSavingNote(true);
    removeNote(noteId)
      .then(() => {
        setEditorDraft(null);
        setClickedNote(null);
      })
      .catch((err: unknown) => setNotesError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsSavingNote(false));
  };

  const handleNoteColor = (note: Note, color: string) => {
    if (note.color === color) return;
    setNotesError(null);
    editNote({
      id: note.id,
      cfi_start: note.cfi_start,
      cfi_end: note.cfi_end,
      cfi_range: note.cfi_range,
      selected_text: note.selected_text,
      content: note.content,
      color,
    }).catch((err: unknown) => setNotesError(err instanceof Error ? err.message : String(err)));
  };

  const handleJumpToNote = (noteId: string) => {
    jumpToNote(noteId);
    setActivePanel(null);
  };

  const handleGoToHref = (href: string) => {
    goToHref(href);
    setActivePanel(null);
  };

  const handleFullscreen = async () => {
    setSettingsError(null);
    try {
      setIsFullscreen(await toggleFullscreen());
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveImage = async () => {
    if (!imageTarget) return;
    setImageError(null);
    if (!imageTarget.entryPath) {
      setImageError('\u8fd9\u5f20\u56fe\u7247\u53ef\u4ee5\u67e5\u770b\uff0c\u4f46\u65e0\u6cd5\u89e3\u6790\u5176 EPUB \u6761\u76ee\u8def\u5f84\uff0c\u56e0\u6b64\u4e0d\u80fd\u5b89\u5168\u5bfc\u51fa\u3002');
      return;
    }
    try {
      await saveBookImage({ bookId, entryPath: imageTarget.entryPath });
    } catch (err) {
      setImageError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveImageTarget = async (target: ReaderImageTarget) => {
    setImageError(null);
    if (!target.entryPath) {
      setImageError('\u8fd9\u5f20\u56fe\u7247\u53ef\u4ee5\u67e5\u770b\uff0c\u4f46\u65e0\u6cd5\u89e3\u6790\u5176 EPUB \u6761\u76ee\u8def\u5f84\uff0c\u56e0\u6b64\u4e0d\u80fd\u5b89\u5168\u5bfc\u51fa\u3002');
      return;
    }
    try {
      await saveBookImage({ bookId, entryPath: target.entryPath });
    } catch (err) {
      setImageError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-center max-w-md">
          <p className="text-red-400 text-lg mb-4">打开失败</p>
          <p className="text-gray-400 mb-6 text-sm break-all">{error}</p>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
          >
            返回书架
          </button>
        </div>
      </div>
    );
  }

  const clickedNoteNote = clickedNote
    ? notes.find((note) => note.id === clickedNote.noteId)
    : undefined;

  return (
    <div
      className="reader-shell relative flex h-screen min-h-0 flex-col overflow-hidden text-white"
      style={{ backgroundColor: readingBackground(settingsResult?.effective ?? null) }}
    >
      {/* Reader viewport */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ backgroundColor: readingBackground(settingsResult?.effective ?? null) }}
      >
        <div
          id="epub-reader-viewport"
          className="absolute inset-x-0 top-0 bottom-28 min-h-0 sm:bottom-16"
        />

        {isLoading && (
          <div className="absolute inset-x-0 top-0 bottom-28 z-20 flex items-center justify-center bg-gray-900 text-white sm:bottom-16">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4" />
              <p className="text-lg">Loading EPUB...</p>
            </div>
          </div>
        )}
        {pageTurnEffect && (
          <div
            key={pageTurnEffect.id}
            data-reader-page-turn={pageTurnEffect.direction}
            data-reader-page-turn-phase={pageTurnEffect.phase}
            className={`reader-page-turn-effect ${pageTurnEffect.direction === 'next'
              ? 'reader-page-turn-effect-next'
              : 'reader-page-turn-effect-previous'} ${pageTurnEffect.phase === 'dragging'
              ? 'reader-page-turn-effect-dragging'
              : pageTurnEffect.phase === 'settling'
                ? 'reader-page-turn-effect-settling'
                  : pageTurnEffect.phase === 'canceling'
                    ? 'reader-page-turn-effect-canceling'
                    : 'reader-page-turn-effect-playing'} ${pageTurnEffect.contentDriven
                      ? 'reader-page-turn-effect-content-driven'
                      : ''}`}
            ref={pageTurnEffectElementRef}
            style={{
              '--reader-page-turn-edge-position': `${(pageTurnEffect.direction === 'next' ? 1 - pageTurnEffect.progress : pageTurnEffect.progress) * 100}%`,
            } as CSSProperties}
            aria-hidden="true"
          />
        )}
        {/* Visible controls and keyboard navigation do not cover EPUB image hit targets. */}
      </div>

      {activePanel && (
        <>
          <button
            type="button"
            aria-label="关闭阅读工具面板"
            className="absolute inset-0 z-20 bg-black/10"
            onClick={() => setActivePanel(null)}
          />
          <aside
            data-reader-panel
            className="absolute bottom-28 left-3 right-3 z-30 max-h-[calc(100vh-9rem)] overflow-hidden rounded-2xl border border-gray-600 bg-gray-800/95 shadow-2xl backdrop-blur sm:bottom-16 sm:left-auto sm:right-6 sm:w-[min(28rem,calc(100%-3rem))] sm:max-h-[calc(100vh-7rem)]"
          >
            <div className="max-h-[calc(100vh-9rem)] overflow-y-auto p-4 sm:max-h-[calc(100vh-7rem)]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-semibold">
                  {activePanel === 'toc' && '目录'}
                  {activePanel === 'search' && '搜索当前书籍'}
                  {activePanel === 'notes' && '批注'}
                  {activePanel === 'settings' && '阅读设置'}
                </h2>
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 hover:text-white"
                  onClick={() => setActivePanel(null)}
                >
                  关闭
                </button>
              </div>

              {activePanel === 'toc' && (
                <div>
                  {toc.length === 0 ? (
                    <p className="text-sm text-gray-400">此书未提供目录。</p>
                  ) : (
                    <TocTree
                      items={toc}
                      currentHref={currentChapterHref}
                      onNavigate={handleGoToHref}
                    />
                  )}
                </div>
              )}
              {activePanel === 'search' && (
                <div>
                  <div className="flex gap-2">
                    <input
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        void searchCurrentBook('');
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void searchCurrentBook(query);
                        }
                      }}
                      maxLength={200}
                      aria-label="搜索当前书籍"
                      className="min-w-0 flex-1 rounded bg-gray-700 px-3 py-2 text-base"
                      placeholder="输入关键词"
                    />
                    <button type="button" disabled={isSearching} onClick={() => void searchCurrentBook(query)} className="reader-control">{isSearching ? '查找中…' : '查找'}</button>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">至少输入 2 个字符。每章显示首处摘要，点击跳转到章节，不是字词级 CFI 定位。</p>
                  <div role="status" aria-live="polite" className="mt-2 text-xs text-gray-300">
                    {isSearching && '正在逐章查找…'}
                    {searchError && <p>{searchError}</p>}
                    {searchLimited && <p>已达到 50 个命中章节的上限；后续章节尚未扫描。</p>}
                    {hasSearched && !isSearching && !searchError && searchResults.length === 0 && '没有匹配的章节。'}
                  </div>
                  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {searchResults.map((result, index) => (
                      <button
                        type="button"
                        key={`${result.href}-${index}`}
                        onClick={() => handleGoToHref(result.href)}
                        className="block w-full rounded bg-gray-700/60 p-2 text-left text-xs"
                      >
                        {result.excerpt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {activePanel === 'notes' && (
                <NotesPanel
                  onJump={handleJumpToNote}
                  onEdit={openNoteEditorForNote}
                  onDelete={(noteId) => void handleDeleteNote(noteId)}
                />
              )}
              {activePanel === 'settings' && settingsDraft && (
                <div>
                  <div className="mb-3 grid grid-cols-2 rounded bg-gray-900 p-1 text-sm">
                    <button type="button" onClick={() => changeSettingsScope('global')} className={`rounded px-2 py-1 ${settingsScope === 'global' ? 'bg-blue-600' : 'text-gray-400'}`}>全局默认</button>
                    <button type="button" onClick={() => changeSettingsScope('book')} className={`rounded px-2 py-1 ${settingsScope === 'book' ? 'bg-blue-600' : 'text-gray-400'}`}>仅本书</button>
                  </div>
                  <div className="space-y-3 text-sm">
                    <SettingSelect label="主题" value={settingsDraft.theme} onChange={(value) => { const draft = { ...settingsDraft, theme: value as ReadingSettings['theme'] }; previewSettings(draft); scheduleSettingsSave(draft); }} options={[['light', '浅色'], ['sepia', '暖色'], ['dark', '深色']]} />
                    <SettingSelect label="字体" value={settingsDraft.font_family} onChange={(value) => { const draft = { ...settingsDraft, font_family: value as ReadingSettings['font_family'] }; previewSettings(draft); scheduleSettingsSave(draft); }} options={[['publisher', '出版方'], ['serif', '衬线'], ['sans', '无衬线'], ['system', '系统']]} />
                    <SettingStepper label="字号" value={settingsDraft.font_size_px} min={12} max={32} step={1} unit="px" onPreview={(value, persist) => updateNumericSetting('font_size_px', value, persist)} />
                    <SettingStepper label="行距" value={settingsDraft.line_height_multiplier} min={1} max={3} step={0.1} onPreview={(value, persist) => updateNumericSetting('line_height_multiplier', value, persist)} />
                    <SettingStepper label="段落行距" value={settingsDraft.paragraph_spacing_multiplier} min={0} max={2} step={0.1} onPreview={(value, persist) => updateNumericSetting('paragraph_spacing_multiplier', value, persist)} />
                    <SettingStepper label="首行缩进" value={settingsDraft.text_indent_em} min={0} max={4} step={0.5} unit="em" onPreview={(value, persist) => updateNumericSetting('text_indent_em', value, persist)} />
                    <SettingStepper label="上边距" value={settingsDraft.margin_top_px} min={0} max={100} step={1} unit="px" onPreview={(value, persist) => updateNumericSetting('margin_top_px', value, persist)} />
                    <SettingStepper label="下边距" value={settingsDraft.margin_bottom_px} min={0} max={100} step={1} unit="px" onPreview={(value, persist) => updateNumericSetting('margin_bottom_px', value, persist)} />
                    <SettingStepper label="左边距" value={settingsDraft.margin_left_percent} min={0} max={20} step={1} unit="%" onPreview={(value, persist) => updateNumericSetting('margin_left_percent', value, persist)} />
                    <SettingStepper label="右边距" value={settingsDraft.margin_right_percent} min={0} max={20} step={1} unit="%" onPreview={(value, persist) => updateNumericSetting('margin_right_percent', value, persist)} />
                    <SettingStepper label="最大列宽" value={settingsDraft.max_column_width_px} min={300} max={1200} step={10} unit="px" onPreview={(value, persist) => updateNumericSetting('max_column_width_px', value, persist)} />
                    <SettingSelect label="排版" value={settingsDraft.flow} onChange={(value) => { const draft = { ...settingsDraft, flow: value as ReadingSettings['flow'] }; previewSettings(draft); scheduleSettingsSave(draft); }} options={[['paginated', '分页'], ['scrolled', '滚动']]} />
                    <SettingSelect label="跨页" value={settingsDraft.spread} onChange={(value) => { const draft = { ...settingsDraft, spread: value as ReadingSettings['spread'] }; previewSettings(draft); scheduleSettingsSave(draft); }} options={[['auto', '自动'], ['none', '单页'], ['always', '双页']]} />
                  </div>
                  {settingsError && <p className="mt-3 text-xs text-red-300">{settingsError}</p>}
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    {settingsResult?.book_override && <button type="button" disabled={isSavingSettings} onClick={clearBookOverride} className="reader-control">清除单书覆盖</button>}
                    <span className="self-center text-xs text-gray-400">{isSavingSettings ? '保存中…' : '已自动保存'}</span>
                  </div>
                </div>
              )}
              {activePanel === 'settings' && !settingsDraft && (
                <p className="text-sm text-gray-400">正在加载阅读设置…</p>
              )}
            </div>
          </aside>
        </>
      )}

      {isNavigationVisible && (
        <nav
          data-reader-navigation
          aria-label="阅读工具"
          className="reader-navigation pointer-events-none absolute bottom-3 left-3 right-3 z-40 flex justify-center"
        >
          <div className="pointer-events-auto flex max-w-full flex-col gap-1 rounded-2xl border border-white/10 bg-[#17212b]/95 p-2 shadow-2xl backdrop-blur sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
            <div className="flex max-w-full shrink-0 flex-wrap items-center justify-center gap-1">
              <button
                type="button"
                data-reader-back
                onClick={onClose}
                className="reader-nav-button reader-nav-primary"
                aria-label="返回书架"
              >
                <span aria-hidden="true">←</span>
                <span>藏书</span>
              </button>
              <span data-reader-page className="min-w-[4.5rem] px-2 text-center text-xs text-gray-300" aria-live="polite">
                {currentPage} / {totalPages}
              </span>
              <button type="button" onClick={handlePreviousPage} className="reader-nav-button reader-nav-page" aria-label="上一页" title="上一页">‹</button>
              <button type="button" onClick={handleNextPage} className="reader-nav-button reader-nav-page" aria-label="下一页" title="下一页">›</button>
            </div>
            <div className="flex max-w-full shrink-0 flex-wrap items-center justify-center gap-1">
              <button type="button" data-reader-tool="toc" onClick={() => togglePanel('toc')} className={`reader-nav-button ${activePanel === 'toc' ? 'reader-nav-active' : ''}`}>目录</button>
              <button type="button" data-reader-tool="search" onClick={() => togglePanel('search')} className={`reader-nav-button ${activePanel === 'search' ? 'reader-nav-active' : ''}`}>搜索</button>
              <button type="button" data-reader-tool="notes" onClick={() => togglePanel('notes')} className={`reader-nav-button ${activePanel === 'notes' ? 'reader-nav-active' : ''}`}>批注</button>
              <button type="button" data-reader-tool="settings" onClick={() => togglePanel('settings')} className={`reader-nav-button ${activePanel === 'settings' ? 'reader-nav-active' : ''}`}>设置</button>
              <button type="button" data-reader-tool="fullscreen" onClick={handleFullscreen} className="reader-nav-button desktop-fullscreen-control">
                {isFullscreen ? '退出全屏' : '全屏'}
              </button>
            </div>
          </div>
        </nav>
      )}

      {imageTarget && (
        <ImageViewer
          target={imageTarget}
          initialMenuPoint={null}
          isFullscreen={isFullscreen}
          onClose={() => { setImageTarget(null); setImageMenu(null); setImageError(null); }}
           onOpenSettings={() => { setActivePanel('settings'); setIsNavigationVisible(true); setImageTarget(null); setImageMenu(null); }}
          onToggleFullscreen={() => { void handleFullscreen(); }}
          onSave={handleSaveImage}
        />
      )}
      {imageMenu && !imageTarget && (
        <div
          className="fixed z-50 min-w-44 rounded border border-gray-600 bg-gray-800 p-1 text-white shadow-xl"
          style={{ left: Math.min(imageMenu.point.x, window.innerWidth - 190), top: Math.min(imageMenu.point.y, window.innerHeight - 110) }}
        >
          <p className="px-3 py-1 text-xs text-gray-400">更多工具</p>
          <button
            type="button"
            className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-700"
            onClick={() => { setImageTarget(imageMenu.target); setImageMenu(null); }}
          >
            放大图像
          </button>
          <button
            type="button"
            className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-700"
            onClick={() => { const target = imageMenu.target; setImageMenu(null); void saveImageTarget(target); }}
          >
            另存为…
          </button>
        </div>
      )}
      {imageError && (
        <div className="fixed bottom-4 left-1/2 z-[60] max-w-xl -translate-x-1/2 rounded border border-red-700 bg-red-950 px-4 py-3 text-sm text-red-100 shadow-xl">
          {imageError}
        </div>
      )}

      {pendingSelection && !editorDraft && (
        <SelectionMenu
          selection={pendingSelection}
          onHighlight={handleHighlight}
          onAddNote={openNoteEditorForSelection}
          onClose={() => {
            setPendingSelection(null);
            clearActiveSelection();
          }}
        />
      )}
      {clickedNoteNote && clickedNote && !editorDraft && (
        <NoteMenu
          note={clickedNoteNote}
          point={clickedNote.point}
          onColor={(color) => handleNoteColor(clickedNoteNote, color)}
          onEdit={() => openNoteEditorForNote(clickedNoteNote)}
          onDelete={() => void handleDeleteNote(clickedNoteNote.id)}
          onClose={() => setClickedNote(null)}
        />
      )}
      {editorDraft && (
        <NoteEditorModal
          title={editorDraft.kind === 'new' ? '添加批注' : '编辑批注'}
          excerpt={
            editorDraft.kind === 'new'
              ? editorDraft.selection.selectedText
              : editorDraft.note.selected_text
          }
          initialContent={editorDraft.kind === 'new' ? '' : editorDraft.note.content}
          initialColor={editorDraft.kind === 'new' ? editorDraft.color : editorDraft.note.color}
          canDelete={editorDraft.kind === 'edit'}
          saving={isSavingNote}
          error={notesError}
          onSave={saveEditorDraft}
          onDelete={() => {
            if (editorDraft.kind === 'edit') void handleDeleteNote(editorDraft.note.id);
          }}
          onCancel={() => {
            setEditorDraft(null);
            clearActiveSelection();
          }}
        />
      )}
      {notesError && !editorDraft && (
        <div className="fixed bottom-4 left-1/2 z-[60] flex max-w-xl -translate-x-1/2 items-center gap-3 rounded border border-red-700 bg-red-950 px-4 py-3 text-sm text-red-100 shadow-xl">
          <span>{notesError}</span>
          <button
            type="button"
            onClick={() => setNotesError(null)}
            className="text-xs text-red-300 underline hover:text-red-100"
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}

interface TocTreeProps {
  items: TocItem[];
  currentHref: string | null;
  onNavigate: (href: string) => void;
  depth?: number;
}

function TocTree({ items, currentHref, onNavigate, depth = 0 }: TocTreeProps) {
  return (
    <ul className={depth === 0 ? 'space-y-1' : 'mt-1 space-y-1'}>
      {items.map((item, index) => {
        const isCurrent = item.href === currentHref;
        return (
          <li key={`${item.href}-${index}`}>
            <button
              type="button"
              onClick={() => onNavigate(item.href)}
              aria-current={isCurrent ? 'location' : undefined}
              className={`flex w-full items-center gap-2 rounded py-1 pr-2 text-left text-sm transition ${
                isCurrent
                  ? 'bg-blue-600/30 font-medium text-blue-200'
                  : 'text-gray-200 hover:bg-gray-700'
              }`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isCurrent ? 'bg-blue-300' : 'bg-gray-600'}`} />
              <span>{item.label}</span>
            </button>
            {item.subitems && item.subitems.length > 0 && (
              <TocTree
                items={item.subitems}
                currentHref={currentHref}
                onNavigate={onNavigate}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface SettingSelectProps {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}

function SettingSelect({ label, value, options, onChange }: SettingSelectProps) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded bg-gray-700 px-2 py-1">
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

type NumericSettingKey = {
  [K in keyof ReadingSettings]: ReadingSettings[K] extends number ? K : never
}[keyof ReadingSettings];

interface SettingStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onPreview: (value: number, persist: boolean) => void;
}

function SettingStepper({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  onPreview,
}: SettingStepperProps) {
  const decimals = decimalPlaces(step);
  const [text, setText] = useState(formatNumber(value, decimals));
  const isEditingRef = useRef(false);

  useEffect(() => {
    if (!isEditingRef.current) setText(formatNumber(value, decimals));
  }, [value, decimals]);

  const commit = () => {
    const parsed = Number(text);
    const next = clampAndRound(Number.isFinite(parsed) ? parsed : value, min, max, decimals);
    setText(formatNumber(next, decimals));
    onPreview(next, true);
  };

  const stepBy = (direction: -1 | 1) => {
    const next = clampAndRound(value + direction * step, min, max, decimals);
    setText(formatNumber(next, decimals));
    onPreview(next, true);
  };

  return (
    <label className="grid grid-cols-[minmax(5rem,auto)_2rem_minmax(0,1fr)_2rem_auto] items-center gap-1 whitespace-nowrap">
      <span className="min-w-0 truncate">{label}</span>
      <button type="button" className="reader-control px-0" onClick={() => stepBy(-1)} aria-label={`${label}减小`}>-</button>
      <input
        type="text"
        inputMode={decimals > 0 ? 'decimal' : 'numeric'}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          const pattern = decimals > 0 ? /^\d*(?:\.\d*)?$/ : /^\d*$/;
          if (!pattern.test(next)) return;
          setText(next);
          const parsed = Number(next);
          if (next !== '' && Number.isFinite(parsed)) {
            onPreview(clampAndRound(parsed, min, max, decimals), false);
          }
        }}
        onFocus={() => { isEditingRef.current = true; }}
        onBlur={() => { isEditingRef.current = false; commit(); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
        className="min-w-0 rounded bg-gray-700 px-2 py-1 text-center"
        aria-label={label}
      />
      <button type="button" className="reader-control px-0" onClick={() => stepBy(1)} aria-label={`${label}增大`}>+</button>
      <span className="text-gray-400">{unit}</span>
    </label>
  );
}

function decimalPlaces(step: number): number {
  const dot = String(step).indexOf('.');
  return dot < 0 ? 0 : String(step).length - dot - 1;
}

function clampAndRound(value: number, min: number, max: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(Math.min(max, Math.max(min, value)) * factor) / factor;
}

function formatNumber(value: number, decimals: number): string {
  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
}

function stripUpdatedAt(settings: ReadingSettings): Omit<ReadingSettings, 'updated_at'> {
  const { updated_at: _updatedAt, ...input } = settings;
  return input;
}

function mergeReadingSettings(
  global: ReadingSettings,
  override: ReadingSettingsResult['book_override'],
): ReadingSettings {
  if (!override) return global;
  return {
    theme: override.theme ?? global.theme,
    font_family: override.font_family ?? global.font_family,
    font_size_px: override.font_size_px ?? global.font_size_px,
    line_height_multiplier: override.line_height_multiplier ?? global.line_height_multiplier,
    paragraph_spacing_multiplier: override.paragraph_spacing_multiplier ?? global.paragraph_spacing_multiplier,
    text_indent_em: override.text_indent_em ?? global.text_indent_em,
    margin_top_px: override.margin_top_px ?? global.margin_top_px,
    margin_bottom_px: override.margin_bottom_px ?? global.margin_bottom_px,
    margin_left_percent: override.margin_left_percent ?? global.margin_left_percent,
    margin_right_percent: override.margin_right_percent ?? global.margin_right_percent,
    max_column_width_px: override.max_column_width_px ?? global.max_column_width_px,
    flow: override.flow ?? global.flow,
    spread: override.spread ?? global.spread,
    updated_at: override.updated_at,
  };
}
