# EpubStart Frontend Design Exploration — Phase 2

> **STATIC PROTOTYPE ONLY** — 本目录不属于生产前端，不表示 B3 已通过，也不解锁 F1/F2/F3。

Phase 2 把 Phase 1 推荐候选 **Editorial Personal Library（A+C）** 收敛为一个高保真、可交互、可直接打开并可重复截图评审的静态原型。全部 HTML、CSS、JavaScript、mock 数据、浏览器临时数据和视觉证据均限制在本目录；原型不调用 Tauri、不访问 SQLite、不解析 EPUB、不注册 Command。

## 直接查看

打开 [index.html](index.html)。无需安装依赖或启动生产应用。

主要快捷键：

| 快捷键 | 行为 |
| --- | --- |
| `Ctrl+K` 或 `/` | 打开搜索 |
| `L` | 返回 Library |
| `R` | 打开 Reader |
| `C` | 在 Reader 切换安静态/控件态 |
| `T` | Reader 控件态打开目录 |
| `A` | Reader 控件态打开排版设置 |
| `Esc` | 关闭当前浮层；Reader 控件态回到安静态 |
| 方向键 | 在藏书网格/紧凑书目中移动焦点 |
| `Enter` | 打开当前聚焦的书 |

右下角“设计评审”按钮可打开原型控制台，切换：

- Library / Reader；
- 10 / 100 / 1000 册；
- 封面网格 / 紧凑书目；
- Light / Warm Paper / Dark；
- Reader 安静态 / 控件态；
- 搜索索引状态；
- 来源丢失与重新关联流程。

## 设计对象与任务

- **对象**：拥有 10–1000+ 本本地 EPUB，会长期阅读中文、日文与拉丁文字内容的人。
- **Library 的单一任务**：找到并打开下一本要读的书。
- **Reader 的单一任务**：从可靠位置继续阅读，需要时才召回目录、搜索、批注和设置。
- **产品性格**：安静、编辑感、个人化、内容优先、长期可用；触感来自比例、字排与信息位置，不来自拟物纹理。

## Brainstorm

### 核心色

| 名称 | Hex | 用途 |
| --- | --- | --- |
| Mineral canvas | `#E7EBE7` | 应用外层与冷静背景 |
| Leaf white | `#F8F9F5` | Library 与临时详情页 |
| Reading paper | `#F3EFE4` | Warm Paper Reader |
| Library ink | `#18242A` | 主文字、主要动作 |
| Graphite | `#697570` | 次要文字与说明 |
| Bookcloth teal | `#356C65` | 3px 阅读缝线、焦点关联、进度 |

语义补充：selection `#DCE9E5`、divider `#D0D7D2`、error `#A3443F`。不使用渐变作为结构，不从封面动态取色。

### 字体角色

- **UI**：`Segoe UI Variable / Noto Sans CJK SC / system-ui` 回退；承担导航、按钮、状态和长列表。
- **Reading**：`Iowan Old Style / Palatino Linotype / Noto Serif CJK SC / Songti SC` 回退；承担正文与书名。
- **Folio**：`Bahnschrift SemiCondensed / Arial Narrow / system-ui` 回退；仅承担页码、册数、索引进度等窄幅信息。

本阶段不绑定字体包，不扩展 `publisher / serif / sans / system` 阅读设置契约。

### 构图

```text
Desktop Library
┌ rail ┬──────────────── open collection field ─────────────┬ detail leaf ┐
│      │ title / quiet search / density                     │ selected    │
│      │ 3px continuation seam                              │ book        │
│      │ 10 / 100 / 1000 cover field or compact catalogue  │ actions     │
└──────┴─────────────────────────────────────────────────────┴─────────────┘

Desktop Reader
quiet:    folio ── 3px seam ── reading measure
controls: temporary top bar + one side sheet + visible page actions

Android
Library: top actions + open cover field + bottom navigation
Reader:  full-screen text + temporary top controls + bottom sheet
```

### 唯一签名

**阅读缝线**是一条固定 3px 的书布青色线：

- Library 中连接当前选中封面、续读上下文和 detail leaf；
- Search 中标识当前真实查询范围，而不是装饰 tab；
- Reader 中承担阅读进度与临时控件来源；
- Android 中缩为内容边缘和 bottom sheet 的单一强调。

这是本方向唯一允许显眼的视觉手势。封面、面板、状态和控件保持纪律化。

## 唯一性自检与修正

### 检查到的模板风险

1. 冷/暖纸色加衬线字体容易退化成常见“高级阅读器”模板。
2. 窄导航、网格和 inspector 容易退化成通用媒体库。
3. 1000 本模式容易变成数据库 dashboard。
4. 搜索状态多时容易堆 badge、进度卡和技术字段。

### 修正

- Paper 只用于 Reader，Library 使用偏冷矿物灰；强调色不是陶土色。
- 书籍没有卡片背景；封面直接落在开放藏书场中，选中由缝线、底边和文字共同表达。
- 紧凑模式仍只显示人认识的书名、作者、系列和状态，不显示路径、缓存、ID、大小或数据库字段。
- Search 把 Library / Series / Content 作为三种真实范围；索引状态写成句子与可操作动作，不使用装饰 badge。
- 删除了 Phase 1 中可能膨胀的“阅读回忆/成就/统计”想法，只保留最多一个续读上下文。

## 实现后批评准则

本轮视觉 QA 必须主动检查：

- 书脊色线是否真的帮助理解 selection/context，还是只是一条品牌装饰；
- 1000 本 compact 模式是否仍像私人藏书，而不是维护表格；
- Reader 控件是否既能隐身又可由键盘/触摸发现；
- Android 是否重新编排，而非缩小桌面三栏；
- CJK 长标题、缺失封面、来源错误和索引中状态是否破坏版式；
- reduced motion 下是否仍能理解上下文变化。

视觉证据与最终批评记录见 [evidence/README.md](evidence/README.md)。目录中现有 6 张目标尺寸 PNG；它们只证明本地静态页面的布局快照，不证明生产运行态。后续不再继续渲染。

## 原型交互覆盖

### Library

- 10 / 100 / 1000 册确定性数据集；
- cover grid / compact catalogue；
- 书籍选择、detail leaf、长标题、缺失封面；
- `available / missing / error` 状态；
- 鼠标、触摸、Tab、方向键与 Enter；
- Android bottom navigation 与按需 detail sheet。

### Reader

- 安静态与控件态；
- 目录、排版、搜索、批注入口；
- 上一页/下一页屏幕控件；
- Light / Warm Paper / Dark；
- 桌面 side sheet 与 Android bottom sheet；
- `prefers-reduced-motion`、可见 `:focus-visible`、forced colors 基线。

### Search / index

- Library metadata 视觉过滤；
- 系列范围选择；
- Content 结果；
- `ready / building / cancelled / pending / error / no-result`；
- 已索引/总章节、取消、继续、重建；
- source unavailable 和 resource limit 的可操作说明；
- 搜索查询在错误和重新关联流程中保留。

### 来源丢失 / 重新关联

- `BOOK_SOURCE_UNAVAILABLE:` 对应“文件已移动”；
- 重新选择原 EPUB；
- 指纹/标识符验证中；
- 匹配成功后保留进度和批注；
- `BOOK_RELOCATION_MISMATCH:` 保留原 missing 记录并要求重新选择；
- 原型不显示或保存真实路径/URI。

## 后端契约映射

| 设计能力 | 当前契约依据 | Phase 2 边界 |
| --- | --- | --- |
| Library 列表与状态 | `list_books -> BookSummary[]` | 不暴露 `source_locator/source_kind` |
| 打开/进度 | `open_book`, `get/save_reading_progress` | Reader 内容为静态排版研究，不声称 EPUB.js 已接入 |
| 来源重关联 | `relocate_book` 与稳定错误前缀 | 流程可交互，但匹配结果是明确标注的设计模拟 |
| 系列/标签 | 已有系列、标签与筛选 Commands | 只展示已支持的关系语义 |
| 系列全文搜索 | 索引任务、状态、取消、重建与 `search_series` | B2 `cfi` 仍为 `null`，结果不伪装精确页内高亮 |
| 当前书查找 | F2 EPUB.js 适配层职责 | 只作为视觉入口，不伪装后端 Command |
| 设置/批注 | 已有设置和 notes Commands | 原型交互不持久化，不改变契约 |

## 必须保留的依赖评审

1. `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — **全库 Continue Reading / 最近阅读排序**：`list_books` 不含批量进度，`get_reading_progress` 按书读取；1000 本下不能直接使用 N+1。
2. `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — **系列/收藏完成度聚合**：现有系列关系和单书进度没有冻结聚合语义。
3. `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — **统一全库搜索**：Library 数据、标签筛选、系列全文和当前书查找是不同真实能力；本原型只有统一视觉入口，没有假定一个新 Command。
4. `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — **compact list 的最近阅读字段**：若产品保留此字段，同样需要批量进度策略。本原型默认不显示。

这些标记不是实现建议；任何契约变化都应由主任务在 B3 后单独评审。本 sidecar 不修改 IPC、数据库或根级项目文档。

## 响应式与可访问性

- Desktop 主动作 ≥40px；Android 主要触点 ≥48px。
- 选中同时使用缝线、位置、底边和 `aria-current`，不只依赖颜色。
- overlay 具有 dialog 语义、初始焦点、Tab 循环和 Esc 关闭；关闭后焦点回到触发点。
- Library 方向键移动焦点，Enter 打开；快捷键不会在输入框中抢占文字。
- Reader 关键动作在控件态可见，手势和空白区点击只是补充。
- 字号、浏览器缩放和系统缩放不被禁用；CJK 不增加人为字距。
- `prefers-reduced-motion: reduce` 移除位移与平滑滚动；索引进度不使用循环动画。
- “减弱动效”不是隐藏状态：在该模式下仍保留安静态/控件态、选中、进度和错误的结构变化。
- `forced-colors` 下保留选中轮廓、进度和焦点。

## 视觉证据

运行本目录内的脚本（如需重新生成快照）：

```powershell
powershell -ExecutionPolicy Bypass -File .\capture-evidence.ps1
```

脚本只打开本地 `index.html`，使用 Edge/Chrome 无头模式，并把截图及浏览器临时 profile 都限制在 `phase-2`；结束时会验证并删除该临时 profile。它不启动 Vite、Tauri 或生产应用。若截图工具不可用，直接打开 `index.html` 与下方 URL 参数仍可完成静态评审。

可重复生成的截图目标（本次已生成）：

- `evidence/desktop-library-100.png`
- `evidence/desktop-library-1000-compact.png`
- `evidence/desktop-search-indexing.png`
- `evidence/desktop-reader-controls.png`
- `evidence/mobile-library.png`
- `evidence/mobile-reader-controls.png`

## 验证

运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\validate-prototype.ps1
```

验证范围只包含本目录：文件存在、HTML/CSS/JS 结构、交互标识、10/100/1000 数据开关、搜索/索引/来源状态、依赖标记、截图尺寸和禁止的生产路径引用。

## 停止点

- 本目录完成后停止在设计 Phase 2。
- 不创建最终生产 `FRONTEND_DESIGN.md`。
- 不修改或导入 `src/`。
- 不启动 F1，不把静态交互或截图当作运行态验收。
- 未执行 Git；Git 与 B3 全部由主任务独占。
