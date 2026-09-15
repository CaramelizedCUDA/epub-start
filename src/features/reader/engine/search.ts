import type { Book } from 'epubjs';

export interface ChapterSearchResult {
  hits: Array<{ href: string; excerpt: string }>;
  failedChapters: number;
  limited: boolean;
}

/** Chapter-level hits only: no offsets are advertised as precise DOM CFIs. */
export async function searchBookChapters(
  book: Book,
  query: string,
  isActive: () => boolean,
): Promise<ChapterSearchResult> {
  const result: ChapterSearchResult = { hits: [], failedChapters: 0, limited: false };
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2 || !isActive()) return result;
  type SearchSection = { href: string; url: string };
  const source = book as unknown as {
    spine: { each: (callback: (section: SearchSection) => void) => void };
    load: (url: string) => Promise<Document>;
  };
  const sections: SearchSection[] = [];
  source.spine.each((section) => sections.push(section));
  for (let index = 0; index < sections.length; index += 1) {
    if (!isActive()) return result;
    const section = sections[index];
    try {
      // Use the Book's controlled request adapter on Windows/Android/Linux.
      // Do not call Section.load() with its default browser request function,
      // or unload a Section that a visible/preloaded Rendition may be using.
      const document = await source.load(section.url);
      if (!isActive()) return result;
      const text = (document.body ?? document.documentElement)?.textContent ?? '';
      const match = text.toLocaleLowerCase().indexOf(needle);
      if (match < 0) continue;
      result.hits.push({
        href: section.href,
        excerpt: text.slice(Math.max(0, match - 60), match + query.trim().length + 120),
      });
      if (result.hits.length === 50) {
        result.limited = index < sections.length - 1;
        return result;
      }
    } catch {
      if (!isActive()) return result;
      result.failedChapters += 1;
    }
  }
  return result;
}
