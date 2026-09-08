import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  createTag,
  createTagGroup,
  deleteTag,
  deleteTagGroup,
  filterBooksByTags,
  listBookTags,
  listSeries,
  listSeriesTags,
  listTagGroups,
  listTags,
  setBookTags,
  setSeriesTags,
  updateTag,
  updateTagGroup,
} from '../../lib/tauri';
import type { BookSummary, BookTag, Series, Tag, TagGroup } from '../../types/models';
import { LibraryBookCover } from './LibraryBookCover';

const ALL_GROUP_ID = '__all__';
const UNGROUPED_GROUP_ID = '__ungrouped__';

export interface TagsPageProps {
  books: BookSummary[];
  onBack: () => void;
  onOpenBook: (book: BookSummary) => void;
}

export function TagsPage({ books, onBack, onOpenBook }: TagsPageProps) {
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(ALL_GROUP_ID);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [newGroupName, setNewGroupName] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#2e6e67');
  const [newTagGroupId, setNewTagGroupId] = useState(UNGROUPED_GROUP_ID);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tagNameDraft, setTagNameDraft] = useState('');
  const [tagColorDraft, setTagColorDraft] = useState('#2e6e67');
  const [tagGroupDraft, setTagGroupDraft] = useState(UNGROUPED_GROUP_ID);

  const [selectedBookId, setSelectedBookId] = useState(books[0]?.id ?? '');
  const [bookTags, setBookTagsState] = useState<BookTag[]>([]);
  const [bookDirectTagIds, setBookDirectTagIds] = useState<string[]>([]);
  const [isLoadingBookTags, setIsLoadingBookTags] = useState(false);
  const [bookTagsError, setBookTagsError] = useState<string | null>(null);

  const [selectedSeriesId, setSelectedSeriesId] = useState('');
  const [seriesDirectTagIds, setSeriesDirectTagIds] = useState<string[]>([]);
  const [isLoadingSeriesTags, setIsLoadingSeriesTags] = useState(false);
  const [seriesTagsError, setSeriesTagsError] = useState<string | null>(null);

  const [selectedFilterTagIds, setSelectedFilterTagIds] = useState<string[]>([]);
  const [filteredBooks, setFilteredBooks] = useState<BookSummary[]>(books);
  const [isFiltering, setIsFiltering] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const writeLockRef = useRef(false);
  const catalogRequestRef = useRef(0);
  const bookRequestRef = useRef(0);
  const seriesRequestRef = useRef(0);
  const filterRequestRef = useRef(0);
  const selectedBookIdRef = useRef(selectedBookId);
  const selectedSeriesIdRef = useRef(selectedSeriesId);
  selectedBookIdRef.current = selectedBookId;
  selectedSeriesIdRef.current = selectedSeriesId;

  const selectedBook = useMemo(() => books.find((book) => book.id === selectedBookId) ?? null, [books, selectedBookId]);
  const selectedSeries = useMemo(() => series.find((item) => item.id === selectedSeriesId) ?? null, [series, selectedSeriesId]);
  const visibleTags = useMemo(
    () => selectedGroupId === ALL_GROUP_ID
      ? tags
      : tags.filter((tag) => selectedGroupId === UNGROUPED_GROUP_ID ? tag.group_id === null : tag.group_id === selectedGroupId),
    [selectedGroupId, tags],
  );
  const inheritedBookTagIds = useMemo(
    () => new Set(bookTags.filter((item) => item.inherited_from_series).map((item) => item.tag.id)),
    [bookTags],
  );
  const bookDirectTagSet = useMemo(() => new Set(bookDirectTagIds), [bookDirectTagIds]);
  const seriesDirectTagSet = useMemo(() => new Set(seriesDirectTagIds), [seriesDirectTagIds]);
  const filterTagSet = useMemo(() => new Set(selectedFilterTagIds), [selectedFilterTagIds]);

  const loadCatalog = async () => {
    const requestId = ++catalogRequestRef.current;
    setIsLoadingCatalog(true);
    setCatalogError(null);
    try {
      const [nextGroups, nextTags, nextSeries] = await Promise.all([listTagGroups(), listTags(), listSeries()]);
      if (requestId !== catalogRequestRef.current) return;
      setGroups(nextGroups);
      setTags(nextTags);
      setSeries(nextSeries);
      setSelectedGroupId((current) => current === ALL_GROUP_ID || current === UNGROUPED_GROUP_ID || nextGroups.some((group) => group.id === current) ? current : ALL_GROUP_ID);
      setSelectedSeriesId((current) => nextSeries.some((item) => item.id === current) ? current : (nextSeries[0]?.id ?? ''));
    } catch (err) {
      if (requestId === catalogRequestRef.current) setCatalogError(errorMessage(err));
    } finally {
      if (requestId === catalogRequestRef.current) setIsLoadingCatalog(false);
    }
  };

  const loadBookTags = async (bookId = selectedBookIdRef.current) => {
    const requestId = ++bookRequestRef.current;
    if (!bookId) {
      setBookTagsState([]);
      setBookDirectTagIds([]);
      setIsLoadingBookTags(false);
      setBookTagsError(null);
      return;
    }
    setIsLoadingBookTags(true);
    setBookTagsError(null);
    try {
      const nextTags = await listBookTags({ bookId });
      if (requestId !== bookRequestRef.current || selectedBookIdRef.current !== bookId) return;
      setBookTagsState(nextTags);
      setBookDirectTagIds(nextTags.filter((item) => !item.inherited_from_series).map((item) => item.tag.id));
    } catch (err) {
      if (requestId === bookRequestRef.current && selectedBookIdRef.current === bookId) setBookTagsError(errorMessage(err));
    } finally {
      if (requestId === bookRequestRef.current && selectedBookIdRef.current === bookId) setIsLoadingBookTags(false);
    }
  };

  const loadSeriesTags = async (seriesId = selectedSeriesIdRef.current) => {
    const requestId = ++seriesRequestRef.current;
    if (!seriesId) {
      setSeriesDirectTagIds([]);
      setIsLoadingSeriesTags(false);
      setSeriesTagsError(null);
      return;
    }
    setIsLoadingSeriesTags(true);
    setSeriesTagsError(null);
    try {
      const nextTags = await listSeriesTags({ seriesId });
      if (requestId !== seriesRequestRef.current || selectedSeriesIdRef.current !== seriesId) return;
      setSeriesDirectTagIds(nextTags.map((tag) => tag.id));
    } catch (err) {
      if (requestId === seriesRequestRef.current && selectedSeriesIdRef.current === seriesId) setSeriesTagsError(errorMessage(err));
    } finally {
      if (requestId === seriesRequestRef.current && selectedSeriesIdRef.current === seriesId) setIsLoadingSeriesTags(false);
    }
  };

  const applyTagFilter = async (nextTagIds: string[]) => {
    const uniqueTagIds = [...new Set(nextTagIds)];
    setSelectedFilterTagIds(uniqueTagIds);
    const requestId = ++filterRequestRef.current;
    setFilterError(null);
    if (uniqueTagIds.length === 0) {
      setFilteredBooks(books);
      setIsFiltering(false);
      return;
    }
    setIsFiltering(true);
    try {
      const result = await filterBooksByTags({ tagIds: uniqueTagIds });
      if (requestId !== filterRequestRef.current) return;
      setFilteredBooks(result);
    } catch (err) {
      if (requestId === filterRequestRef.current) setFilterError(errorMessage(err));
    } finally {
      if (requestId === filterRequestRef.current) setIsFiltering(false);
    }
  };

  useEffect(() => { void loadCatalog(); }, []);

  useEffect(() => {
    setSelectedBookId((current) => books.some((book) => book.id === current) ? current : (books[0]?.id ?? ''));
    if (selectedFilterTagIds.length === 0) setFilteredBooks(books);
  }, [books, selectedFilterTagIds.length]);

  useEffect(() => {
    setBookTagsState([]);
    setBookDirectTagIds([]);
    void loadBookTags(selectedBookId);
  }, [selectedBookId]);

  useEffect(() => {
    setSeriesDirectTagIds([]);
    void loadSeriesTags(selectedSeriesId);
  }, [selectedSeriesId]);

  const beginWrite = (key: string): boolean => {
    if (writeLockRef.current) return false;
    writeLockRef.current = true;
    setBusyKey(key);
    return true;
  };

  const endWrite = () => {
    writeLockRef.current = false;
    setBusyKey(null);
  };

  const handleCreateGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newGroupName.trim();
    if (!name || !beginWrite('create-group')) return;
    setCatalogError(null);
    try {
      const created = await createTagGroup({ group: { name, sort_order: 0 } });
      setSelectedGroupId(created.id);
      setNewGroupName('');
      await loadCatalog();
    } catch (err) {
      setCatalogError(errorMessage(err));
    } finally {
      endWrite();
    }
  };

  const startEditGroup = (group: TagGroup) => {
    setEditingGroupId(group.id);
    setGroupNameDraft(group.name);
  };

  const handleUpdateGroup = async (group: TagGroup) => {
    const name = groupNameDraft.trim();
    if (!name || name === group.name || !beginWrite(`update-group-${group.id}`)) return;
    setCatalogError(null);
    try {
      await updateTagGroup({ group: { id: group.id, name, sort_order: group.sort_order } });
      setEditingGroupId(null);
      await loadCatalog();
    } catch (err) {
      setCatalogError(errorMessage(err));
    } finally {
      endWrite();
    }
  };

  const handleDeleteGroup = async (group: TagGroup) => {
    if (!window.confirm(`删除标签组“${group.name}”？标签会保留为未分组。`)) return;
    if (!beginWrite(`delete-group-${group.id}`)) return;
    setCatalogError(null);
    try {
      await deleteTagGroup({ groupId: group.id });
      if (selectedGroupId === group.id) setSelectedGroupId(ALL_GROUP_ID);
      if (newTagGroupId === group.id) setNewTagGroupId(UNGROUPED_GROUP_ID);
      if (tagGroupDraft === group.id) setTagGroupDraft(UNGROUPED_GROUP_ID);
      setEditingGroupId(null);
      await loadCatalog();
    } catch (err) {
      setCatalogError(errorMessage(err));
    } finally {
      endWrite();
    }
  };

  const handleCreateTag = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newTagName.trim();
    if (!name || !beginWrite('create-tag')) return;
    setCatalogError(null);
    try {
      await createTag({ tag: { name, color: newTagColor, group_id: tagGroupIdOrNull(newTagGroupId) } });
      setNewTagName('');
      await loadCatalog();
    } catch (err) {
      setCatalogError(errorMessage(err));
    } finally {
      endWrite();
    }
  };

  const startEditTag = (tag: Tag) => {
    setEditingTagId(tag.id);
    setTagNameDraft(tag.name);
    setTagColorDraft(tag.color);
    setTagGroupDraft(tag.group_id ?? UNGROUPED_GROUP_ID);
  };

  const handleUpdateTag = async (tag: Tag) => {
    const name = tagNameDraft.trim();
    if (!name || !beginWrite(`update-tag-${tag.id}`)) return;
    setCatalogError(null);
    try {
      await updateTag({ tag: { id: tag.id, name, color: tagColorDraft, group_id: tagGroupDraft === UNGROUPED_GROUP_ID ? null : tagGroupDraft } });
      setEditingTagId(null);
      await loadCatalog();
    } catch (err) {
      setCatalogError(errorMessage(err));
    } finally {
      endWrite();
    }
  };

  const handleDeleteTag = async (tag: Tag) => {
    if (!window.confirm(`删除标签“${tag.name}”？书籍和系列上的关系也会删除。`)) return;
    if (!beginWrite(`delete-tag-${tag.id}`)) return;
    const nextFilterIds = selectedFilterTagIds.filter((id) => id !== tag.id);
    setCatalogError(null);
    try {
      await deleteTag({ tagId: tag.id });
      setBookDirectTagIds((current) => current.filter((id) => id !== tag.id));
      setSeriesDirectTagIds((current) => current.filter((id) => id !== tag.id));
      setEditingTagId(null);
      await loadCatalog();
      await Promise.all([loadBookTags(), loadSeriesTags()]);
      await applyTagFilter(nextFilterIds);
    } catch (err) {
      setCatalogError(errorMessage(err));
    } finally {
      endWrite();
    }
  };

  const handleSaveBookTags = async () => {
    const bookId = selectedBookIdRef.current;
    if (!bookId || !beginWrite(`save-book-tags-${bookId}`)) return;
    setBookTagsError(null);
    try {
      await setBookTags({ bookId, tagIds: [...new Set(bookDirectTagIds)] });
      await loadBookTags(bookId);
      if (selectedFilterTagIds.length > 0) await applyTagFilter(selectedFilterTagIds);
    } catch (err) {
      setBookTagsError(errorMessage(err));
    } finally {
      endWrite();
    }
  };

  const handleSaveSeriesTags = async () => {
    const seriesId = selectedSeriesIdRef.current;
    if (!seriesId || !beginWrite(`save-series-tags-${seriesId}`)) return;
    setSeriesTagsError(null);
    try {
      await setSeriesTags({ seriesId, tagIds: [...new Set(seriesDirectTagIds)] });
      await loadSeriesTags(seriesId);
      await loadBookTags();
      if (selectedFilterTagIds.length > 0) await applyTagFilter(selectedFilterTagIds);
    } catch (err) {
      setSeriesTagsError(errorMessage(err));
    } finally {
      endWrite();
    }
  };

  const handleToggleFilterTag = (tagId: string) => {
    const next = filterTagSet.has(tagId)
      ? selectedFilterTagIds.filter((id) => id !== tagId)
      : [...selectedFilterTagIds, tagId];
    void applyTagFilter(next);
  };

  return (
    <section className="pt-8 lg:pt-10" aria-labelledby="tags-page-title">
      <div className="border-t-[3px] border-[#2e6e67] pt-5">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d0d9d4] pb-5">
          <div>
            <button type="button" onClick={onBack} className="mb-4 border-b border-transparent text-xs text-[#2e6e67] transition hover:border-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">← 藏书</button>
            <p className="mb-1 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[#2e6e67]">Catalog vocabulary</p>
            <h1 id="tags-page-title" className="font-serif text-4xl font-medium tracking-[-0.05em] text-[#18272c] sm:text-5xl">标签</h1>
          </div>
          <p className="max-w-sm text-right text-sm leading-relaxed text-[#687571]">管理标签组和标签，再把它们用于书籍、系列与书架筛选。系列继承标签只读显示。</p>
        </div>
      </div>

      {catalogError && <InlineError message={catalogError} onRetry={() => void loadCatalog()} />}

      <div className="mt-7 grid gap-8 xl:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="border-t-[3px] border-[#c5a76b] bg-[#f9fbf7]" aria-label="标签组">
          <div className="flex items-center justify-between border-b border-[#d0d9d4] px-4 py-4">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[#687571]">Tag groups</span>
            <span className="font-mono text-sm text-[#5c7397]">{groups.length}</span>
          </div>
          {isLoadingCatalog ? <p className="px-4 py-5 text-sm text-[#687571]">正在读取标签…</p> : (
            <div className="divide-y divide-[#d0d9d4]">
              <button type="button" onClick={() => setSelectedGroupId(ALL_GROUP_ID)} className={`flex min-h-12 w-full items-center justify-between border-l-[3px] px-4 py-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#c5a76b] ${selectedGroupId === ALL_GROUP_ID ? 'border-[#2e6e67] bg-[#edf1ee] text-[#18272c]' : 'border-transparent text-[#687571] hover:bg-[#edf1ee]'}`}>
                <span>全部标签</span><span className="font-mono text-[0.65rem]">{tags.length}</span>
              </button>
              <button type="button" onClick={() => setSelectedGroupId(UNGROUPED_GROUP_ID)} className={`flex min-h-12 w-full items-center justify-between border-l-[3px] px-4 py-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#c5a76b] ${selectedGroupId === UNGROUPED_GROUP_ID ? 'border-[#2e6e67] bg-[#edf1ee] text-[#18272c]' : 'border-transparent text-[#687571] hover:bg-[#edf1ee]'}`}>
                <span>未分组</span><span className="font-mono text-[0.65rem]">{tags.filter((tag) => tag.group_id === null).length}</span>
              </button>
              {groups.map((group) => (
                <div key={group.id} className={`border-l-[3px] px-4 py-3 ${selectedGroupId === group.id ? 'border-[#2e6e67] bg-[#edf1ee]' : 'border-transparent'}`}>
                  {editingGroupId === group.id ? (
                    <div className="flex gap-2">
                      <input aria-label="编辑标签组名称" value={groupNameDraft} onChange={(event) => setGroupNameDraft(event.target.value)} className="min-w-0 flex-1 border-b border-[#b9c9c2] bg-transparent py-1 text-sm outline-none focus:border-[#2e6e67]" />
                      <button type="button" onClick={() => void handleUpdateGroup(group)} disabled={busyKey !== null || !groupNameDraft.trim()} className="text-xs text-[#2e6e67] disabled:opacity-40">保存</button>
                      <button type="button" onClick={() => setEditingGroupId(null)} disabled={busyKey !== null} className="text-xs text-[#687571]">取消</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setSelectedGroupId(group.id)} className="min-w-0 flex-1 truncate text-left text-sm text-[#18272c] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">{group.name}</button>
                      <span className="font-mono text-[0.65rem] text-[#687571]">{tags.filter((tag) => tag.group_id === group.id).length}</span>
                      <button type="button" onClick={() => startEditGroup(group)} disabled={busyKey !== null} className="text-[0.65rem] text-[#2e6e67] disabled:opacity-40">编辑</button>
                      <button type="button" onClick={() => void handleDeleteGroup(group)} disabled={busyKey !== null} className="text-[0.65rem] text-[#a54b45] disabled:opacity-40">删除</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <form onSubmit={(event) => void handleCreateGroup(event)} className="border-t border-[#d0d9d4] p-4">
            <label htmlFor="new-tag-group-name" className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[#687571]">新建标签组</label>
            <div className="mt-2 flex gap-2">
              <input id="new-tag-group-name" value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="组名称" className="min-w-0 flex-1 border-b border-[#b9c9c2] bg-transparent px-1 py-2 text-sm outline-none placeholder:text-[#9aa7a1] focus:border-[#2e6e67]" />
              <button type="submit" disabled={isLoadingCatalog || busyKey !== null || !newGroupName.trim()} className="border border-[#2e6e67] px-3 py-2 text-xs text-[#2e6e67] transition hover:bg-[#2e6e67] hover:text-[#f9fbf7] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:opacity-40">添加</button>
            </div>
          </form>
        </aside>

        <div className="min-w-0 space-y-8">
          <section aria-labelledby="tag-definition-title">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d0d9d4] pb-4">
              <div>
                <p className="mb-1 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[#2e6e67]">Definitions</p>
                <h2 id="tag-definition-title" className="font-serif text-2xl text-[#18272c]">{selectedGroupId === ALL_GROUP_ID ? '全部标签' : selectedGroupId === UNGROUPED_GROUP_ID ? '未分组标签' : `${groups.find((group) => group.id === selectedGroupId)?.name ?? '标签组'}中的标签`}</h2>
              </div>
              <span className="font-mono text-sm text-[#5c7397]">{visibleTags.length} 个</span>
            </div>
            <form onSubmit={(event) => void handleCreateTag(event)} className="mt-5 grid gap-3 border-l-[3px] border-[#2e6e67] bg-[#f9fbf7] px-4 py-4 sm:grid-cols-[minmax(0,1fr)_8rem_10rem_auto] sm:items-end sm:px-5">
              <label className="text-xs text-[#687571]">新建标签<input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="标签名称" className="mt-1 w-full border-b border-[#b9c9c2] bg-transparent px-1 py-2 text-sm outline-none placeholder:text-[#9aa7a1] focus:border-[#2e6e67]" /></label>
              <label className="text-xs text-[#687571]">颜色<input type="color" value={newTagColor} onChange={(event) => setNewTagColor(event.target.value)} className="mt-1 h-9 w-full border border-[#d0d9d4] bg-transparent p-1" /></label>
              <label className="text-xs text-[#687571]">标签组<select value={newTagGroupId} onChange={(event) => setNewTagGroupId(event.target.value)} className="mt-1 w-full border border-[#d0d9d4] bg-[#edf1ee] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[#c5a76b]"><option value={UNGROUPED_GROUP_ID}>未分组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
              <button type="submit" disabled={isLoadingCatalog || busyKey !== null || !newTagName.trim()} className="border border-[#2e6e67] px-4 py-2 text-xs text-[#2e6e67] transition hover:bg-[#2e6e67] hover:text-[#f9fbf7] focus:outline-none focus:ring-2 focus:ring-[#c5a76b] disabled:opacity-40">添加标签</button>
            </form>
            {isLoadingCatalog ? <p className="py-5 text-sm text-[#687571]">正在读取标签定义…</p> : visibleTags.length === 0 ? <p className="border-b border-[#d0d9d4] px-1 py-6 text-sm text-[#687571]">这里还没有标签。</p> : (
              <div className="divide-y divide-[#d0d9d4]">
                {visibleTags.map((tag) => (
                  <article key={tag.id} className="grid gap-3 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} aria-label={`颜色 ${tag.color}`} />
                    {editingTagId === tag.id ? (
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_10rem]">
                        <input aria-label="编辑标签名称" value={tagNameDraft} onChange={(event) => setTagNameDraft(event.target.value)} className="border-b border-[#b9c9c2] bg-transparent px-1 py-1 text-sm outline-none focus:border-[#2e6e67]" />
                        <input aria-label="编辑标签颜色" type="color" value={tagColorDraft} onChange={(event) => setTagColorDraft(event.target.value)} className="h-8 w-full border border-[#d0d9d4] bg-transparent p-1" />
                        <select aria-label="编辑标签组" value={tagGroupDraft} onChange={(event) => setTagGroupDraft(event.target.value)} className="border border-[#d0d9d4] bg-[#edf1ee] px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-[#c5a76b]"><option value={UNGROUPED_GROUP_ID}>未分组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
                      </div>
                    ) : (
                      <div className="min-w-0"><p className="truncate font-serif text-xl text-[#18272c]">{tag.name}</p><p className="mt-1 text-xs text-[#687571]">{tag.group_id ? groups.find((group) => group.id === tag.group_id)?.name ?? '已删除的组' : '未分组'} · {tag.color}</p></div>
                    )}
                    <div className="flex items-center justify-end gap-3 text-xs">
                      {editingTagId === tag.id ? <><button type="button" onClick={() => void handleUpdateTag(tag)} disabled={busyKey !== null || !tagNameDraft.trim()} className="border-b border-[#2e6e67] py-1 text-[#2e6e67] disabled:opacity-40">保存</button><button type="button" onClick={() => setEditingTagId(null)} disabled={busyKey !== null} className="py-1 text-[#687571]">取消</button></> : <button type="button" onClick={() => startEditTag(tag)} disabled={busyKey !== null} className="border-b border-transparent py-1 text-[#2e6e67] hover:border-[#2e6e67] disabled:opacity-40">编辑</button>}
                      <button type="button" onClick={() => void handleDeleteTag(tag)} disabled={busyKey !== null} className="border-b border-transparent py-1 text-[#a54b45] hover:border-[#a54b45] disabled:opacity-40">删除</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="border-t-[3px] border-[#c5a76b] pt-5" aria-labelledby="tag-filter-title">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d0d9d4] pb-4"><div><p className="mb-1 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[#2e6e67]">Shelf query</p><h2 id="tag-filter-title" className="font-serif text-2xl text-[#18272c]">按标签筛选</h2></div><span className="text-xs text-[#687571]">{selectedFilterTagIds.length === 0 ? '显示全部藏书' : `同时满足 ${selectedFilterTagIds.length} 个标签`}</span></div>
            <div className="mt-4 flex flex-wrap gap-2">{tags.map((tag) => <button key={tag.id} type="button" aria-pressed={filterTagSet.has(tag.id)} onClick={() => handleToggleFilterTag(tag.id)} disabled={busyKey !== null} className={`border px-3 py-2 text-xs transition focus:outline-none focus:ring-2 focus:ring-[#c5a76b] ${filterTagSet.has(tag.id) ? 'border-[#2e6e67] bg-[#2e6e67] text-[#f9fbf7]' : 'border-[#d0d9d4] bg-[#f9fbf7] text-[#687571] hover:border-[#2e6e67] hover:text-[#2e6e67]'}`}><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />{tag.name}</button>)}</div>
            {filterError && <InlineError message={filterError} onRetry={() => void applyTagFilter(selectedFilterTagIds)} />}
            {isFiltering ? <p className="py-5 text-sm text-[#687571]">正在按标签筛选…</p> : <div className="mt-5">{filteredBooks.length === 0 ? <p className="border-b border-[#d0d9d4] px-1 py-6 text-sm text-[#687571]">没有同时满足这些标签的书。</p> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{filteredBooks.map((book) => <article key={book.id} className="flex min-w-0 gap-3 border-t border-[#d0d9d4] pt-3"><button type="button" onClick={() => onOpenBook(book)} className="focus:outline-none focus:ring-2 focus:ring-[#c5a76b]"><LibraryBookCover book={book} size="tiny" /></button><div className="min-w-0"><button type="button" onClick={() => onOpenBook(book)} className="block max-w-full truncate text-left font-serif text-lg text-[#18272c] hover:text-[#2e6e67] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">{book.title}</button><p className="mt-1 truncate text-xs text-[#687571]">{book.authors.length > 0 ? book.authors.join(' · ') : '作者信息未提供'}</p></div></article>)}</div>}</div>}
          </section>

          <div className="grid gap-8 lg:grid-cols-2">
            <section className="border-t-[3px] border-[#2e6e67] pt-5" aria-labelledby="book-tags-title">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#d0d9d4] pb-4"><div><p className="mb-1 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[#2e6e67]">Direct and inherited</p><h2 id="book-tags-title" className="font-serif text-2xl text-[#18272c]">书籍标签</h2></div><button type="button" onClick={() => void handleSaveBookTags()} disabled={!selectedBook || isLoadingBookTags || busyKey !== null} className="border-b border-[#2e6e67] py-1 text-xs text-[#2e6e67] disabled:opacity-40">保存直接标签</button></div>
              <label className="mt-4 block text-xs text-[#687571]">选择书籍<select value={selectedBookId} onChange={(event) => setSelectedBookId(event.target.value)} disabled={busyKey !== null} className="mt-1 w-full border border-[#d0d9d4] bg-[#edf1ee] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[#c5a76b]"><option value="">选择一本书</option>{books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label>
              {bookTagsError && <InlineError message={bookTagsError} onRetry={() => void loadBookTags()} />}
              {!selectedBook ? <p className="py-5 text-sm text-[#687571]">书架还没有书。</p> : isLoadingBookTags ? <p className="py-5 text-sm text-[#687571]">正在读取这本书的标签…</p> : <div className="mt-4 space-y-2">{tags.length === 0 ? <p className="text-sm text-[#687571]">先建立标签，再给书籍添加关系。</p> : tags.map((tag) => { const inherited = inheritedBookTagIds.has(tag.id); const checked = inherited || bookDirectTagSet.has(tag.id); return <label key={tag.id} className={`flex items-center gap-3 border-b border-[#d0d9d4] py-2 text-sm ${inherited ? 'text-[#687571]' : 'text-[#18272c]'}`}><input type="checkbox" checked={checked} disabled={inherited || busyKey !== null} onChange={() => { if (!inherited) setBookDirectTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id]); }} className="accent-[#2e6e67]" /><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" /><span>{tag.name}</span>{inherited && <span className="ml-auto text-[0.65rem] text-[#5c7397]">系列继承 · 只读</span>}{!inherited && bookDirectTagSet.has(tag.id) && <span className="ml-auto text-[0.65rem] text-[#2e6e67]">直接</span>}</label>; })}</div>}
            </section>

            <section className="border-t-[3px] border-[#c5a76b] pt-5" aria-labelledby="series-tags-title">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#d0d9d4] pb-4"><div><p className="mb-1 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[#2e6e67]">Series defaults</p><h2 id="series-tags-title" className="font-serif text-2xl text-[#18272c]">系列标签</h2></div><button type="button" onClick={() => void handleSaveSeriesTags()} disabled={!selectedSeries || isLoadingSeriesTags || busyKey !== null} className="border-b border-[#2e6e67] py-1 text-xs text-[#2e6e67] disabled:opacity-40">保存系列标签</button></div>
              <label className="mt-4 block text-xs text-[#687571]">选择系列<select value={selectedSeriesId} onChange={(event) => setSelectedSeriesId(event.target.value)} disabled={busyKey !== null} className="mt-1 w-full border border-[#d0d9d4] bg-[#edf1ee] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[#c5a76b]"><option value="">选择一个系列</option>{series.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              {seriesTagsError && <InlineError message={seriesTagsError} onRetry={() => void loadSeriesTags()} />}
              {!selectedSeries ? <p className="py-5 text-sm text-[#687571]">还没有系列。</p> : isLoadingSeriesTags ? <p className="py-5 text-sm text-[#687571]">正在读取系列标签…</p> : <div className="mt-4 space-y-2">{tags.length === 0 ? <p className="text-sm text-[#687571]">先建立标签，再给系列添加关系。</p> : tags.map((tag) => <label key={tag.id} className="flex items-center gap-3 border-b border-[#d0d9d4] py-2 text-sm text-[#18272c]"><input type="checkbox" checked={seriesDirectTagSet.has(tag.id)} disabled={busyKey !== null} onChange={() => setSeriesDirectTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])} className="accent-[#2e6e67]" /><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" /><span>{tag.name}</span>{seriesDirectTagSet.has(tag.id) && <span className="ml-auto text-[0.65rem] text-[#2e6e67]">系列直接</span>}</label>)}</div>}
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}

function tagGroupIdOrNull(groupId: string): string | null {
  return groupId === UNGROUPED_GROUP_ID || groupId === ALL_GROUP_ID ? null : groupId;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-l-[3px] border-[#a54b45] bg-[#fff8f6] px-5 py-4" role="alert"><p className="break-words text-sm leading-relaxed text-[#7c3834]">{message}</p>{onRetry && <button type="button" onClick={onRetry} className="border-b border-[#a54b45] py-1 text-xs text-[#a54b45] focus:outline-none focus:ring-2 focus:ring-[#c5a76b]">重试</button>}</div>;
}
