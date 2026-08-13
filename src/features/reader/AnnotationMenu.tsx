// 高亮/批注的浮动菜单与编辑器：选区菜单、已有高亮菜单、批注正文编辑器。
// 内容一律按纯文本渲染（React 默认转义），不解析任何富文本。
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { NOTE_COLORS } from './engine/highlights';
import type { SelectionInfo } from './engine/highlights';
import type { Note } from '../../types/models';

const MENU_WIDTH = 250;
const MENU_HEIGHT = 150;
const MAX_CONTENT_LENGTH = 20_000;

function clampedMenuStyle(point: { x: number; y: number }): CSSProperties {
  return {
    left: Math.min(Math.max(8, point.x - MENU_WIDTH / 2), window.innerWidth - MENU_WIDTH - 8),
    top: Math.min(Math.max(8, point.y), window.innerHeight - MENU_HEIGHT - 8),
  };
}

interface ColorSwatchesProps {
  value: string;
  onChange: (color: string) => void;
}

export function ColorSwatches({ value, onChange }: ColorSwatchesProps) {
  return (
    <div className="flex items-center gap-1.5">
      {NOTE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`高亮颜色 ${color}`}
          className={`h-6 w-6 rounded-full border-2 transition ${
            value === color ? 'border-white' : 'border-transparent hover:border-gray-400'
          }`}
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
        />
      ))}
      <label
        className="relative h-6 w-6 cursor-pointer rounded-full border-2 border-dashed border-gray-400"
        title="自定义颜色"
      >
        <input
          type="color"
          value={value}
          aria-label="自定义高亮颜色"
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <span className="absolute inset-0 rounded-full" style={{ backgroundColor: value }} />
      </label>
    </div>
  );
}

interface SelectionMenuProps {
  selection: SelectionInfo;
  onHighlight: (color: string) => void;
  onAddNote: () => void;
  onClose: () => void;
}

export function SelectionMenu({ selection, onHighlight, onAddNote, onClose }: SelectionMenuProps) {
  const [color, setColor] = useState<string>(NOTE_COLORS[0]);
  return (
    <div
      className="fixed z-50 rounded-lg border border-gray-600 bg-gray-800 p-3 text-white shadow-xl"
      style={{ ...clampedMenuStyle(selection.point), width: MENU_WIDTH }}
    >
      <p className="mb-2 truncate text-xs text-gray-300" title={selection.selectedText}>
        {selection.selectedText || '已选择文本'}
      </p>
      <ColorSwatches value={color} onChange={setColor} />
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" className="reader-control" onClick={() => onHighlight(color)}>高亮</button>
        <button type="button" className="reader-control" onClick={onAddNote}>添加批注</button>
        <button
          type="button"
          aria-label="关闭菜单"
          className="rounded px-2 py-1 text-sm text-gray-400 transition hover:bg-gray-700 hover:text-white"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

interface NoteMenuProps {
  note: Note;
  point: { x: number; y: number };
  onColor: (color: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function NoteMenu({ note, point, onColor, onEdit, onDelete, onClose }: NoteMenuProps) {
  return (
    <div
      className="fixed z-50 rounded-lg border border-gray-600 bg-gray-800 p-3 text-white shadow-xl"
      style={{ ...clampedMenuStyle(point), width: MENU_WIDTH }}
    >
      <p className="mb-2 truncate text-xs text-gray-300" title={note.selected_text}>
        {note.selected_text || '高亮'}
      </p>
      <ColorSwatches value={note.color} onChange={(color) => onColor(color)} />
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" className="reader-control" onClick={onEdit}>编辑</button>
        <button
          type="button"
          className="rounded bg-red-800 px-3 py-1 text-sm text-red-100 transition hover:bg-red-700"
          onClick={onDelete}
        >
          删除
        </button>
        <button
          type="button"
          aria-label="关闭菜单"
          className="rounded px-2 py-1 text-sm text-gray-400 transition hover:bg-gray-700 hover:text-white"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

interface NoteEditorModalProps {
  title: string;
  excerpt: string;
  initialContent: string;
  initialColor: string;
  canDelete: boolean;
  saving: boolean;
  error: string | null;
  onSave: (content: string, color: string) => void;
  onDelete: () => void;
  onCancel: () => void;
}

export function NoteEditorModal({
  title,
  excerpt,
  initialContent,
  initialColor,
  canDelete,
  saving,
  error,
  onSave,
  onDelete,
  onCancel,
}: NoteEditorModalProps) {
  const [content, setContent] = useState(initialContent);
  const [color, setColor] = useState(initialColor);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg border border-gray-600 bg-gray-800 p-4 text-white shadow-2xl">
        <h2 className="mb-2 font-semibold">{title}</h2>
        <p className="mb-3 max-h-20 overflow-y-auto rounded bg-gray-900 px-3 py-2 text-xs text-gray-300">
          {excerpt || '（无选中文本）'}
        </p>
        <label className="mb-2 block text-sm text-gray-300">颜色</label>
        <ColorSwatches value={color} onChange={setColor} />
        <label className="mt-3 mb-1 block text-sm text-gray-300" htmlFor="note-editor-content">批注内容</label>
        <textarea
          id="note-editor-content"
          value={content}
          maxLength={MAX_CONTENT_LENGTH}
          onChange={(event) => setContent(event.target.value)}
          rows={6}
          autoFocus
          placeholder="写下你的想法（留空则为纯高亮）"
          className="w-full resize-y rounded bg-gray-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
        />
        <p className="mt-1 text-right text-xs text-gray-500">{content.length} / {MAX_CONTENT_LENGTH}</p>
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        <div className="mt-3 flex items-center justify-end gap-2">
          {canDelete && (
            <button
              type="button"
              disabled={saving}
              className="mr-auto rounded bg-red-800 px-3 py-1 text-sm text-red-100 transition hover:bg-red-700 disabled:opacity-50"
              onClick={onDelete}
            >
              删除
            </button>
          )}
          <button type="button" disabled={saving} className="reader-control" onClick={onCancel}>取消</button>
          <button
            type="button"
            disabled={saving}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white transition hover:bg-blue-500 disabled:opacity-50"
            onClick={() => onSave(content, color)}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
