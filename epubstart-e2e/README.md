# EpubStart 阅读器回归套件（骨架草稿）

目标：把“加载、排版、翻页”这类 bug 的排查结果固化成能自动跑的检查，让修过的 bug 不会再回来。

做法：用一个**走书器**在真实 Chromium 里把整本书从头翻到尾，每页记录“显示了哪些字”，得到一份**轨迹**。
所有检查都是对轨迹的纯函数（不丢字、不重复、章末不被跳过、next/prev 对称、重排后位置还在……），
快照也只是轨迹的摘要。以后每修一个 bug，加一条规则就行，不用再写新的测试流程。

## 当前状态：哪些跑过，哪些没跑过

| 部分 | 状态 |
|---|---|
| 走书器 + 不变量（对着“CSS 多列 + scrollLeft”的模拟页） | 已跑通：无缺陷零误报；埋入的 4 类缺陷全部被抓到 |
| 4 本合成 fixture | 已验证：zip/XHTML 结构合法、字节级可复现、在多列布局下零违规 |
| 不变量单测（16 条）、类型检查、静态规则自检 | 全绿 |
| Playwright spec 的框架部分（矩阵、快照、配置） | 对着模拟页跑通，快照两次运行一致 |
| **真实 EPUB.js 0.3.93（harness 目标）** | **已跑通**（8 通过，16 跳过） |
| **EpubStart 本体（app 目标）** | **已接通并跑通（24/24 通过）**。开发期钩子在 `src/features/reader/e2eHook.ts`，适配层在 `e2e/adapter.ts`（浏览器内使用 `tauri-mock.ts`，不替代真实 Tauri/SQLite/SAF 验收）。注：`fixtures/fonts/` 字体尚未接入确定性快照基线，详见 `HANDOVER.md` 第 6 节 |
| `readerViewportGeometry` 的属性测试 | 留待后续补充 |

结论：检查器本身可信，但“它在真 EPUB.js 上长什么样”要等第一次真跑才知道。第一次真跑出的红灯，先判断是检查器假设不对，还是真 bug。

## 快速开始

需要 Node ≥ 22.18（能直接运行 `.ts`）。命令都写成 npm 脚本，PowerShell / cmd / bash 通用。

```bash
npm install
npx playwright install chromium          # 只需第一次
npm test                                  # 类型检查 + 静态规则自检 + 单测 + 检查器自检（不需要 EPUB.js）
npm run fixtures                          # 生成 fixtures/*.epub（可复现）
npm run test:static -- --root ../src      # 扫描真实仓库的 src/，检查架构约束
npm run test:e2e -- --update-snapshots    # 第一次：纯 EPUB.js 基线（harness），写入快照
npm run test:e2e:app                      # 对 EpubStart 本体跑
```

`npm run test:e2e*` 都经过 `scripts/e2e.mjs`，它负责设置 `E2E_TARGET` 等环境变量（PowerShell 里不能写 `E2E_TARGET=app npx ...`）。
常用参数：`--full` 跑完整矩阵，`--anchor-baseline` 让基线也跑重排锚定，其余原样交给 Playwright（例如 `-g "long-chapter"`）。

首次运行必须带 `--update-snapshots`（或用 `npm run test:e2e:update`）：快照不存在时 Playwright 会写入并判失败，这是它的设计。
之后快照有变化就是测试失败，必须人工确认是不是有意的，再更新。

## 三个目标（E2E_TARGET）

| 目标 | 是什么 | 用途 |
|---|---|---|
| `harness`（默认） | 纯 EPUB.js 基线页，没有 EpubStart 的任何补丁 | **归因**：基线能复现 → 问题在 EPUB.js；只有 app 出现 → 问题在 reflow.ts / pagination.ts 等项目自己的代码 |
| `app` | EpubStart 本体 | 真正的回归 |
| `mock` | 不依赖 EPUB.js 的模拟 rendition | 只验证“测试框架本身”是通的，结果不代表任何真实阅读器 |

## 目录

```
e2e/
  in-page/walker.js     注入页面的走书器（纯 JS）。头部注释列出了它依赖的 EPUB.js 内部结构
  walk.ts               Node 侧：装配轨迹
  invariants.ts         不变量规则（纯函数）
  summary.ts            快照摘要
  matrix.ts             书 × 视口 × 设置；日常跑子集，E2E_MATRIX=full 跑全量
  adapter.ts            被测目标的适配层（app 目标的 TODO(adapt) 都在这里）
  reader.spec.ts        Playwright 用例
  harness/index.html    纯 EPUB.js 基线页
  selftest/             模拟 rendition + 检查器自检（埋 bug 验证检查器抓得到）
scripts/
  make-fixtures.mjs     合成 epub 生成器（零依赖）
  check-architecture.mjs  静态架构检查（ARCHITECTURE.md:187 的两条约束）
  serve.mjs             静态服务
  e2e.mjs               跨平台启动器（设置 E2E_TARGET 后运行 Playwright）
tests/invariants.test.ts  规则单测
fixtures/regression/    真实 bug 的最小复现书放这里（要提交）
fixtures/fonts/         测试用字体放这里（要提交，见下）
```

## 规则一览

| 规则 id | 抓什么 |
|---|---|
| `text-lost` / `text-duplicated` | 相邻页之间丢字 / 重复显示（章末贴边页是尾页补丁的设计行为，豁免） |
| `chapter-start` / `chapter-end` | 章首几个字、章尾几个字从未显示过（章末被整页跳过就是这条） |
| `chapter-skipped` / `chapter-order` | 走到书尾却有章节没访问过 / 章节倒退 |
| `stuck` / `walk-stuck` / `walk-aborted` / `walk-runaway` | next 没有产生移动 / 翻页卡住 / 没触发 relocated / 分页循环 |
| `roundtrip-prev` / `roundtrip-next` | prev 没回到上一页，或 prev 后再 next 没回到本页 |
| `scroll-misaligned` | scrollLeft 不是步长整数倍（容差 1.5px，专为非整数视口/DPR 准备） |
| `char-cut` / `page-hole` | 字符被页边界切开 / 页内文字范围里有不在可见窗口的字（分栏错乱） |
| `image-straddle` / `image-overflow` / `blank-page` | 图片跨页 / 图片比一页还大 / 空白页 |
| `anchor-lost` / `anchor-chapter` | 重排（字号、单双页、窗口缩放）后原来的阅读位置不在当前页内 |
| `no-direct-resize`、`no-doc-root-transform`（静态） | 绕过 reflow.ts 直接 `rendition.resize()`；对文档根元素用 top/transform |

## 接到 EpubStart（第一次真跑前要做的事）

1. **挂测试钩子**。在创建 rendition 的地方（`lifecycle.ts` 附近），仅在 `?e2e=1` 且非生产构建时挂出：
   ```ts
   if (import.meta.env.DEV && new URLSearchParams(location.search).has("e2e")) {
     (window as any).__EPUBSTART_E2E__ = { rendition, book, applySettings: (s) => /* 走应用自己的设置入口 */ };
   }
   ```
   `applySettings` 必须走应用的设置入口（这样才会经过 `reflow.ts`），不能直接调 `rendition.resize()`。
2. **改 `adapter.ts` 的三处 `TODO(adapt)`**：怎么打开一本书、怎么等第一页渲染完、怎么应用设置。
3. **先在 `harness` 目标上跑**，让走书器在真 EPUB.js 上站稳（见下一节），再切 `app`。
4. **把 `npm run test:static -- --root ../src` 接进 CI**，几行代码就能防住最隐蔽的一类回退。

### 第一次对着真 EPUB.js 跑，最可能要核对的地方

走书器按 EPUB.js 0.3.x 的结构写，依赖这些东西（也列在 `walker.js` 头部）：`rendition.manager.container`（横向滚动容器）、
`manager.layout.delta`（翻页步长）、`rendition.getContents()[0]`（当前章节，带 `.document` / `.window`）、
`rendition.currentLocation()` 的 `{start:{index,href,cfi}, atEnd}`。如果有红灯，先查这几处：

- 双页模式下 `viewWidth` / `step` 的取值是否符合预期（我只在单页模拟里验证过）。
- `atMaxScroll` 的判断：尾页补丁产生的“贴章末”页是否真的会触发它。
- 页面外的字符计数：`collect()` 对每个字符取一次 `getClientRects()`，超长章节会慢，慢到不可接受时改成按段落采样。

## 修一个 bug 之后做什么（对应复杂 bug 排查流程的“固化”一步）

1. 把触发 bug 的**最小** epub 放进 `fixtures/regression/<编号>.epub`，在 `matrix.ts` 的 `FIXTURES` 里登记。
   最小样本跑得快、失败时一眼看出问题，版权上也干净。
2. 如果现有规则抓不到它，在 `invariants.ts` 加一条规则，并在 `tests/invariants.test.ts` 里配一对“该报 / 不该报”的用例。
3. 如果现在还修不了，在 `reader.spec.ts` 的 `KNOWN` 里挂起对应规则并写清原因，不要让一条旧 bug 让整套测试长期红着。

## 关于字体与快照

不变量检查**不依赖字体**，排版快照**依赖字体**。没有统一字体时，不同机器上的页数会不同，快照没有意义。
把字体文件（`.ttf` / `.otf` / `.woff2`，建议 OFL 许可的 Noto Sans SC 子集）放进 `fixtures/fonts/`，
`npm run fixtures` 会把它们嵌进每本书。没有字体文件时生成器会警告。

可复现性的其他几点：固定视口和 DPR；等 `relocated` 而不是 `sleep`；等 `document.fonts.ready` 和图片加载；
关动画。矩阵（书 × 视口 × 设置）日常只跑子集，完整矩阵放夜间或发布前。

## 交给你的 agent 的任务书（可直接复制）

> 把 `epubstart-e2e/` 接进本仓库并让 `harness` 目标跑通。步骤：①读 README 的“接到 EpubStart”一节；
> ②安装依赖并运行 `npm test`，确认全绿；③先对 `harness` 目标运行 `npm run test:e2e -- --update-snapshots`，
> 逐条分析失败：区分“走书器对 EPUB.js 内部结构的假设不对”和“EPUB.js 真有问题”，前者改 walker.js，后者记录下来、不要改规则去迎合；
> ④再按 README 挂 `?e2e=1` 钩子并完成 adapter.ts 的 TODO(adapt)，对 `app` 目标重复；
> ⑤对比两个目标的差异，写出“哪些问题只在 app 出现”的清单；⑥补 `readerViewportGeometry` 的属性测试。
> 不要修改 `src/` 里的阅读器逻辑，除了挂测试钩子。
