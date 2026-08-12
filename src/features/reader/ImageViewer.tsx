import { useEffect, useRef, useState } from 'react';
import type { ReaderImageTarget } from './engine/imageInteractions';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const LONG_PRESS_MS = 550;

interface ImageViewerProps {
  target: ReaderImageTarget;
  initialMenuPoint: { x: number; y: number } | null;
  isFullscreen: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onToggleFullscreen: () => void;
  onSave: () => Promise<void>;
}

export function ImageViewer({
  target,
  initialMenuPoint,
  isFullscreen,
  onClose,
  onOpenSettings,
  onToggleFullscreen,
  onSave,
}: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [menuPoint, setMenuPoint] = useState(initialMenuPoint);
  const [showInteractionHint, setShowInteractionHint] = useState(true);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    distance: number;
    scale: number;
    center: { x: number; y: number };
    offset: { x: number; y: number };
  } | null>(null);
  const dragStart = useRef<{ x: number; y: number; offset: { x: number; y: number } } | null>(null);
  const moved = useRef(false);
  const longPressTimer = useRef<number | null>(null);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setMenuPoint(initialMenuPoint);
  }, [target, initialMenuPoint]);

  useEffect(() => {
    setShowInteractionHint(true);
    const timer = window.setTimeout(() => setShowInteractionHint(false), 800);
    return () => window.clearTimeout(timer);
  }, [target.url]);

  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
  }, []);

  const clearLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };
  const pointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved.current = false;
    setMenuPoint(null);

    if (pointers.current.size === 1) {
      dragStart.current = { x: event.clientX, y: event.clientY, offset };
      if (event.pointerType !== 'mouse') {
        clearLongPress();
        longPressTimer.current = window.setTimeout(() => {
          setMenuPoint({ x: event.clientX, y: event.clientY });
          moved.current = true;
        }, LONG_PRESS_MS);
      }
    } else if (pointers.current.size === 2) {
      clearLongPress();
      const [first, second] = [...pointers.current.values()];
      gesture.current = {
        distance: distance(first, second),
        scale,
        center: midpoint(first, second),
        offset,
      };
    }
  };
  const pointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2 && gesture.current) {
      const [first, second] = [...pointers.current.values()];
      const center = midpoint(first, second);
      const nextScale = clamp(
        gesture.current.scale * distance(first, second) / Math.max(1, gesture.current.distance),
        MIN_SCALE,
        MAX_SCALE,
      );
      setScale(nextScale);
      setOffset({
        x: gesture.current.offset.x + center.x - gesture.current.center.x,
        y: gesture.current.offset.y + center.y - gesture.current.center.y,
      });
      moved.current = true;
      clearLongPress();
      return;
    }

    if (dragStart.current && scale > 1) {
      const dx = event.clientX - dragStart.current.x;
      const dy = event.clientY - dragStart.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        moved.current = true;
        clearLongPress();
      }
      setOffset({ x: dragStart.current.offset.x + dx, y: dragStart.current.offset.y + dy });
    }
  };
  const pointerEnd = (event: React.PointerEvent<HTMLImageElement>) => {
    pointers.current.delete(event.pointerId);
    clearLongPress();
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 0) dragStart.current = null;
  };

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-black/95 text-white"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onContextMenu={(event) => event.preventDefault()}
      role="dialog"
      aria-modal="true"
      aria-label="EPUB 图片查看器"
    >
      <div className="relative z-10 flex shrink-0 items-center gap-2 border-b border-white/10 bg-gray-900/90 px-4 py-2">
        <button type="button" onClick={onClose} className="reader-control">← 返回正文</button>
        <span className="mr-auto min-w-0 truncate text-sm text-gray-300">{target.alt}</span>
        <button type="button" onClick={() => void onSave()} className="reader-control">另存为</button>
        <button type="button" onClick={onOpenSettings} className="reader-control">设置</button>
        <button type="button" onClick={onToggleFullscreen} className="reader-control">
          {isFullscreen ? '退出全屏' : '全屏'}
        </button>
      </div>

      <div
        className="relative flex flex-1 touch-none items-center justify-center overflow-hidden"
        onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      >
        <img
          src={target.url}
          alt={target.alt}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transformOrigin: 'center center',
            cursor: scale > 1 ? 'grab' : 'zoom-in',
          }}
          onWheel={(event) => {
            event.preventDefault();
            const nextScale = clamp(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_SCALE, MAX_SCALE);
            setScale(nextScale);
            if (nextScale === 1) setOffset({ x: 0, y: 0 });
          }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerEnd}
          onPointerCancel={pointerEnd}
          onClick={(event) => {
            event.stopPropagation();
            if (!moved.current && menuPoint === null) onClose();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenuPoint({ x: event.clientX, y: event.clientY });
          }}
        />
        {showInteractionHint && (
          <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-xs text-gray-300">
            滚轮或双指缩放；放大后拖动；单击空白或图片返回正文
          </p>
        )}
      </div>

      {menuPoint && (
        <div
          className="fixed z-50 min-w-44 rounded border border-gray-600 bg-gray-800 p-1 shadow-xl"
          style={{
            left: Math.max(8, Math.min(menuPoint.x, window.innerWidth - 190)),
            top: Math.max(8, Math.min(menuPoint.y, window.innerHeight - 110)),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <p className="px-3 py-1 text-xs text-gray-400">更多工具</p>
          <button
            type="button"
            className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-700"
            onClick={() => {
              setMenuPoint(null);
              setScale((current) => (current === 1 ? 2 : 1));
              setOffset({ x: 0, y: 0 });
            }}
          >
            {scale > 1 ? '恢复原始大小' : '放大图像'}
          </button>
          <button
            type="button"
            className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-700"
            onClick={() => { setMenuPoint(null); void onSave(); }}
          >
            另存为…
          </button>
        </div>
      )}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distance(first: { x: number; y: number }, second: { x: number; y: number }): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpoint(first: { x: number; y: number }, second: { x: number; y: number }) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}
