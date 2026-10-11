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
import { readingBackground, readingThemeVariables } from './engine/reflow';
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
import { ReaderChrome, type ReaderPanel } from './ReaderChrome';
import { ReaderSettingsPanel, type NumericSettingKey } from './ReaderSettingsPanel';
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
  bookTitle?: string;
  epubRootUrl: string;
  initialHref?: string;
  onClose: () => void;
}

type EditorDraft =
  | { kind: 'new'; selection: SelectionInfo; color: string }
  | { kind: 'edit'; note: Note };

type PageTurnEffectPhase = 'playing' | 'dragging' | 'settling' | 'canceling';
interface PageTurnEffect {
  contentDriven: boolean;
  direction: PageTurnDirection;
  id: number;
  phase: PageTurnEffectPhase;
  progress: number;
}

export function EpubReader({ bookId, bookTitle, epubRootUrl, initialHref, onClose }: EpubReaderProps) {
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
    readingSettings,
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
  const [isNavigationVisible, setIsNavigationVisible] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const panelTriggerRef = useRef<HTMLElement | null>(null);
  const annotationOverlayRef = useRef(false);
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
  annotationOverlayRef.current = Boolean(editorDraft || imageTarget || pendingSelection || clickedNote);
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
    panelTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActivePanel((current) => current === panel ? null : panel);
    setIsNavigationVisible(true);
  };

  useEffect(() => {
    if (!activePanel) return;
    const panel = panelRef.current;
    if (!panel) return;
    // 模态面板的 Tab 留在面板内；更高层批注编辑器与图片查看器仍优先。
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
    )).filter((element) => element.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] ?? panel).focus();
    focusFirst();
    const handleFocus = (event: FocusEvent) => {
      if (!annotationOverlayRef.current && !panel.contains(event.target as Node)) focusFirst();
    };
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || annotationOverlayRef.current) return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('focusin', handleFocus);
    document.addEventListener('keydown', handleTab);
    return () => {
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('keydown', handleTab);
      const trigger = panelTriggerRef.current;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [activePanel]);

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
      // 所有手势提交经同一个 EPUB.js 翻页入口，保持页码和当前 CFI 同步。
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
    // Rendition 更换或关书后，旧 iframe 的延迟手势不能提交到新会话。
    let active = true;
    const readerEpoch = readerEpochRef.current;
    const isCurrentInteraction = () => {
      const current = useReaderStore.getState();
      return active && readerEpoch === readerEpochRef.current
        && current.bookId === bookId && current.rendition === rendition;
    };
    const dispose = installImageInteractions(rendition, epubRootUrl, bookId, {
      onOpen: (target) => {
        if (!isCurrentInteraction()) return;
        setImageError(null);
        setImageMenu(null);
        setImageTarget(target);
      },
      onContextMenu: (request) => {
        if (!isCurrentInteraction()) return;
        setImageError(null);
        setImageMenu(request);
      },
      onError: (message) => {
        if (!isCurrentInteraction()) return;
        setImageMenu(null);
        setImageError(message);
      },
      onPreviousPage: () => { if (isCurrentInteraction()) handlePreviousPage(); },
      onNextPage: () => { if (isCurrentInteraction()) handleNextPage(); },
      onPageTurnGestureMove: (direction, progress, distance) => {
        if (isCurrentInteraction()) updatePageTurnGesture(direction, progress, distance);
      },
      onPageTurnGestureCancel: () => { if (isCurrentInteraction()) cancelPageTurnGesture(); },
      onPageTurnGestureCommit: (direction, progress, distance) => {
        if (isCurrentInteraction()) commitPageTurnGesture(direction, progress, distance);
      },
      onToggleNavigation: () => {
        if (isCurrentInteraction()) setIsNavigationVisible((visible) => !visible);
      },
      isPaginated: () => settingsDraftRef.current?.flow !== 'scrolled',
    });
    return () => {
      active = false;
      dispose();
      if (pageTurnEffectTimerRef.current !== null) window.clearTimeout(pageTurnEffectTimerRef.current);
      pageTurnEffectTimerRef.current = null;
      pageTurnEffectRef.current = null;
      setPageTurnEffect(null);
    };
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

  // Initial settings are required to open the book. Surface their failure here
  // instead of leaving an empty reader whose error is hidden in a tool panel.
  const openingError = error || (!settingsResult ? settingsError : null);
  if (openingError) {
    return (
      <div className="flex items-center justify-center h-screen bg-paper text-ink">
        <div className="text-center max-w-md px-6">
          <p className="text-danger text-lg mb-4">打开失败</p>
          <p className="text-muted mb-6 text-sm break-all">{openingError}</p>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-accent text-paper hover:opacity-90 rounded-lg transition"
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

  // 正文和工具使用当前实际应用的主题，键入预览不必等待持久化完成。
  return (
    <div
      className="reader-shell relative flex h-screen min-h-0 flex-col overflow-hidden text-ink"
      // Android 只读取当前实际预览的材料主题，不把系统深色偏好当成阅读设置。
      data-reader-theme={(readingSettings ?? settingsResult?.effective)?.theme ?? 'light'}
      style={{ ...readingThemeVariables(readingSettings ?? settingsResult?.effective ?? null), backgroundColor: readingBackground(readingSettings ?? settingsResult?.effective ?? null) } as CSSProperties}
    >
      {/* 正文使用独立的固定留白，浮动工具覆盖其上；显隐不改变 EPUB viewport。 */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ backgroundColor: readingBackground(readingSettings ?? settingsResult?.effective ?? null) }}
      >
        <div
          id="epub-reader-viewport"
          className="absolute left-[var(--reader-safe-left,env(safe-area-inset-left,0px))] right-[var(--reader-safe-right,env(safe-area-inset-right,0px))] top-[calc(3rem+var(--reader-safe-top,env(safe-area-inset-top,0px)))] bottom-[calc(3rem+var(--reader-safe-bottom,env(safe-area-inset-bottom,0px)))] min-h-0"
        />

        {(isLoading || !settingsResult) && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-paper px-10 text-ink">
            <div className="text-center">
              <p className="mb-3 max-w-sm font-reading text-xl font-normal leading-relaxed">{bookTitle}</p>
              <p className="text-sm text-muted">正在打开…</p>
              <div className="mx-auto mt-6 h-[30px] w-[30px] animate-spin rounded-full border-2 border-line border-t-accent" />
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
            className="absolute inset-0 z-[45] bg-black/20"
            onClick={() => setActivePanel(null)}
          />
          <aside
            ref={panelRef}
            tabIndex={-1}
            data-reader-panel
            role="dialog"
            aria-modal="true"
            aria-label={activePanel === 'settings' ? '阅读设置' : activePanel === 'toc' ? '目录' : activePanel === 'notes' ? '批注' : '搜索当前书籍'}
            className="absolute bottom-0 left-0 right-0 z-50 flex max-h-[88vh] flex-col overflow-hidden rounded-t-3xl border border-line bg-surface text-ink shadow-2xl sm:bottom-20 sm:left-auto sm:right-6 sm:max-h-[calc(100vh-8rem)] sm:w-[min(28rem,calc(100%-3rem))] sm:rounded-2xl"
          >
            <div aria-hidden="true" className="mx-auto mt-3 h-[5px] w-[55px] shrink-0 rounded-full bg-line sm:hidden" />
            {/* 标题和完成按钮留在滚动区外，展开精确设置后仍能直接收起面板。 */}
            <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-1 pt-2 sm:pt-4">
              <h2 className="font-reading text-[22px] font-medium">
                {activePanel === 'toc' && '目录'}
                {activePanel === 'search' && '搜索当前书籍'}
                {activePanel === 'notes' && '批注'}
                {activePanel === 'settings' && '阅读设置'}
              </h2>
              <button
                type="button"
                className="min-h-11 rounded px-2 py-1 text-base font-semibold text-accent hover:bg-subtle"
                onClick={() => setActivePanel(null)}
              >
                {activePanel === 'settings' ? '完成' : '关闭'}
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
              {activePanel === 'toc' && (
                <div>
                  {toc.length === 0 ? (
                    <p className="text-sm text-muted">此书未提供目录。</p>
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
                      className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-base text-ink outline-none focus:border-accent"
                      placeholder="输入关键词"
                    />
                    <button type="button" disabled={isSearching} onClick={() => void searchCurrentBook(query)} className="reader-control">{isSearching ? '查找中…' : '查找'}</button>
                  </div>
                  <p className="mt-2 text-xs text-muted">至少输入 2 个字符。每章显示首处摘要，点击跳转到章节，不是字词级 CFI 定位。</p>
                  <div role="status" aria-live="polite" className="mt-2 text-xs text-muted">
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
                        className="block w-full rounded-xl border border-line bg-paper p-3 text-left text-sm leading-relaxed hover:bg-subtle"
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
                <ReaderSettingsPanel
                  draft={settingsDraft}
                  scope={settingsScope}
                  hasBookOverride={Boolean(settingsResult?.book_override)}
                  saving={isSavingSettings}
                  error={settingsError}
                  onScope={changeSettingsScope}
                  onDraft={(draft) => { previewSettings(draft); scheduleSettingsSave(draft); }}
                  onNumeric={updateNumericSetting}
                  onClearOverride={() => { void clearBookOverride(); }}
                />
              )}
              {activePanel === 'settings' && !settingsDraft && (
                <p className="text-sm text-muted">正在加载阅读设置…</p>
              )}
            </div>
          </aside>
        </>
      )}

      <ReaderChrome
        bookTitle={bookTitle || '阅读'}
        chapterTitle={findChapterTitle(toc, currentChapterHref)}
        currentPage={currentPage}
        totalPages={totalPages}
        activePanel={activePanel}
        visible={isNavigationVisible}
        isFullscreen={isFullscreen}
        onClose={onClose}
        onPrevious={handlePreviousPage}
        onNext={handleNextPage}
        onPanel={togglePanel}
        onFullscreen={() => { void handleFullscreen(); }}
        onToggleVisible={() => { setActivePanel(null); setIsNavigationVisible((visible) => !visible); }}
      />

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
          className="fixed z-50 min-w-44 rounded border border-line bg-surface p-1 text-ink shadow-xl"
          style={{ left: Math.min(imageMenu.point.x, window.innerWidth - 190), top: Math.min(imageMenu.point.y, window.innerHeight - 110) }}
        >
          <p className="px-3 py-1 text-xs text-muted">更多工具</p>
          <button
            type="button"
            className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-subtle"
            onClick={() => { setImageTarget(imageMenu.target); setImageMenu(null); }}
          >
            放大图像
          </button>
          <button
            type="button"
            className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-subtle"
            onClick={() => { const target = imageMenu.target; setImageMenu(null); void saveImageTarget(target); }}
          >
            另存为…
          </button>
        </div>
      )}
      {imageError && (
        <div className="fixed bottom-4 left-1/2 z-[60] max-w-xl -translate-x-1/2 rounded border border-danger/30 bg-surface px-4 py-3 text-sm text-danger shadow-xl">
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
        <div className="fixed bottom-4 left-1/2 z-[60] flex max-w-xl -translate-x-1/2 items-center gap-3 rounded border border-danger/30 bg-surface px-4 py-3 text-sm text-danger shadow-xl">
          <span>{notesError}</span>
          <button
            type="button"
            onClick={() => setNotesError(null)}
            className="text-xs text-danger underline hover:text-danger"
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
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-ink hover:bg-subtle'
              }`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isCurrent ? 'bg-accent' : 'bg-line'}`} />
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

// 目录标题只消费现有导航结果；展示壳不接触 href 或 CFI。
function findChapterTitle(items: TocItem[], currentHref: string | null): string {
  if (!currentHref) return '';
  for (const item of items) {
    if (item.href === currentHref) return item.label;
    const nested = findChapterTitle(item.subitems || [], currentHref);
    if (nested) return nested;
  }
  return '';
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
