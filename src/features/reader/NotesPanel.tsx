// 批注抽屉列表：展示当前书全部高亮与批注，点击跳转定位，支持编辑与删除。
// selected_text 与 content 一律按纯文本渲染，不做任何富文本解析。
import { useReaderStore } from '../../stores/readerStore';
import type { Note } from '../../types/models';

interface NotesPanelProps {
  onJump: (noteId: string) => void;
  onEdit: (note: Note) => void;
  onDelete: (noteId: string) => void;
}

export function NotesPanel({ onJump, onEdit, onDelete }: NotesPanelProps) {
  const notes = useReaderStore((state) => state.notes);
  if (notes.length === 0) {
    return (
      <div>
        <p className="mb-2 font-reading text-base">还没有批注</p>
        <p className="text-sm text-muted">选择正文后可创建高亮或批注。</p>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-3 text-xs text-muted">{notes.length} 条批注 · 点击摘录回到正文</p>
      <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
        {notes.map((note) => (
          <div key={note.id} className="rounded-xl border border-line bg-paper p-3">
            <button
              type="button"
              className="block w-full text-left"
              onClick={() => onJump(note.id)}
              title="点击跳转到原文位置"
            >
              <span className="flex items-start gap-2">
                <span
                  className="mt-1 h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: note.color }}
                />
                <span className="line-clamp-3 min-w-0 font-reading text-sm leading-relaxed text-ink">
                  {note.selected_text || '（无选中文本）'}
                </span>
              </span>
              {note.content && (
                <span className="mt-2 block line-clamp-3 text-sm leading-relaxed text-muted">{note.content}</span>
              )}
            </button>
            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                className="rounded px-2 py-0.5 text-xs text-muted transition hover:bg-subtle"
                onClick={() => onEdit(note)}
              >
                编辑
              </button>
              <button
                type="button"
                className="rounded px-2 py-0.5 text-xs text-danger transition hover:bg-danger/10"
                onClick={() => onDelete(note.id)}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
