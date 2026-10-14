// 注入到被测页面里的“走书器”。用纯 JS 写、不经过 TS 转译，避免 page.evaluate 序列化时被编译产物破坏。
// 通过 page.addInitScript({ path }) 注入，页面里只多一个 window.__e2eWalker。
//
// 对被测页面的唯一要求（“钩子”）：
//   window.__EPUBSTART_E2E__ = { rendition }   // EPUB.js 的 Rendition 实例，仅在 ?e2e=1 时挂出
//
// 本脚本依赖的 EPUB.js 0.3.x 内部结构（升级 EPUB.js 时先看这里）：
//   rendition.manager.container      负责横向滚动的容器（.epub-container）
//   rendition.manager.layout.delta   一次翻页的滚动步长
//   rendition.getContents()[0]       当前章节的 Contents（带 .document / .window）
//   rendition.currentLocation()      { start:{index,href,cfi}, atEnd }
//   rendition.next()/prev()/display()/once()/off()

(function () {
  "use strict";

  var EPS = 1; // 像素容差
  var CACHE = new WeakMap(); // Document -> { key, data }

  function getRendition() {
    var h = window.__EPUBSTART_E2E__;
    if (!h || !h.rendition) {
      throw new Error("window.__EPUBSTART_E2E__.rendition 不存在：被测页面还没挂出测试钩子（见 README）");
    }
    return h.rendition;
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function raf2() {
    return new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
  }

  // 等字体和图片就绪、再等两帧，让分栏布局稳定下来
  async function settle(contents) {
    var doc = contents.document;
    try {
      if (doc.fonts) {
        if (doc.fonts.load) await doc.fonts.load('16px "E2EFont"');
        if (doc.fonts.ready) await doc.fonts.ready;
      }
    } catch (e) {
      /* 忽略 */
    }
    var pending = Array.prototype.filter.call(doc.images, function (img) {
      return !img.complete;
    });
    await Promise.all(
      pending.map(function (img) {
        return new Promise(function (r) {
          img.addEventListener("load", r, { once: true });
          img.addEventListener("error", r, { once: true });
        });
      }),
    );
    await raf2();
  }

  // 收集当前章节每个“可见非空白字符”的左右边界（iframe 内坐标）。
  // 结果按 (文档, 布局指纹) 缓存；设置变化后指纹变化，缓存自动失效。
  function collect(contents) {
    var doc = contents.document;
    var win = contents.window;
    var key = [
      doc.documentElement.scrollWidth,
      doc.documentElement.clientWidth,
      doc.documentElement.clientHeight,
      win.getComputedStyle(doc.body).fontSize,
    ].join("|");
    var hit = CACHE.get(doc);
    if (hit && hit.key === key) return hit.data;

    var chars = [];
    var xl = [];
    var xr = [];
    var tw = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    var range = doc.createRange();
    var node;
    while ((node = tw.nextNode())) {
      var parent = node.parentElement;
      if (!parent) continue;
      var tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TITLE") continue;
      var cs = win.getComputedStyle(parent);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      var s = node.nodeValue || "";
      for (var k = 0; k < s.length; k++) {
        var ch = s.charAt(k);
        if (/\s/.test(ch)) continue;
        range.setStart(node, k);
        range.setEnd(node, k + 1);
        var rects = range.getClientRects();
        if (!rects.length) continue;
        var b = rects[0];
        if (b.width === 0 && b.height === 0) continue;
        chars.push(ch);
        xl.push(b.left);
        xr.push(b.right);
      }
    }

    var viewH = doc.documentElement.clientHeight;
    var viewW = doc.documentElement.clientWidth;
    var images = Array.prototype.map.call(doc.querySelectorAll("img, svg"), function (el) {
      var r = el.getBoundingClientRect();
      var src = (el.getAttribute && (el.getAttribute("src") || el.getAttribute("href"))) || el.tagName.toLowerCase();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, src: src };
    });
    var overflows = images
      .filter(function (im) {
        return im.right - im.left > viewW + EPS || im.bottom - im.top > viewH + EPS;
      })
      .map(function (im) {
        return im.src;
      });

    var data = { n: chars.length, chars: chars, xl: xl, xr: xr, images: images, overflows: overflows };
    CACHE.set(doc, { key: key, data: data });
    return data;
  }

  async function readPage(rendition, contents) {
    var mgr = rendition.manager;
    var container = mgr.container;
    var loc = await rendition.currentLocation();
    var data = collect(contents);

    var frame = contents.window.frameElement;
    var fr = frame.getBoundingClientRect();
    var cr = container.getBoundingClientRect();
    var vw = container.clientWidth;
    var winL = cr.left + container.clientLeft;
    var winR = winL + vw;
    var off = fr.left + frame.clientLeft;

    var start = -1;
    var end = -1;
    var vis = 0;
    var cut = 0;
    for (var i = 0; i < data.n; i++) {
      var L = off + data.xl[i];
      var R = off + data.xr[i];
      if (L >= winL - EPS && L < winR - EPS) {
        if (start < 0) start = i;
        end = i + 1;
        vis++;
      }
      if ((L < winR && R > winR + EPS) || (L < winL - EPS && R > winL + EPS)) cut++;
    }
    var holes = start < 0 ? 0 : end - start - vis;

    var straddle = 0;
    var visImages = 0;
    for (var j = 0; j < data.images.length; j++) {
      var im = data.images[j];
      var iL = off + im.left;
      var iR = off + im.right;
      if ((iL < winR - EPS && iR > winR + EPS) || (iL < winL - EPS && iR > winL + EPS)) straddle++;
      if (iR > winL + EPS && iL < winR - EPS) visImages++;
    }

    var sl = container.scrollLeft;
    var sw = container.scrollWidth;
    var step = (mgr.layout && (mgr.layout.delta || mgr.layout.pageWidth)) || vw;
    var s0 = loc && loc.start ? loc.start : {};

    return {
      chapterIndex: s0.index,
      href: s0.href || "",
      cfi: s0.cfi || "",
      scrollLeft: sl,
      scrollWidth: sw,
      viewWidth: vw,
      step: step,
      atMaxScroll: sl + vw >= sw - EPS,
      textStart: start,
      textEnd: end,
      first: start < 0 ? "" : data.chars.slice(start, Math.min(start + 6, end)).join(""),
      last: start < 0 ? "" : data.chars.slice(Math.max(start, end - 6), end).join(""),
      cutChars: cut,
      holes: holes,
      straddlingImages: straddle,
      visibleImages: visImages,
      _chapter: { index: s0.index, href: s0.href || "", textLength: data.n, imageOverflows: data.overflows },
    };
  }

  function sig(p) {
    return p.chapterIndex + ":" + p.textStart + ":" + p.textEnd;
  }

  // 翻一页并等 relocated；超时则认为没有移动
  async function go(rendition, dir, timeoutMs) {
    var fired = false;
    var handler = function () {
      fired = true;
    };
    rendition.once("relocated", handler);
    if (dir > 0) await rendition.next();
    else await rendition.prev();
    var t0 = Date.now();
    while (!fired && Date.now() - t0 < timeoutMs) await sleep(25);
    if (!fired) rendition.off("relocated", handler);
    var contents = rendition.getContents()[0];
    if (contents) await settle(contents);
    return fired;
  }

  function isLive(c) {
    var f = c && c.window && c.window.frameElement;
    return !!(f && f.isConnected);
  }

  // 窗口缩放后 EPUB.js 会先清空视图、再异步重排：此时 getContents() 可能为空，
  // 也可能拿到已经从 DOM 移除的旧 Contents（frameElement 为 null）。
  // 这里等到拿到挂在 DOM 上的当前章节，并且两帧之后仍然有效，超时则报错而不是静默跳过。
  async function waitLive(rendition, timeoutMs) {
    var t0 = Date.now();
    while (Date.now() - t0 < (timeoutMs || 3000)) {
      if (isLive(rendition.getContents()[0])) {
        await raf2();
        if (isLive(rendition.getContents()[0])) return rendition.getContents()[0];
      }
      await sleep(25);
    }
    throw new Error("3 秒内没有挂在 DOM 上的当前章节（重排未完成或视图已丢失）");
  }

  // 内部版本保留 _chapter（章节元数据），供 walk 汇总
  async function readCurrentRaw() {
    var rendition = getRendition();
    var contents = await waitLive(rendition);
    await settle(contents);
    return readPage(rendition, contents);
  }

  async function readCurrent() {
    var p = await readCurrentRaw();
    delete p._chapter;
    return p;
  }

  async function walk(opts) {
    opts = opts || {};
    var maxPages = opts.maxPages || 5000;
    var every = opts.roundTripEvery === undefined ? 5 : opts.roundTripEvery;
    var timeoutMs = opts.relocateTimeoutMs || 1500;
    var rendition = getRendition();

    if (!opts.skipInitialDisplay) await rendition.display(opts.startTarget === undefined ? 0 : opts.startTarget);

    var spineLength = 0;
    try {
      spineLength = rendition.book.spine.length;
    } catch (e) {
      spineLength = (window.__EPUBSTART_E2E__.book && window.__EPUBSTART_E2E__.book.spine.length) || 0;
    }

    var pages = [];
    var chapters = {};
    var roundTrips = [];
    var stoppedBy = "maxPages";

    var cur = await readCurrentRaw();
    for (var seq = 0; seq < maxPages; seq++) {
      cur.seq = seq;
      chapters[cur._chapter.index] = cur._chapter;
      delete cur._chapter;
      pages.push(cur);

      // next/prev 往返探测：prev 应回到上一页，再 next 应回到本页
      if (every > 0 && seq > 0 && seq % every === 0) {
        var prevPage = pages[seq - 1];
        var rt = { seq: seq, expectedPrev: sig(prevPage), afterPrev: "", expectedBack: sig(cur), afterNext: "" };
        await go(rendition, -1, timeoutMs);
        rt.afterPrev = sig(await readCurrent());
        await go(rendition, 1, timeoutMs);
        rt.afterNext = sig(await readCurrent());
        roundTrips.push(rt);
        // 往返不对称会把阅读器留在错误的位置，后面整段走书都会跟着错；先拉回本页，保证一个缺陷只报一次
        if (rt.afterNext !== rt.expectedBack) {
          await rendition.display(cur.cfi);
          await settle(rendition.getContents()[0]);
        }
      }

      // 注意：EPUB.js 在书尾调用 next() 也可能照常触发 relocated，所以不能只靠事件判断是否移动，
      // 必须比较翻页前后的位置（章节 / scrollLeft / cfi）。
      var fired = await go(rendition, 1, timeoutMs);
      var nxt = await readCurrentRaw();
      var progressed = nxt.chapterIndex !== cur.chapterIndex || nxt.scrollLeft !== cur.scrollLeft || nxt.cfi !== cur.cfi;
      if (!progressed) {
        var loc = await rendition.currentLocation();
        stoppedBy = loc && loc.atEnd ? "end" : fired ? "stuck" : "noRelocate";
        break;
      }
      cur = nxt;
    }

    return {
      pages: pages,
      chapters: Object.keys(chapters)
        .map(function (k) {
          return chapters[k];
        })
        .sort(function (a, b) {
          return a.index - b.index;
        }),
      roundTrips: roundTrips,
      spineLength: spineLength,
      stoppedBy: stoppedBy,
    };
  }

  // 走到第 n 页（用于重排锚定测试），返回当前页记录
  async function advance(n, opts) {
    opts = opts || {};
    var rendition = getRendition();
    if (!opts.skipInitialDisplay) await rendition.display(0);
    for (var i = 0; i < n; i++) {
      var moved = await go(rendition, 1, opts.relocateTimeoutMs || 1500);
      if (!moved) break;
    }
    return readCurrent();
  }

  async function readAnchor() {
    var p = await readCurrent();
    return { chapterIndex: p.chapterIndex, offset: p.textStart, href: p.href };
  }

  async function readFontStatus() {
    var rendition = getRendition();
    var contents = await waitLive(rendition);
    await settle(contents);
    var doc = contents.document;
    var win = contents.window;
    var faces = [];
    if (doc.fonts && doc.fonts.forEach) {
      doc.fonts.forEach(function (f) {
        faces.push({ family: String(f.family).replace(/^['"]|['"]$/g, ""), status: f.status });
      });
    }
    return {
      htmlFontFamily: win.getComputedStyle(doc.documentElement).fontFamily,
      bodyFontFamily: win.getComputedStyle(doc.body).fontFamily,
      faces: faces,
    };
  }

  window.__e2eWalker = {
    walk: walk,
    advance: advance,
    readCurrent: readCurrent,
    readAnchor: readAnchor,
    readFontStatus: readFontStatus,
  };
})();
