// 浏览器里没有 Tauri 运行时，EpubStart 的 invoke() 会失败。这里在页面加载前注入
// window.__TAURI_INTERNALS__（@tauri-apps/api 调用的就是这个对象），按 IPC 类型返回最小数据。
// 只模拟阅读器路径需要的命令；未登记的命令返回 null 并打印 warning，便于发现遗漏。
// 注意：下面的注入函数会被 Playwright 序列化到页面里，必须自包含，不能引用外部变量。

import type { Page } from "@playwright/test";

export interface TauriMockBook {
  id: string;
  title: string;
}

export interface TauriMockConfig {
  books: TauriMockBook[];
  bookBase: string; // 书资源服务的根地址，例如 http://127.0.0.1:4174
}

// 与 Rust 测试夹具 valid_input 一致的阅读设置，作为模拟的全局默认值；
// font_family 固定为 publisher，使 reflow.ts 输出 inherit 并使用合成 EPUB 内嵌的 E2EFont（Noto Sans SC 子集）
const DEFAULT_SETTINGS = {
  theme: "light",
  font_family: "publisher",
  font_size_px: 16,
  line_height_multiplier: 1.5,
  paragraph_spacing_multiplier: 0.5,
  text_indent_em: 2,
  margin_top_px: 48,
  margin_bottom_px: 48,
  margin_left_percent: 3,
  margin_right_percent: 3,
  max_column_width_px: 720,
  flow: "paginated",
  spread: "auto",
  updated_at: 0,
};

function injectTauriMock(cfg: { books: TauriMockBook[]; bookBase: string; defaults: unknown }) {
  const w = window as unknown as Record<string, unknown>;
  const now = 0;
  const summaryOf = (b: TauriMockBook) => ({
    id: b.id,
    title: b.title,
    authors: ["E2E"],
    format: "epub",
    cover_cache_path: null,
    file_size_bytes: 0,
    last_modified_ts: now,
    package_identifier: null,
    status: "available",
    status_detail: null,
    added_at: now,
    updated_at: now,
  });
  const find = (id: string) => cfg.books.find((b) => b.id === id) ?? cfg.books[0]!;
  const handlers: Record<string, (args: any) => unknown> = {
    list_books: () => cfg.books.map(summaryOf),
    open_book: (args) => {
      const b = find(args.bookId);
      return {
        book: { ...summaryOf(b), source_locator: "e2e", source_kind: "local_file" },
        epub_root_url: `${cfg.bookBase}/book/${b.id}/`,
      };
    },
    get_global_reading_settings: () => cfg.defaults,
    get_reading_settings: () => ({ effective: cfg.defaults, global: cfg.defaults, book_override: null }),
    save_global_reading_settings: () => cfg.defaults,
    save_book_reading_settings: () => null,
    clear_book_reading_settings: () => null,
    get_reading_progress: () => null,
    save_reading_progress: () => null,
    begin_reading_activity: () => null,
    observe_reading_activity: () => null,
    list_notes: () => [],
    list_book_tags: () => [],
    list_tags: () => [],
    list_tag_groups: () => [],
    list_series: () => [],
  };
  const unhandled: string[] = [];
  w.__E2E_IPC_UNHANDLED__ = unhandled;
  w.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    unregisterCallback: () => undefined,
    convertFileSrc: (p: string) => p,
    invoke: (cmd: string, args: any) => {
      const h = handlers[cmd];
      if (!h) {
        unhandled.push(cmd);
        console.warn("[tauri-mock] unhandled command: " + cmd);
        return Promise.resolve(null);
      }
      return Promise.resolve().then(() => h(args ?? {}));
    },
  };
}

export async function installTauriMock(page: Page, cfg: TauriMockConfig): Promise<void> {
  await page.addInitScript(injectTauriMock, { ...cfg, defaults: DEFAULT_SETTINGS });
}

export { DEFAULT_SETTINGS };
