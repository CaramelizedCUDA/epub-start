// Type declarations for epubjs v0.3.
declare module 'epubjs' {
  type EpubRequestResult = ArrayBuffer | Document | string;

  interface BookOptions {
    requestMethod?: (
      url: string,
      type: string,
      withCredentials?: boolean,
      headers?: Record<string, string>,
    ) => Promise<EpubRequestResult>;
    replacements?: string;
  }

  interface RenditionOptions {
    width?: string | number;
    height?: string | number;
    flow?: 'paginated' | 'scrolled';
    spread?: 'none' | 'auto' | 'both';
    manager?: string;
    gap?: number;
  }

  interface Location {
    start: LocationDetail;
    end: LocationDetail;
  }

  interface LocationDetail {
    index: number;
    href: string;
    cfi: string;
    displayed: {
      page: number;
      total: number;
    };
  }

  class Annotations {
    add(
      type: string,
      cfiRange: string,
      data?: object,
      cb?: (...args: unknown[]) => void,
      className?: string,
      styles?: object,
    ): unknown;
    remove(cfiRange: string, type: string): void;
    highlight(
      cfiRange: string,
      data?: object,
      cb?: (...args: unknown[]) => void,
      className?: string,
      styles?: object,
    ): unknown;
  }

  class EpubCFI {
    constructor(cfiFrom?: string);
    parse(cfiStr: string): EpubCFI;
    collapse(toStart?: boolean): void;
    toString(): string;
  }

  class Rendition {
    settings: RenditionOptions;
    on(event: string, callback: (...args: unknown[]) => void): void;
    off(event: string, callback: (...args: unknown[]) => void): void;
    display(target?: string | number): Promise<void>;
    next(): void;
    prev(): void;
    currentLocation(): Location | Promise<Location>;
    destroy(): void;
    resize(width: number, height: number, epubCfi?: string): void;
    themes: Themes;
    annotations: Annotations;
    getContents(): Content[];
    views(): RenditionViews;
    getRange(cfi: string, ignoreClass?: string): Range;
    flow(flow: string): void;
    spread(spread: string, min?: number): void;
  }

  interface Themes {
    register(name: string, theme: object): void;
    select(name: string): void;
    override(name: string, value: string, priority?: boolean): void;
    fontSize(size: string): void;
    font(fontFamily: string): void;
  }

  interface Content {
    document: Document;
    window: Window;
    cfiFromRange(range: Range): string;
    range(cfi: string): Range;
    locationOf(target: string): Promise<{ top: number; left: number }>;
  }

  interface RenditionView {
    contents?: Content;
    section?: { href?: string; index?: number };
  }

  interface RenditionViews {
    all(): RenditionView[];
  }

  class Book {
    constructor(urlOrOptions?: string | BookOptions);
    open(url: string): Promise<void>;
    ready: Promise<void>;
    rendition: Rendition;
    navigation: { toc: TocItem[] };
    opened: boolean;
    renderTo(
      element: string | HTMLElement,
      options?: RenditionOptions,
    ): Rendition;
    destroy(): void;
  }

  export interface TocItem {
    label: string;
    href: string;
    subitems?: TocItem[];
  }

  const ePub: {
    (urlOrOptions?: string | BookOptions): Book;
    Book: typeof Book;
  };

  export { Book, Content, Rendition, Location, EpubCFI };
  export default ePub;
}
