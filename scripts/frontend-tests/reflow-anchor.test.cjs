const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const { test } = require('node:test');
const root = process.env.FRONTEND_TEST_BUILD_DIR;
if (!root) throw new Error('Run through scripts/test-frontend.mjs --reader');
// Store tests deliberately stub reflow. Compile the actual engine separately;
// the optional source path is only for replaying the frozen pre-fix file.
const sourcePath = process.env.FRONTEND_TEST_REFLOW_SOURCE || path.resolve(__dirname, '../../src/features/reader/engine/reflow.ts');
const actual = new Module(sourcePath, module);
actual.require = id => {
  if (id === '../../../lib/window') return {};
  throw new Error(`Unexpected runtime import: ${id}`);
};
actual._compile(ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, sourcePath);
const { captureFirstVisibleLine } = actual.exports;
const { captureReflowAnchor, rememberReflowAnchor, preserveAndReflow } = actual.exports;

// Fixed character geometry isolates anchoring from browser layout. The original
// PC/Android scenarios still verify real CFI and WebView column behavior.
function inScene({ chars, frameX = 0, caretOffset, paddingTop = 48 }, run) {
  const saved = Object.fromEntries(['document', 'HTMLElement', 'Node', 'NodeFilter'].map(k => [k, global[k]]));
  const rect = (x, y, width = 10) => ({ x, y, left: x, right: x + width, top: y, bottom: y + 20, width, height: 20 });
  const text = { nodeType: 3, data: 'ABCD', textContent: 'ABCD', length: 4 };
  class Frame { getBoundingClientRect() { return { left: frameX, top: 0 }; } }
  const makeRange = () => ({
    startContainer: text, endContainer: text, startOffset: 0, endOffset: 0,
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; if (this.endOffset < offset) this.endOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
    selectNodeContents() { this.startOffset = 0; this.endOffset = chars.length; },
    collapse() { this.endOffset = this.startOffset; },
    getClientRects() { return this.endOffset > this.startOffset ? chars.slice(this.startOffset, this.endOffset).map(([x,y]) => rect(x,y)) : []; },
  });
  global.HTMLElement = Frame; global.Node = { TEXT_NODE: 3 };
  global.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  global.document = { getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 200 }) }) };
  const doc = {
    body: {}, createRange: makeRange,
    createTreeWalker() { let available = true; return { nextNode() { if (!available) return null; available = false; return text; } }; },
  };
  if (caretOffset !== undefined) doc.caretRangeFromPoint = () => { const r = makeRange(); r.setStart(text, caretOffset); r.collapse(); return r; };
  const content = { document: doc, window: { frameElement: new Frame(), getComputedStyle: () => ({ paddingTop: String(paddingTop) }) },
    cfiFromRange: range => `${range.startOffset}:${range.endOffset}` };
  try { run({ getContents: () => [content] }); } finally { Object.assign(global, saved); }
}

test('a reflow anchor identifies a character instead of an ambiguous collapsed line boundary', () => {
  inScene({ chars: [[10,48],[20,48],[30,48],[40,48]], caretOffset: 0 }, rendition => {
    assert.equal(captureFirstVisibleLine(rendition).cfi, '0:1');
  });
});

test('after scrolling body padding does not hide readable text near the top of the viewport', () => {
  inScene({ chars: [[10,18],[10,48],[20,48],[30,48]] }, rendition => {
    const anchor = captureFirstVisibleLine(rendition);
    assert.equal(anchor.cfi, '0:1');
    assert.equal(anchor.viewportY, 18);
  });
});

test('without caret hit testing a later column must not select an earlier column at the same height', () => {
  inScene({ chars: [[10,48],[10,78],[110,48],[110,78]], frameX: -100 }, rendition => {
    assert.equal(captureFirstVisibleLine(rendition).cfi, '2:3');
  });
});

async function inReflowSession(run) {
  const saved = { document: global.document, window: global.window };
  const scroller = new EventTarget();
  scroller.scrollLeft = 0; scroller.scrollTop = 0;
  const viewport = {
    querySelector: () => scroller,
    getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 200 }),
  };
  global.document = { getElementById: () => viewport };
  global.window = { requestAnimationFrame: callback => queueMicrotask(callback), setTimeout, clearTimeout };
  const handlers = new Map();
  let currentCfi = 'page-A';
  const relocate = (cfi) => {
    currentCfi = cfi;
    for (const handler of handlers.get('relocated') ?? []) handler({ start: { cfi } });
  };
  const scroll = (left, top) => {
    scroller.scrollLeft = left; scroller.scrollTop = top;
    scroller.dispatchEvent(new Event('scroll'));
  };
  const rendition = {
    settings: { flow: 'paginated' },
    currentLocation: () => ({ start: { cfi: currentCfi } }),
    getContents: () => [],
    on(name, handler) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(handler); },
    off(name, handler) { handlers.get(name)?.delete(handler); },
    display: async () => { scroll(100, 0); relocate('page-after-reflow'); },
  };
  try { await run({ rendition, relocate, scroll }); } finally { Object.assign(global, saved); }
}

test('a retained anchor survives unchanged scroll reports without navigation', async () => {
  await inReflowSession(async ({ rendition, scroll }) => {
    const anchor = { cfi: 'retained-character', viewportY: 48 };
    await rememberReflowAnchor(rendition, anchor);
    scroll(0, 0);
    assert.equal(await captureReflowAnchor(rendition), anchor);
  });
});

test('explicit navigation within the same page invalidates its old retained character', async () => {
  await inReflowSession(async ({ rendition, relocate }) => {
    await rememberReflowAnchor(rendition, { cfi: 'old-page-middle', viewportY: 48 });
    relocate('page-A');
    assert.equal(await captureReflowAnchor(rendition), null);
  });
});

test('navigation away and back invalidates a retained anchor even at the same final CFI', async () => {
  await inReflowSession(async ({ rendition, relocate }) => {
    await rememberReflowAnchor(rendition, { cfi: 'old-page-middle', viewportY: 48 });
    relocate('page-B'); relocate('page-A');
    // There are no rendered text nodes in this scene: fresh capture is null.
    // Returning the saved object would prove the stale cache was reused.
    assert.equal(await captureReflowAnchor(rendition), null);
  });
});

test('scrolling away and back invalidates a retained anchor without a CFI change', async () => {
  await inReflowSession(async ({ rendition, scroll }) => {
    await rememberReflowAnchor(rendition, { cfi: 'old-page-middle', viewportY: 48 });
    scroll(0, 120); scroll(0, 0);
    assert.equal(await captureReflowAnchor(rendition), null);
  });
});

test('reflow keeps its captured anchor through its own intermediate location and scroll events', async () => {
  await inReflowSession(async ({ rendition, relocate, scroll }) => {
    const anchor = { cfi: 'retained-character', viewportY: 48 };
    await rememberReflowAnchor(rendition, anchor);
    await preserveAndReflow(rendition, () => { scroll(200, 0); relocate('intermediate-layout'); }, {
      restoreTheme: false, preserveTextAnchor: true,
    });
    assert.equal(await captureReflowAnchor(rendition), anchor);
  });
});
