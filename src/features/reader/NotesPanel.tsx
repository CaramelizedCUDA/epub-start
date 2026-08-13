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
        <h2 className="mb-2 font-semibold">批注</h2>
        <p className="text-sm text-gray-400">选择正文后可创建高亮或批注。</p>
      </div>
    );
  }
  return (
    <div>
      <h2 className="mb-2 font-semibold">批注（{notes.length}）</h2>
      <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
        {notes.map((note) => (
          <div key={note.id} className="rounded bg-gray-700/60 p-2">
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
                <span className="line-clamp-2 min-w-0 text-xs text-gray-200">
                  {note.selected_text || '（无选中文本）'}
                </span>
              </span>
              {note.content && (
                <span className="mt-1 block line-clamp-3 text-xs text-gray-400">{note.content}</span>
              )}
            </button>
            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                className="rounded px-2 py-0.5 text-xs text-gray-300 transition hover:bg-gray-600"
                onClick={() => onEdit(note)}
              >
                编辑
              </button>
              <button
                type="button"
                className="rounded px-2 py-0.5 text-xs text-red-300 transition hover:bg-red-900/60"
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
