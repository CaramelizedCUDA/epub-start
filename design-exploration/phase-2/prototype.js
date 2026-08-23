/*
 * EpubStart Editorial Personal — Phase 2 static prototype.
 * Throwaway, memory-only UI. It deliberately performs no Tauri invoke, file I/O,
 * persistence, indexing, or production mutation.
 */

(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const dom = {
    body: document.body,
    libraryView: $("#libraryView"),
    readerView: $("#readerView"),
    readerToolbar: $("#readerToolbar"),
    readerCanvas: $("#readerCanvas"),
    readerPanel: $("#readerPanel"),
    bookCollection: $("#bookCollection"),
    libraryCountLabel: $("#libraryCountLabel"),
    collectionSummary: $("#collectionSummary"),
    detailLeaf: $("#detailLeaf"),
    detailCover: $("#detailCover"),
    detailFolio: $("#detailFolio"),
    detailCoverTitle: $("#detailCoverTitle"),
    detailSeries: $("#detailSeries"),
    detailTitle: $("#detailTitle"),
    detailAuthor: $("#detailAuthor"),
    detailDescription: $("#detailDescription"),
    detailStatus: $("#detailStatus"),
    detailTags: $("#detailTags"),
    detailAdded: $("#detailAdded"),
    sourceNotice: $("#sourceNotice"),
    openSelected: $("#openSelected"),
    relinkSelected: $("#relinkSelected"),
    searchOverlay: $("#searchOverlay"),
    searchInput: $("#searchInput"),
    searchTitle: $("#searchTitle"),
    searchResultCount: $("#searchResultCount"),
    searchResults: $("#searchResults"),
    indexStatus: $("#indexStatus"),
    relinkOverlay: $("#relinkOverlay"),
    relinkTitle: $("#relinkTitle"),
    relinkState: $("#relinkState"),
    relinkDemoControls: $("#relinkDemoControls"),
    beginRelink: $("#beginRelink"),
    reviewToggle: $("#reviewToggle"),
    reviewPanel: $("#reviewPanel"),
    reviewStateOutput: $("#reviewStateOutput"),
    fontSizeOutput: $("#fontSizeOutput"),
    toast: $("#toast"),
    liveRegion: $("#liveRegion"),
  };

  const featured = [
    {
      title: "室内气候",
      author: "朴澄",
      series: "未归入系列",
      tags: "随笔 · 夏天",
      description: "关于房间、季节与生活缓慢变化的短篇随笔集。",
    },
    {
      title: "这里是终末停滞委员会",
      author: "冬野灯",
      series: "终末停滞委员会 · 第四卷",
      tags: "小说 · 科幻",
      description: "时间停下后，一群人仍试着把普通生活延续到下一页。",
    },
    {
      title: "云层以下的航线",
      author: "周岭",
      series: "低空札记 · 第一卷",
      tags: "旅行 · 纪实",
      description: "沿海岸与山脊之间的低空路线，记录天气，也记录相遇。",
    },
    {
      title: "百叶窗后的冬季",
      author: "简木",
      series: "城市短篇",
      tags: "短篇 · 冬天",
      description: "十一间屋子，十一扇窗，以及没有寄出的十一封信。",
    },
    {
      title: "潮汐练习册",
      author: "顾藻",
      series: "未归入系列",
      tags: "诗歌 · 海洋",
      description: "把潮水的往复写成日常练习，也写成一次缓慢告别。",
    },
    {
      title: "未完成地图集",
      author: "沈砚",
      series: "纸上远方 · 第二卷",
      tags: "图册 · 地理",
      description: "一部只标记抵达、从不标记终点的私人地图。",
    },
    {
      title: "玻璃花房夜谈",
      author: "方悄",
      series: "夜间植物志",
      tags: "小说 · 植物",
      description: "闭馆以后，花房里的植物开始讲述保存在叶脉中的旧事。",
    },
    {
      title: "海岸线以北",
      author: "陈洄",
      series: "北方地景",
      tags: "纪实 · 海岸",
      description: "来源文件已经移动；这里用于评审重新关联的保守恢复流程。",
      status: "missing",
    },
    {
      title: "蜂蜜色下午",
      author: "宋眠",
      series: "未归入系列",
      tags: "随笔 · 食物",
      description: "把午后三点到五点之间的光、气味和谈话留在纸上。",
    },
    {
      title: "信号灯与候鸟",
      author: "陆遥川",
      series: "迁徙观察 · 第三卷",
      tags: "自然 · 城市",
      description: "候鸟经过城市上空时，交通与季节短暂共享一套节奏。",
    },
    {
      title: "月台尽头的书店",
      author: "千寻",
      series: "慢车书系",
      tags: "小说 · 书店",
      description: "末班车离开后，月台尽头仍有一家只为错过的人营业的书店。",
    },
    {
      title: "群山的背面",
      author: "梁青",
      series: "山行笔记",
      tags: "旅行 · 山野",
      description: "一次无法完成封面解析的导入，用于评审温和错误提示。",
      status: "cover-error",
    },
    {
      title: "在雨停之前",
      author: "叶灯",
      series: "天气短篇",
      tags: "小说 · 雨季",
      description: "一场持续七天的雨，把陌生人留在同一座檐下。",
    },
    {
      title: "白噪音博物馆",
      author: "郁声",
      series: "声音档案",
      tags: "随笔 · 声音",
      description: "收集风扇、列车、雨棚与遥远海浪构成的日常白噪音。",
    },
    {
      title: "迟来的日光",
      author: "林渡",
      series: "未归入系列",
      tags: "小说 · 成长",
      description: "冬至过后，光一点点回到旧公寓和居住其中的人。",
    },
    {
      title: "植物园闭园以后",
      author: "米川",
      series: "夜间植物志 · 第二卷",
      tags: "奇想 · 植物",
      description: "游客散去，园丁开始整理那些白天不会出现的植物。",
    },
    {
      title: "没有钟表的房间",
      author: "许泊",
      series: "室内寓言",
      tags: "寓言 · 时间",
      description: "房间里没有钟，却有许多判断时间的方法。",
    },
    {
      title: "纸船编年史",
      author: "卫蓝",
      series: "河流故事",
      tags: "小说 · 河流",
      description: "顺流而下的纸船，每一只都带着一段没有署名的历史。",
    },
    {
      title: "大雾中的小径",
      author: "青岚",
      series: "山行笔记 · 第五卷",
      tags: "旅行 · 徒步",
      description: "能见度只剩十米以后，熟悉的小径显出另一种尺度。",
    },
    {
      title: "北窗手记",
      author: "唐页",
      series: "四季窗边",
      tags: "日记 · 四季",
      description: "从一扇向北的窗记录一年里不直接抵达的光。",
    },
  ];

  const generatedNouns = ["雨痕", "旧港", "微光", "松针", "电车", "长夜", "候鸟", "折页", "盐风", "星图", "窄巷", "远钟"];
  const generatedForms = ["档案", "通信", "札记", "练习", "年表", "地图", "读本", "手册", "纪事", "小史"];
  const generatedAuthors = ["周汐", "林岫", "顾垣", "白野", "苏砚", "乔木", "石页", "沈清", "闻川", "陆芒", "叶舟", "何朔"];

  const books = Array.from({ length: 1000 }, (_, index) => {
    const base = featured[index];
    const sequence = String(index + 1).padStart(4, "0");
    if (base) {
      return {
        id: `book-${sequence}`,
        title: base.title,
        author: base.author,
        series: base.series,
        tags: base.tags,
        description: base.description,
        status: base.status || "available",
        added: index < 2 ? "今天" : `${(index % 23) + 1} 天前`,
        style: index % 12,
        folio: String(index + 1).padStart(2, "0"),
      };
    }

    const noun = generatedNouns[index % generatedNouns.length];
    const form = generatedForms[Math.floor(index / generatedNouns.length) % generatedForms.length];
    const volume = Math.floor(index / 120) + 1;
    return {
      id: `book-${sequence}`,
      title: `${noun}${form} · ${sequence}`,
      author: generatedAuthors[index % generatedAuthors.length],
      series: `${noun}书系 · 第 ${volume} 辑`,
      tags: `${form} · 私人藏书`,
      description: `用于评审 ${index + 1} 本规模下的标题长度、排序节奏与浏览密度。`,
      status: index % 173 === 0 ? "cover-error" : "available",
      added: `${(index % 180) + 1} 天前`,
      style: index % 12,
      folio: String((index % 99) + 1).padStart(2, "0"),
    };
  });

  const params = new URLSearchParams(window.location.search);
  const allowedCounts = [10, 100, 1000];
  const allowedIndexStates = ["ready", "building", "cancelled", "pending", "error"];
  const initialCount = Number(params.get("count"));
  const smallScreen = window.matchMedia("(max-width: 760px)").matches;

  const state = {
    view: params.get("view") === "reader" ? "reader" : "library",
    count: allowedCounts.includes(initialCount) ? initialCount : 100,
    layout: params.get("layout") === "compact" ? "compact" : "grid",
    selectedBookId: params.get("missing") === "1" ? "book-0008" : "book-0001",
    detailOpen: params.get("detail") === "1" ? true : params.get("detail") === "0" ? false : !smallScreen,
    readerState: params.get("reader") === "controls" ? "controls" : "quiet",
    readerPanel: ["toc", "settings", "notes"].includes(params.get("panel")) ? params.get("panel") : "toc",
    readerPanelOpen: params.get("reader") === "controls" && (params.has("panel") || params.get("view") === "reader"),
    theme: ["light", "paper", "dark"].includes(params.get("theme")) ? params.get("theme") : "light",
    fontSize: 18,
    searchOpen: params.get("search") === "1",
    searchScope: ["library", "series", "content"].includes(params.get("scope")) ? params.get("scope") : "library",
    indexState: allowedIndexStates.includes(params.get("index")) ? params.get("index") : "ready",
    activeSearchIndex: 0,
    relinkOpen: false,
    reviewOpen: params.get("review") !== "0",
    reviewVisible: params.get("review") !== "0",
    lastFocus: null,
  };

  let toastTimer = 0;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function selectedBook() {
    return books.find((book) => book.id === state.selectedBookId) || books[0];
  }

  function statusLabel(book) {
    if (book.status === "missing") return "来源文件丢失";
    if (book.status === "cover-error") return "可阅读 · 封面待解析";
    return "可阅读";
  }

  function announce(message) {
    dom.liveRegion.textContent = "";
    window.setTimeout(() => {
      dom.liveRegion.textContent = message;
    }, 20);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      dom.toast.hidden = true;
    }, 2600);
  }

  function syncUrl() {
    const url = new URL(window.location.href);
    const next = new URLSearchParams();
    next.set("view", state.view);
    next.set("count", String(state.count));
    next.set("layout", state.layout);
    next.set("reader", state.readerState);
    if (state.readerPanelOpen) next.set("panel", state.readerPanel);
    next.set("theme", state.theme);
    next.set("scope", state.searchScope);
    next.set("index", state.indexState);
    next.set("detail", state.detailOpen ? "1" : "0");
    next.set("review", state.reviewVisible ? "1" : "0");
    if (state.searchOpen) next.set("search", "1");
    if (selectedBook().status === "missing") next.set("missing", "1");
    url.search = next.toString();
    try {
      window.history.replaceState(null, "", url);
    } catch (_error) {
      // A restrictive file:// host may reject history updates; the prototype still works.
    }
  }

  function renderBooks({ preserveFocus = false } = {}) {
    const focusedId = preserveFocus ? document.activeElement?.dataset?.bookId : null;
    const visibleBooks = books.slice(0, state.count);
    if (!visibleBooks.some((book) => book.id === state.selectedBookId)) {
      state.selectedBookId = visibleBooks[0].id;
    }

    dom.bookCollection.innerHTML = visibleBooks
      .map((book) => {
        const isSelected = book.id === state.selectedBookId;
        const issue = book.status === "missing"
          ? '<span class="source-badge" title="来源文件丢失" aria-hidden="true">!</span>'
          : book.status === "cover-error"
            ? '<span class="source-badge" title="封面解析失败" aria-hidden="true">·</span>'
            : "";
        return `
          <div class="book-record" role="listitem">
            <button
              class="book-item${isSelected ? " is-selected" : ""}"
              type="button"
              data-book-id="${book.id}"
              aria-pressed="${isSelected}"
              aria-label="${escapeHtml(book.title)}，${escapeHtml(book.author)}，${escapeHtml(statusLabel(book))}"
            >
              <span class="cover-art cover-style-${book.style}" aria-hidden="true">
                <span class="cover-folio">${book.folio}</span>
                <strong>${escapeHtml(book.title)}</strong>
                <small>EPUB</small>
              </span>
              ${issue}
              <span class="book-copy"><strong>${escapeHtml(book.title)}</strong><span>${escapeHtml(book.author)} · ${escapeHtml(book.series)}</span></span>
            </button>
          </div>`;
      })
      .join("");

    dom.libraryCountLabel.textContent = `${state.count} 本 EPUB`;
    dom.collectionSummary.textContent = `显示 ${state.count} 本；${state.layout === "grid" ? "封面网格" : "紧凑清单"}；来源异常以感叹号标记`;
    renderDetail();

    if (focusedId) {
      $(`[data-book-id="${focusedId}"]`)?.focus();
    }
  }

  function renderDetail() {
    const book = selectedBook();
    dom.detailLeaf.dataset.open = String(state.detailOpen);
    dom.detailCover.className = `detail-cover cover-style-${book.style}`;
    dom.detailCover.setAttribute("aria-label", `${book.title} 的原型封面`);
    dom.detailFolio.textContent = book.folio;
    dom.detailCoverTitle.textContent = book.title;
    dom.detailSeries.textContent = book.series;
    dom.detailTitle.textContent = book.title;
    dom.detailAuthor.textContent = book.author;
    dom.detailDescription.textContent = book.description;
    dom.detailStatus.textContent = statusLabel(book);
    dom.detailTags.textContent = book.tags;
    dom.detailAdded.textContent = book.added;
    const isMissing = book.status === "missing";
    dom.sourceNotice.hidden = !isMissing;
    dom.openSelected.hidden = isMissing;
    dom.relinkSelected.hidden = !isMissing;
  }

  function renderView() {
    const inLibrary = state.view === "library";
    dom.libraryView.hidden = !inLibrary;
    dom.readerView.hidden = inLibrary;
    dom.body.dataset.view = state.view;
    $$("[data-nav]").forEach((button) => {
      const current = inLibrary && button.dataset.nav === "library";
      button.classList.toggle("is-current", current);
      if (current) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function renderReader() {
    dom.body.dataset.readerState = state.readerState;
    dom.body.dataset.theme = state.theme;
    dom.body.style.setProperty("--reader-font-size", `${state.fontSize}px`);
    dom.fontSizeOutput.textContent = `${state.fontSize} px`;
    dom.readerPanel.hidden = !(state.readerState === "controls" && state.readerPanelOpen);
    dom.readerToolbar.inert = state.readerState === "quiet";
    dom.readerPanel.inert = !(state.readerState === "controls" && state.readerPanelOpen);
    $(".page-rail").inert = state.readerState === "quiet";
    $$('[data-panel-content]').forEach((panel) => {
      panel.hidden = panel.dataset.panelContent !== state.readerPanel;
    });
    $$('[data-reader-panel]').forEach((button) => {
      const selected = state.readerPanelOpen && button.dataset.readerPanel === state.readerPanel;
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function indexStatusMarkup() {
    switch (state.indexState) {
      case "building":
        return {
          className: "index-status",
          html: '<h3>正在建立系列正文索引 · 34 / 135 册</h3><p>已完成的书可以先搜索；关闭面板不会中断静态演示。</p><progress value="34" max="135" aria-label="索引进度 34 / 135"></progress><button type="button" data-index-action="cancel">取消建立</button>',
        };
      case "cancelled":
        return {
          className: "index-status",
          html: '<h3>索引已取消 · 保留 34 / 135 册的可搜索结果</h3><p>重新开始时从未完成的书继续；这是契约映射，不代表真实任务正在运行。</p><button type="button" data-index-action="continue">继续建立</button>',
        };
      case "pending":
        return {
          className: "index-status",
          html: '<h3>这个系列还没有正文索引</h3><p>先建立索引，再搜索章节正文。原型不会读取任何 EPUB。</p><button type="button" data-index-action="build">建立索引</button>',
        };
      case "error":
        return {
          className: "index-status is-error",
          html: '<h3>索引未能完成</h3><p>1 册来源文件不可用；也可能触发资源上限。处理异常书后可重试。</p><button type="button" data-index-action="retry">重试</button>',
        };
      default:
        return {
          className: "index-status",
          html: '<h3>系列正文索引已就绪 · 135 / 135 册</h3><p>匹配结果按书与章节分组；结果只展示章节标题和短摘要。</p>',
        };
    }
  }

  function librarySearchResults(query) {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    const candidates = books.slice(0, state.count);
    const results = normalized
      ? candidates.filter((book) => `${book.title} ${book.author} ${book.series}`.toLocaleLowerCase("zh-CN").includes(normalized))
      : candidates;
    return results.slice(0, 8).map((book, index) => ({
      id: book.id,
      index: String(index + 1).padStart(2, "0"),
      title: book.title,
      secondary: `${book.author} · ${book.series}`,
      meta: statusLabel(book),
      kind: "book",
    }));
  }

  function seriesSearchResults(query) {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    const grouped = new Map();
    books.slice(0, state.count).forEach((book) => {
      if (!grouped.has(book.series)) grouped.set(book.series, []);
      grouped.get(book.series).push(book);
    });
    return Array.from(grouped.entries())
      .filter(([series]) => !normalized || series.toLocaleLowerCase("zh-CN").includes(normalized) || normalized === "停滞")
      .slice(0, 8)
      .map(([series, members], index) => ({
        id: members[0].id,
        index: String(index + 1).padStart(2, "0"),
        title: series,
        secondary: `${members.length} 册 · ${members.slice(0, 2).map((book) => book.author).join("、")}`,
        meta: "系列",
        kind: "series",
      }));
  }

  function contentSearchResults(query) {
    if (["pending", "error"].includes(state.indexState)) return [];
    if (query.trim().length > 0 && !"停滞时间继续明天".includes(query.trim()) && !query.includes("停")) return [];
    const items = [
      {
        id: "book-0002",
        index: "04",
        title: "第四章 · 并非所有静止都是终点",
        secondary: "这里是终末停滞委员会 · 第四卷",
        snippet: "……她忽然明白，继续并不一定需要时间向前。",
        meta: "42%",
        kind: "content",
      },
      {
        id: "book-0002",
        index: "01",
        title: "第一章 · 城市停止的早晨",
        secondary: "这里是终末停滞委员会 · 第四卷",
        snippet: "……所有信号灯同时停在红色，像城市屏住了呼吸。",
        meta: "12%",
        kind: "content",
      },
      {
        id: "book-0017",
        index: "03",
        title: "没有钟表的房间",
        secondary: "室内寓言 · 第三章",
        snippet: "……时间没有停滞，只是失去了可以被指认的刻度。",
        meta: "31%",
        kind: "content",
      },
    ];
    return state.indexState === "cancelled" ? items.slice(0, 2) : items;
  }

  function renderSearch() {
    dom.searchOverlay.hidden = !state.searchOpen;
    const query = dom.searchInput.value;
    const scopeNames = { library: "Library", series: "Series", content: "Content" };
    $$('[data-search-scope]').forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.searchScope === state.searchScope));
      button.tabIndex = button.dataset.searchScope === state.searchScope ? 0 : -1;
    });
    dom.searchTitle.textContent = `${scopeNames[state.searchScope]} 中的结果`;

    let results = [];
    if (state.searchScope === "library") results = librarySearchResults(query);
    if (state.searchScope === "series") results = seriesSearchResults(query);
    if (state.searchScope === "content") results = contentSearchResults(query);

    const showIndex = state.searchScope === "content";
    dom.indexStatus.hidden = !showIndex;
    if (showIndex) {
      const status = indexStatusMarkup();
      dom.indexStatus.className = status.className;
      dom.indexStatus.innerHTML = status.html;
    }

    state.activeSearchIndex = Math.min(state.activeSearchIndex, Math.max(0, results.length - 1));
    dom.searchResultCount.textContent = `${results.length} 项`;
    dom.searchResults.innerHTML = results.length
      ? results.map((result, index) => `
          <button class="search-result${index === state.activeSearchIndex ? " is-active" : ""}" type="button" data-search-result="${escapeHtml(result.id)}" data-result-kind="${result.kind}" ${index === state.activeSearchIndex ? 'aria-current="true"' : ""}>
            <span class="search-result-index" aria-hidden="true">${escapeHtml(result.index)}</span>
            <span class="search-result-copy"><strong>${escapeHtml(result.title)}</strong><span>${escapeHtml(result.secondary)}</span>${result.snippet ? `<mark>${escapeHtml(result.snippet)}</mark>` : ""}</span>
            <small>${escapeHtml(result.meta)}</small>
          </button>`).join("")
      : `<div class="empty-search"><strong>${showIndex && state.indexState !== "ready" ? "当前没有可显示的正文结果" : "没有找到匹配项"}</strong><span>${showIndex ? "检查索引状态，或换一个关键词。" : "尝试书名、作者或系列中的其他词。"}</span></div>`;
  }

  function renderReview() {
    if (!state.reviewVisible) {
      dom.reviewToggle.hidden = true;
      dom.reviewPanel.hidden = true;
      return;
    }
    dom.reviewToggle.hidden = false;
    dom.reviewPanel.hidden = false;
    dom.reviewPanel.dataset.open = String(state.reviewOpen);
    dom.reviewToggle.setAttribute("aria-expanded", String(state.reviewOpen));
    dom.reviewStateOutput.textContent = `view=${state.view} · count=${state.count} · layout=${state.layout} · reader=${state.readerState}/${state.readerPanelOpen ? state.readerPanel : "closed"} · search=${state.searchOpen ? `${state.searchScope}/${state.indexState}` : "closed"} · source=${selectedBook().status}`;

    $$('[data-count]').forEach((button) => markReviewButton(button, Number(button.dataset.count) === state.count));
    $$('[data-layout]').forEach((button) => markReviewButton(button, button.dataset.layout === state.layout));
    $$('[data-reader-state]').forEach((button) => markReviewButton(button, button.dataset.readerState === state.readerState));
    $$('[data-theme]').forEach((button) => markReviewButton(button, button.dataset.theme === state.theme));
    $$('[data-index-state]').forEach((button) => markReviewButton(button, button.dataset.indexState === state.indexState));
  }

  function markReviewButton(button, selected) {
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }

  function renderAll() {
    dom.body.dataset.count = String(state.count);
    dom.body.dataset.layout = state.layout;
    renderView();
    renderBooks();
    renderReader();
    renderSearch();
    renderReview();
  }

  function setView(view) {
    if (view !== "library" && view !== "reader") {
      const labels = { series: "系列视图", notes: "全库批注" };
      showToast(`${labels[view] || view} 不在本轮 Phase 2 页面范围；搜索入口可评审系列状态。`);
      return;
    }
    state.view = view;
    if (view === "reader") {
      state.readerState = state.readerState || "quiet";
      state.detailOpen = false;
    }
    renderView();
    renderReader();
    renderReview();
    syncUrl();
    announce(view === "reader" ? "已进入阅读器" : "已返回我的藏书");
  }

  function setCount(count) {
    if (!allowedCounts.includes(count)) return;
    state.count = count;
    dom.body.dataset.count = String(count);
    renderBooks({ preserveFocus: true });
    renderReview();
    syncUrl();
    announce(`当前评审规模 ${count} 本`);
  }

  function setLayout(layout) {
    state.layout = layout === "compact" ? "compact" : "grid";
    dom.body.dataset.layout = state.layout;
    renderBooks({ preserveFocus: true });
    renderReview();
    syncUrl();
    announce(state.layout === "compact" ? "已切换紧凑清单" : "已切换封面网格");
  }

  function selectBook(bookId, { openDetail = true } = {}) {
    if (!books.some((book) => book.id === bookId)) return;
    state.selectedBookId = bookId;
    state.detailOpen = openDetail;
    $$('.book-item').forEach((button) => {
      const selected = button.dataset.bookId === bookId;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    renderDetail();
    renderReview();
    syncUrl();
  }

  function setReaderState(readerState, { keepPanel = true } = {}) {
    state.readerState = readerState === "controls" ? "controls" : "quiet";
    if (state.readerState === "quiet") state.readerPanelOpen = false;
    if (state.readerState === "controls" && !keepPanel) state.readerPanelOpen = false;
    renderReader();
    renderReview();
    syncUrl();
    announce(state.readerState === "quiet" ? "阅读器安静态" : "阅读器控件已显示");
  }

  function openReader(panel = null) {
    state.view = "reader";
    if (panel) {
      state.readerState = "controls";
      state.readerPanel = panel;
      state.readerPanelOpen = true;
    }
    renderView();
    renderReader();
    renderReview();
    syncUrl();
    dom.readerCanvas.focus({ preventScroll: true });
    announce("已打开阅读器；按 C 显示或隐藏控件");
  }

  function openReaderPanel(panel) {
    state.readerState = "controls";
    state.readerPanel = panel;
    state.readerPanelOpen = true;
    renderReader();
    renderReview();
    syncUrl();
    $(`[data-panel-content="${panel}"] .icon-button`)?.focus();
  }

  function closeReaderPanel() {
    state.readerPanelOpen = false;
    renderReader();
    renderReview();
    syncUrl();
    dom.readerCanvas.focus({ preventScroll: true });
  }

  function setTheme(theme) {
    if (!["light", "paper", "dark"].includes(theme)) return;
    state.theme = theme;
    renderReader();
    renderReview();
    syncUrl();
    announce(`主题：${theme}`);
  }

  function changeFontSize(delta) {
    state.fontSize = Math.max(14, Math.min(28, state.fontSize + delta));
    renderReader();
    renderReview();
    announce(`正文字号 ${state.fontSize} 像素`);
  }

  function openSearch(scope = "library") {
    state.lastFocus = document.activeElement;
    state.searchOpen = true;
    state.searchScope = ["library", "series", "content"].includes(scope) ? scope : "library";
    state.activeSearchIndex = 0;
    renderSearch();
    renderReview();
    syncUrl();
    window.setTimeout(() => {
      dom.searchInput.focus();
      dom.searchInput.select();
    }, 0);
  }

  function closeSearch() {
    state.searchOpen = false;
    dom.searchOverlay.hidden = true;
    renderReview();
    syncUrl();
    const target = state.lastFocus;
    state.lastFocus = null;
    if (target && document.contains(target)) target.focus();
  }

  function setSearchScope(scope) {
    state.searchScope = scope;
    state.activeSearchIndex = 0;
    renderSearch();
    renderReview();
    syncUrl();
    dom.searchInput.focus();
  }

  function setIndexState(indexState) {
    if (!allowedIndexStates.includes(indexState)) return;
    state.indexState = indexState;
    state.searchScope = "content";
    state.searchOpen = true;
    state.activeSearchIndex = 0;
    renderSearch();
    renderReview();
    syncUrl();
    window.setTimeout(() => dom.searchInput.focus(), 0);
  }

  function activateSearchResult(button) {
    const id = button.dataset.searchResult;
    if (button.dataset.resultKind === "content") {
      state.searchOpen = false;
      selectBook(id, { openDetail: false });
      openReader();
      showToast("静态跳转：章节定位标识将在生产实现中由真实搜索结果提供。");
      return;
    }
    state.searchOpen = false;
    dom.searchOverlay.hidden = true;
    selectBook(id, { openDetail: true });
    setView("library");
    $(`[data-book-id="${id}"]`)?.focus({ preventScroll: true });
  }

  function updateSearchActive(delta) {
    const results = $$('.search-result', dom.searchResults);
    if (!results.length) return;
    state.activeSearchIndex = (state.activeSearchIndex + delta + results.length) % results.length;
    results.forEach((button, index) => {
      const active = index === state.activeSearchIndex;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
    results[state.activeSearchIndex].scrollIntoView({ block: "nearest" });
  }

  function openRelink() {
    const book = selectedBook();
    if (book.status !== "missing") {
      showToast("当前图书来源可用；无需重新关联。");
      return;
    }
    state.lastFocus = document.activeElement;
    state.relinkOpen = true;
    dom.relinkTitle.textContent = `重新关联《${book.title}》`;
    resetRelinkDemo();
    dom.relinkOverlay.hidden = false;
    window.setTimeout(() => dom.beginRelink.focus(), 0);
  }

  function resetRelinkDemo() {
    dom.relinkState.className = "relink-state";
    dom.relinkState.innerHTML = '<span class="state-symbol" aria-hidden="true">!</span><div><h3>文件已移动</h3><p>选择原来的 EPUB。EpubStart 会比较可靠的文件信息；验证成功后保留原有进度与批注。</p></div>';
    dom.relinkDemoControls.hidden = true;
    dom.beginRelink.disabled = false;
    dom.beginRelink.textContent = "重新选择 EPUB";
    $$('.relink-steps li').forEach((item, index) => item.classList.toggle("is-current", index === 0));
  }

  function beginRelinkDemo() {
    dom.relinkDemoControls.hidden = false;
    dom.beginRelink.disabled = true;
    dom.beginRelink.textContent = "文件选择器仅由生产层接入";
    dom.relinkState.innerHTML = '<span class="state-symbol" aria-hidden="true">…</span><div><h3>等待静态评审结果</h3><p>本原型不会打开原生文件选择器。请使用下方按钮模拟验证结果。</p></div>';
    $$('.relink-steps li').forEach((item, index) => item.classList.toggle("is-current", index <= 1));
    $("#simulateMatch").focus();
  }

  function simulateRelink(matched) {
    if (matched) {
      dom.relinkState.className = "relink-state is-success";
      dom.relinkState.innerHTML = '<span class="state-symbol" aria-hidden="true">✓</span><div><h3>已确认是原文件</h3><p>静态演示：来源恢复，阅读进度与批注保持原位。未写入任何数据。</p></div>';
      $$('.relink-steps li').forEach((item) => item.classList.add("is-current"));
      const book = selectedBook();
      book.status = "available";
      renderBooks();
      showToast("仅模拟成功状态；未调用后端，也未选择真实文件。");
    } else {
      dom.relinkState.className = "relink-state is-mismatch";
      dom.relinkState.innerHTML = '<span class="state-symbol" aria-hidden="true">×</span><div><h3>这不是原来的文件</h3><p>保留当前记录，不覆盖进度或批注。可以返回并重新选择。</p></div>';
      $$('.relink-steps li').forEach((item, index) => item.classList.toggle("is-current", index <= 1));
      showToast("保守失败：原记录保持不变。");
    }
  }

  function closeRelink() {
    state.relinkOpen = false;
    dom.relinkOverlay.hidden = true;
    const target = state.lastFocus;
    state.lastFocus = null;
    if (target && document.contains(target)) target.focus();
  }

  function toggleReview(open = !state.reviewOpen) {
    state.reviewOpen = open;
    renderReview();
    syncUrl();
  }

  function focusBookByKey(event, current) {
    const buttons = $$('.book-item');
    const index = buttons.indexOf(current);
    if (index < 0) return;
    const firstTop = buttons[0]?.offsetTop;
    const columns = state.layout === "compact"
      ? (window.innerWidth <= 880 ? 1 : 2)
      : Math.max(1, buttons.filter((button) => button.offsetTop === firstTop).length);
    const deltas = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
      Home: -index,
      End: buttons.length - 1 - index,
    };
    if (!(event.key in deltas)) return;
    event.preventDefault();
    const nextIndex = Math.max(0, Math.min(buttons.length - 1, index + deltas[event.key]));
    buttons[nextIndex].focus();
    buttons[nextIndex].scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function isTypingTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
  }

  function trapFocus(event, overlay) {
    if (event.key !== "Tab") return;
    const focusable = $$('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])', overlay)
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;

    if (target.dataset.nav) {
      event.preventDefault();
      setView(target.dataset.nav);
      return;
    }
    if (target.hasAttribute("data-open-reader")) {
      openReader();
      return;
    }
    if (target.hasAttribute("data-open-search")) {
      openSearch(target.dataset.openSearch || (state.view === "reader" ? "content" : "library"));
      return;
    }
    if (target.dataset.count) {
      setCount(Number(target.dataset.count));
      return;
    }
    if (target.dataset.layout) {
      setLayout(target.dataset.layout);
      return;
    }
    if (target.dataset.bookId) {
      selectBook(target.dataset.bookId, { openDetail: true });
      return;
    }
    if (target.dataset.readerPanel) {
      openReaderPanel(target.dataset.readerPanel);
      return;
    }
    if (target.hasAttribute("data-close-reader-panel")) {
      closeReaderPanel();
      return;
    }
    if (target.dataset.readerState) {
      setReaderState(target.dataset.readerState);
      return;
    }
    if (target.dataset.theme) {
      setTheme(target.dataset.theme);
      return;
    }
    if (target.dataset.fontStep) {
      changeFontSize(Number(target.dataset.fontStep));
      return;
    }
    if (target.dataset.searchScope) {
      setSearchScope(target.dataset.searchScope);
      return;
    }
    if (target.dataset.searchResult) {
      activateSearchResult(target);
      return;
    }
    if (target.dataset.indexState) {
      setIndexState(target.dataset.indexState);
      return;
    }
    if (target.dataset.indexAction) {
      const transitions = { cancel: "cancelled", continue: "building", build: "building", retry: "building" };
      setIndexState(transitions[target.dataset.indexAction]);
      return;
    }
    if (target.hasAttribute("data-demo-missing")) {
      selectBook("book-0008", { openDetail: true });
      openRelink();
      return;
    }
    if (target.hasAttribute("data-close-relink")) {
      closeRelink();
      return;
    }
    if (target.dataset.toast) {
      showToast(target.dataset.toast);
    }
  });

  dom.searchInput.addEventListener("input", () => {
    state.activeSearchIndex = 0;
    renderSearch();
  });
  $("#searchClose").addEventListener("click", closeSearch);
  $("#relinkClose").addEventListener("click", closeRelink);
  dom.beginRelink.addEventListener("click", beginRelinkDemo);
  $("#simulateMatch").addEventListener("click", () => simulateRelink(true));
  $("#simulateMismatch").addEventListener("click", () => simulateRelink(false));
  $("#detailClose").addEventListener("click", () => {
    state.detailOpen = false;
    renderDetail();
    renderReview();
    syncUrl();
  });
  dom.openSelected.addEventListener("click", () => openReader());
  dom.relinkSelected.addEventListener("click", openRelink);
  dom.reviewToggle.addEventListener("click", () => toggleReview());
  $("#reviewClose").addEventListener("click", () => toggleReview(false));
  $("#dependencyInfoButton").addEventListener("click", (event) => {
    const info = $("#dependencyInfo");
    info.hidden = !info.hidden;
    event.currentTarget.setAttribute("aria-expanded", String(!info.hidden));
  });

  dom.readerCanvas.addEventListener("click", (event) => {
    if (event.target.closest("button, .reader-panel, a, input")) return;
    setReaderState(state.readerState === "quiet" ? "controls" : "quiet", { keepPanel: false });
  });

  dom.bookCollection.addEventListener("keydown", (event) => {
    const button = event.target.closest(".book-item");
    if (button) focusBookByKey(event, button);
  });

  document.addEventListener("keydown", (event) => {
    if (state.searchOpen) {
      trapFocus(event, dom.searchOverlay);
      if (event.key === "Escape") {
        event.preventDefault();
        closeSearch();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        updateSearchActive(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        updateSearchActive(-1);
      } else if (event.key === "Enter" && document.activeElement === dom.searchInput) {
        const active = $$('.search-result', dom.searchResults)[state.activeSearchIndex];
        if (active) {
          event.preventDefault();
          activateSearchResult(active);
        }
      }
      return;
    }

    if (state.relinkOpen) {
      trapFocus(event, dom.relinkOverlay);
      if (event.key === "Escape") {
        event.preventDefault();
        closeRelink();
      }
      return;
    }

    const typing = isTypingTarget(event.target);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch(state.view === "reader" ? "content" : "library");
      return;
    }
    if (!typing && event.key === "/") {
      event.preventDefault();
      openSearch(state.view === "reader" ? "content" : "library");
      return;
    }
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;

    const key = event.key.toLowerCase();
    if (key === "l") {
      event.preventDefault();
      setView("library");
    } else if (key === "r") {
      event.preventDefault();
      openReader();
    } else if (key === "c" && state.view === "reader") {
      event.preventDefault();
      setReaderState(state.readerState === "quiet" ? "controls" : "quiet", { keepPanel: false });
    } else if (key === "t" && state.view === "reader") {
      event.preventDefault();
      openReaderPanel("toc");
    } else if (key === "a" && state.view === "reader") {
      event.preventDefault();
      openReaderPanel("settings");
    } else if (event.key === "Escape" && state.view === "reader") {
      if (state.readerPanelOpen) closeReaderPanel();
      else setReaderState("quiet");
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth <= 760 && !params.has("detail") && state.view === "library") {
      state.detailOpen = false;
      renderDetail();
    }
  });

  renderAll();
  if (state.searchOpen) {
    window.setTimeout(() => {
      dom.searchInput.focus();
      dom.searchInput.select();
    }, 0);
  }
})();
