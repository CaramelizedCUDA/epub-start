// 高亮/批注的浮动菜单与编辑器：选区菜单、已有高亮菜单、批注正文编辑器。
// 展示随 Reader 主题继承纸墨变量；事件与选区生命周期保持原逻辑。
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
            value === color ? 'border-ink' : 'border-transparent hover:border-muted'
          }`}
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
        />
      ))}
      <label
        className="relative h-6 w-6 cursor-pointer rounded-full border-2 border-dashed border-muted"
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
      className="fixed z-50 rounded-2xl border border-line bg-surface p-3 text-ink shadow-xl"
      style={{ ...clampedMenuStyle(selection.point), width: MENU_WIDTH }}
    >
      <p className="mb-2 truncate text-xs text-muted" title={selection.selectedText}>
        {selection.selectedText || '已选择文本'}
      </p>
      <ColorSwatches value={color} onChange={setColor} />
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" className="reader-control" onClick={() => onHighlight(color)}>高亮</button>
        <button type="button" className="reader-control" onClick={onAddNote}>添加批注</button>
        <button
          type="button"
          aria-label="关闭菜单"
          className="rounded px-2 py-1 text-sm text-muted transition hover:bg-subtle hover:text-ink"
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
      className="fixed z-50 rounded-2xl border border-line bg-surface p-3 text-ink shadow-xl"
      style={{ ...clampedMenuStyle(point), width: MENU_WIDTH }}
    >
      <p className="mb-2 truncate text-xs text-muted" title={note.selected_text}>
        {note.selected_text || '高亮'}
      </p>
      <ColorSwatches value={note.color} onChange={(color) => onColor(color)} />
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" className="reader-control" onClick={onEdit}>编辑</button>
        <button
          type="button"
          className="rounded bg-danger/10 px-3 py-1 text-sm text-danger transition hover:bg-danger/20"
          onClick={onDelete}
        >
          删除
        </button>
        <button
          type="button"
          aria-label="关闭菜单"
          className="rounded px-2 py-1 text-sm text-muted transition hover:bg-subtle hover:text-ink"
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
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-4 text-ink shadow-2xl">
        <h2 className="mb-2 font-semibold">{title}</h2>
        <p className="mb-3 max-h-20 overflow-y-auto rounded bg-subtle px-3 py-2 text-xs text-muted">
          {excerpt || '（无选中文本）'}
        </p>
        <label className="mb-2 block text-sm text-muted">颜色</label>
        <ColorSwatches value={color} onChange={setColor} />
        <label className="mt-3 mb-1 block text-sm text-muted" htmlFor="note-editor-content">批注内容</label>
        <textarea
          id="note-editor-content"
          value={content}
          maxLength={MAX_CONTENT_LENGTH}
          onChange={(event) => setContent(event.target.value)}
          rows={6}
          autoFocus
          placeholder="写下你的想法（留空则为纯高亮）"
          className="w-full resize-y rounded border border-line bg-paper px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <p className="mt-1 text-right text-xs text-muted">{content.length} / {MAX_CONTENT_LENGTH}</p>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-3 flex items-center justify-end gap-2">
          {canDelete && (
            <button
              type="button"
              disabled={saving}
              className="mr-auto rounded bg-danger/10 px-3 py-1 text-sm text-danger transition hover:bg-danger/20 disabled:opacity-50"
              onClick={onDelete}
            >
              删除
            </button>
          )}
          <button type="button" disabled={saving} className="reader-control" onClick={onCancel}>取消</button>
          <button
            type="button"
            disabled={saving}
            className="rounded bg-accent px-3 py-1 text-sm text-paper transition hover:opacity-90 disabled:opacity-50"
            onClick={() => onSave(content, color)}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
