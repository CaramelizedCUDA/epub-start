import { useReaderStore } from '../../stores/readerStore';
import type { ReadingSettings } from '../../types/models';

// E2E 测试钩子：仅开发构建且 URL 带 ?e2e=1 时挂出，供 epubstart-e2e 的走书器与设置入口使用。
// 设置必须经 applyReadingSettings 进入 reflow.ts，不能由测试直接调用 rendition.resize()。
// 从应用入口引入而不放在 readerStore 中，使 import.meta 不进入 test:frontend 的编译范围。
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('e2e')) {
  (window as unknown as { __EPUBSTART_E2E__: unknown }).__EPUBSTART_E2E__ = {
    get rendition() {
      return useReaderStore.getState().rendition;
    },
    readingSettings: () => useReaderStore.getState().readingSettings,
    applySettings: (settings: ReadingSettings) => useReaderStore.getState().applyReadingSettings(settings),
  };
}
