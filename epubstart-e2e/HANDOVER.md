# 交接与存档：阅读器自动化验证 + 锚点修复（截至 2026-10-12）

本文件记录本轮工作的状态、改动、证据和未决项。读者应能在不看对话记录的情况下复现结果并接手。

## 1. 结论速览

- 自动化套件（`epubstart-e2e/`）已接入项目，三个目标全部可运行：`harness`（纯 EPUB.js 基线）、`app`（EpubStart 本体，浏览器内 + 模拟 IPC）、`mock`（框架自检）。
- 重排锚定的 5 个失败已全部定位并修复（列窗口 + 分页恢复后的页校正），app 目标 **24/24 通过**。
- EPUB.js 升级（0.3.93 → 0.4.x）**本轮不做**，已完成影响面调研与试验，结论见第 5 节，留待专门阶段。
- 中文字体（Noto Sans SC 子集）已放入 `fixtures/fonts/`，并已完成 `publisher` 字体固定、合成书重建、`E2EFont` 加载状态断言及 `harness`/`app` 快照基线更新（见第 6 节）。
- 单测补法选方案 A，已实现并证明能发现缺陷（修复前失败、修复后通过）。

## 2. 改动清单（相对 HEAD，未提交）

| 路径 | 状态 | 用途 |
|---|---|---|
| `CONVENTIONS.md` | 修改 | 依赖白名单新增一行：`@playwright/test`、`jszip`、`@types/node`（仅开发期，经用户批准） |
| `src/features/reader/engine/reflow.ts` | 修改 | (a) 分页模式锚点可见窗口改为 `.epub-container` 列窗口（`readingWindowRect`）；(b) 文本锚点恢复后，若锚点页与当前滚动位置不一致则再定位一次（`correctAnchorPageAfterLayout`）；(c) `RenditionLayoutHost.manager.layout` 类型补 `delta`；(d) `settleInitialPagination` 注释修正 |
| `src/features/reader/e2eHook.ts` | 新增 | 仅 DEV 且 `?e2e=1` 挂出的测试钩子：`rendition`、`readingSettings()`、`applySettings()`（经 `applyReadingSettings`，走 reflow 路径） |
| `src/main.tsx` | 修改 | 副作用引入 `./features/reader/e2eHook` |
| `scripts/frontend-tests/reflow-anchor.test.cjs` | 修改 | 替身补齐列窗口（`querySelector`/`settings`/`DOMRect` 垫片/scroller 方法）；新增 2 条用例：灰边不作为锚点、设置变化后页校正（方案 A） |
| `epubstart-e2e/` | 新增（整个目录） | 自动化套件：走书器、不变量、矩阵、Playwright 配置、app 适配层（`e2e/app/tauri-mock.ts`、`e2e/app/book-entries.mjs`）、fixtures、快照 |
| `epubstart-e2e/fixtures/fonts/NotoSansSC-chinese-simplified-400.woff2` | 新增 | Noto Sans SC 简体中文子集，400 字重，1,142,552 字节，sha256 前缀 `95e3633b6a98f764` |
| `epubstart-e2e/fixtures/fonts/LICENSE-NotoSansSC-OFL.txt` | 新增 | 字体许可证（SIL OFL 1.1，来源：`@fontsource/noto-sans-sc@5.3.1` 包内 LICENSE） |
| `epubstart-e2e/HANDOVER.md` | 新增 | 本文件 |

未改动：`src/stores/readerStore.ts`（钩子已移出）、根 `package.json`、根 `tsconfig.json`、根 `.gitignore`。

**未提交**：所有改动均在工作区，由用户决定提交方式。不要把 `target/`、`dist/`、`epubstart-e2e/node_modules/`、`epubstart-e2e/test-results/`、`epubstart-e2e/playwright-report/` 纳入提交（已被 .gitignore 覆盖）。

## 3. 验证证据（按时间顺序，最近的在最后）

| 检查 | 结果 | 备注 |
|---|---|---|
| app 目标全量（`node scripts/e2e.mjs app`） | **24 通过，0 失败** | 最后一次全量运行是修复后的版本；之后只改了 `settleInitialPagination` 注释（无行为变化） |
| `npm run test:frontend -- --reader` | **82 用例通过，退出码 0** | 含新增的方案 A 用例 |
| `reflow-anchor.test.cjs` 修复前回放（`git show HEAD:…reflow.ts` → `FRONTEND_TEST_REFLOW_SOURCE`） | 新用例 #5 失败、灰边用例 #4 失败 | 证明两条新用例都能发现缺陷 |
| 同一文件，当前代码 | 13/13 通过 | |
| 项目 `npx tsc --noEmit` | 通过 | |
| 架构静态检查（`npm run test:static -- --root ../src`，在 epubstart-e2e 目录） | 40 个文件，0 错误，0 警告 | 最后一次运行在收尾阶段（钩子移动之后） |
| harness 默认 | 8 通过、16 跳过 | 基线未受本轮 src 改动影响（不走 reflow.ts） |
| `npm test`（suite 内的类型检查、静态自检、16 条单测、selftest） | 通过 | 在项目位置跑过 |

## 4. 关键发现（写给接手者的因果链）

1. **重排锚定失败的根因有两层**
   - 层 1（已修）：`captureFirstVisibleLine` 用整个视口做可见判断，把两侧灰边的文字当成锚点，导致恢复到相邻页。修复：分页模式下可见窗口改为 `.epub-container` 的列窗口。
   - 层 2（已修）：EPUB.js 的 `moveTo`（`managers/default/index.js:340-350`）按 `display` 时的 `scrollWidth` 钳制目标页。字号等设置变化后内容宽度要过两帧才扩展，首次 display 用的是旧宽度，于是被钳回前一页。修复：布局稳定后若锚点页与 `scrollLeft` 不一致，再 display 一次（只在分页模式、文本锚点路径生效）。
2. **排除的假设**（不要重复排查）：CFI→页号的映射公式本身是对的（`locationOf` 在新布局下返回 2265.6，页号 3 正确）；`layout.props` 是活引用，mapping 不陈旧；单纯等待更长时间（2 帧、300ms）无效，问题是 display 时刻 scrollWidth 还是旧值，而不是等得不够。
3. **EPUB.js 0.4.2 的源码核对**（自行读取 tarball，非摘要）：`managers/default/index.js:312-315` 的钳制逻辑仍在；`this.q`（队列）仍在（`:17`）；但 `requestMethod`、`Book.destroy`、`contents.locationOf` 按 0.3.93 的写法搜不到，说明这些接口已重构或搬家，需要专门核对。

## 5. epubjs 升级：调研与试验结论（本轮不做）

- **影响面调研**（只读 workflow，三视角，结果文件：`C:\Users\OigwenTs\AppData\Local\Temp\claude\d--epub-start\e659a34b-47db-48cf-8a7d-8e47e37af6b6\tasks\wm8rml5yd.output`）。高风险项：
  - `lifecycle.ts` 读写 EPUB.js 私有字段：`rendition.q`、`manager.q/rendered/stage`、`starting`、`displaying`、`book.opened`、`book.loadNavigation`，并覆盖 `manager = undefined`。
  - `lifecycle.ts` 的 `Book.open` 包装与 `Book.destroy` 销毁 rendition 的归属假设。
  - `lifecycle.ts` 的 `ePub({ requestMethod })`：依赖 EPUB.js 内部 URL 形式（`null/`、`epub://`）与类型标记（binary/blob/xhtml…）。
  - `pagination.ts` 替换 `manager.next`，读取多个内部属性。
  - `navigation.ts` 的 `visibleChapterPage` 依赖 `pageWidth`、`divisor`、`visible()`、`position()`。
  - `reflow.ts` 的 `hooks.content` 与 `themes`（列间距依赖它）。
  - `renderTo` 选项与默认值；`spread`/`resize`/`settings.flow` 字段；`relocated`/`rendered`/`removed`/`selected`/`started` 事件的参数形状。
- **试验**（隔离副本 `/tmp/tmp.cjOm0phTJ4/epub-upgrade-try`，项目本身未动）：安装 epubjs 0.4.2 后，`tsc` 通过（0 个 TS 错误）；reader 套件出现 4 条真实失败：`pagination.test.cjs`（直接读取 `node_modules/epubjs/lib/...`，0.4.2 目录结构变化）、以及 3 条依赖真实 EPUB.js 生命周期的用例（managed open、queued startup 取消、manager 启动与挂载之间的 retire）。另有 `libraryStore` 一条是手动运行的假象（需要库存编译产物），运行器的 `--reader` 不包含它。**app 目标在 0.4.2 下未运行。**
- **运行时影响**：`xmldom` 在 0.3.93 时经 `@xmldom/xmldom` 别名到 `browserXml.ts`，产物中未出现 xmldom 字符串（已验证）。0.4.2 依赖的是 `xmldom ^0.1.27`，别名是否仍生效未确认，需要在升级时重新构建核对。
- **npm audit**：epubjs 0.3.93 有 moderate 漏洞；`@xmldom/xmldom 0.7.13` 有 high 漏洞但未进入浏览器产物。可达性未评估。
- **npm 渠道**：`epubjs` 的 `latest` 标签仍是 0.3.93，0.4.2 不是默认渠道。
- **结论**：升级需要专门阶段，改动点集中在 `lifecycle.ts`、`pagination.ts`、`navigation.ts`、`reflow.ts`，并需要重新跑 app 与 harness 两套 e2e。

## 6. 字体：已完成接入与快照基线重建（2026-10-14 更新）

- 字体与许可证已就位（见第 2 节）。
- **已解决的三个关键细节**：
  1. `scripts/make-fixtures.mjs` 将样式选择器从 `body` 改为 `html, body { font-family: "E2EFont", serif; }`，使 `reflow.ts` 在 `publisher` 模式下向 `body` 注入 `font-family: inherit !important` 时，能从 `html` 正确继承 `"E2EFont"` 而不会回退到浏览器默认字体。
  2. `e2e/app/tauri-mock.ts` 将默认 `font_family` 固定为 `"publisher"`；`e2e/app/book-entries.mjs` 补齐 `.woff2`/`.woff`/`.ttf`/`.otf` 的 MIME 类型。
  3. `e2e/in-page/walker.js` 在 `settle()` 中显式执行 `doc.fonts.load('16px "E2EFont"')`，并在 `reader.spec.ts` 中断言 iframe 内 `bodyFontFamily` 含 `E2EFont` 且 `FontFace.status === "loaded"`。
- **Fixtures 与快照基线**：已运行 `npm run fixtures` 将 `NotoSansSC-chinese-simplified-400.woff2` 写入 4 本合成 `.epub`（记录于 `fixtures/manifest.json`），并重新生成、二次复跑确认 `harness`（8/8）与 `app`（24/24）快照基线完全稳定。

## 7. 单测（方案 A）

- 新增用例 `a settings reflow restores the anchor page after the stale scroll width grows`，通过公开入口 `preserveAndReflow` 测试，替身模拟 EPUB.js 的钳制与 scrollWidth 滞后。
- 证据见第 3 节（修复前失败、修复后通过）。
- 灰边用例同样在修复前失败、修复后通过。

## 8. 未决项与风险清单

1. **epubjs 升级**：本轮不做，见第 5 节。下一阶段需要决定：是否升级，以及升级到哪个版本（0.4.x 不是 latest 渠道）。
2. **字体接入与快照重建**：见第 6 节。
3. **rtl 与 ignoreClass**：校正公式没有 rtl 分支，也没有传 `ignoreClass`。当前应用不设置这两项，属于潜在问题，不可达。
4. **校正的边界**：若 `.epub-container` 的 clientWidth 与 `layout.delta` 不相等，校正可能每次都触发一次多余的 display（未测量）。
5. **waitForViewportLayout 无超时**：沿用既有模式，但校正路径在串行队列里又加了一处无超时等待（复核意见，未改）。
6. **替身与真实 EPUB.js 的差距**：reader 单测用替身，不能替代 app e2e；app e2e 是这次缺陷的唯一真实检测器（以及方案 A 的替身检测）。
7. **dist/**：本轮 `npx vite build` 覆盖了 `dist/`（已被 .gitignore 忽略）。如需保留之前的构建产物，需要重新构建。
8. **未提交**：见第 2 节。
9. **交接时需要复核的环境假设**：Chromium 由 `npx playwright install chromium` 下载（来源 npmmirror CDN）；`epubstart-e2e/test-results/` 为运行产物。

## 9. 复现命令（均在对应目录执行）

```powershell
# 项目根：reader 前端套件（含新增用例）
cd D:\epub_start
npm run test:frontend -- --reader

# 项目根：类型检查与架构静态检查
npx tsc --noEmit
cd epubstart-e2e
npm run test:static -- --root ../src

# 套件：基线与 app 目标
npm test
node scripts/e2e.mjs harness
node scripts/e2e.mjs app                 # 需要 Vite 开发服务器，由 playwright.config.ts 的 webServer 启动
node scripts/e2e.mjs app --anchor-baseline
```

修复前回放（用于证明回归用例能发现缺陷）：

```powershell
$pre = New-TemporaryFile
git show HEAD:src/features/reader/engine/reflow.ts > $pre
$env:FRONTEND_TEST_BUILD_DIR = "$PWD\target\frontend-tests"
$env:FRONTEND_TEST_REFLOW_SOURCE = $pre
node --test --test-reporter=tap scripts/frontend-tests/reflow-anchor.test.cjs
```

## 10. 本轮决策日志（便于追溯）

- 依赖白名单：经用户批准新增三个开发期依赖（CONVENTIONS.md）。
- 测试钩子位置：从 `readerStore.ts` 移到 `e2eHook.ts`，因为 `import.meta` 会破坏 `test:frontend` 的编译范围。
- 锚点列窗口修复、分页页校正修复：均经用户批准。
- 字体：选 Noto Sans SC（简体中文子集，OFL）作为默认基线；Noto Serif CJK SC 与 LXGW WenKai 留给后续阶段。
- epubjs 升级：经用户批准"先不做，准备交接"。
- 单测：选方案 A。
- 子代理模型：调研子代理使用 `haiku`（Agent 工具没有 DeepSeek 选项，用户已知悉）。
- 调研的完整输出保存在会话临时目录的 `tasks` 下（见第 5 节路径），不属于仓库。
