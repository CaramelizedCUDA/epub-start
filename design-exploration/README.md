# EpubStart Phase 1 前端设计探索

> 状态：仅供人工评审的隔离设计草稿。这里的文件不是生产前端，不代表 F1 已解锁，也不建立最终 `FRONTEND_DESIGN.md`。

本目录只回答一个问题：在不改变 B2/B3 后端、IPC、数据库和生产前端的前提下，EpubStart 应以怎样的视觉与交互语言进入 F1 评审。

## 设计对象与单一任务

- **具体对象**：拥有 10–1000+ 本本地 EPUB、会长期阅读中日韩与拉丁文字内容的个人读者。
- **核心场景**：从自己的藏书中找到一本书，安静地继续阅读；需要时才召回目录、搜索、设置、批注和来源修复。
- **页面单一任务**：Library 帮人选择下一本要读的书；Reader 让正文成为屏幕上最重要的东西。
- **产品性格**：安静、编辑感、个人化、内容优先、长期可用；触感来自比例、字排和层级，而非木纹、纸纹或翻页特效。

## 硬边界

- 当前仍处于 B2 收口并向 B3 契约冻结推进；F1 未开始。
- 原型只使用本目录内的静态 HTML/CSS 和本地 mock 文案，不导入 `src/`，不调用 Tauri，不注册 mock Command。
- 不修改 React、Rust、SQLite、IPC、依赖、Tauri 能力或生产配置。
- 不把视觉原型当作后端完成、运行态验证或跨端验收证据。
- 任一需要新增或重新评审后端契约的构想都保留精确标记 `DESIGN_DEPENDENCY_REVIEW_REQUIRED`。

## 如何查看

直接在浏览器中打开每个方向的 `index.html`，无需安装依赖、构建或启动生产应用：

- [Editorial / Ink & Paper](editorial/index.html)
- [Personal Library / Reading Room](reading-room/index.html)
- [Editorial Personal Library](editorial-personal/index.html)

每页依次展示 Desktop Library、Desktop Reader 安静态、Desktop Reader 控件态，以及一个经过重新编排的 Android 代表屏；页面末尾还包含非 happy-path 状态样本。

## 写入前设计计划与唯一性自检

### 原始方向

| 方向 | 布局命题 | 唯一记忆点 | 有意承担的风险 |
| --- | --- | --- | --- |
| Editorial | 像编辑桌一样以封面、文字和页边信息组织藏书 | **页边校样轨**：选中态、进度与临时工具都收进窄边栏 | 过度克制可能让初次使用者找不到入口 |
| Reading Room | 以“接着读”和系列关系组织私人收藏，而非把书当记录卡 | **阅读续接带**：横向、连续、带上下文的阅读队列 | 温暖与层次过多时可能走向装饰化 |
| Editorial Personal | 用个人书房的 Library 承接、用编辑式 Reader 隐身 | **书脊色线**：从选中封面延续到阅读临时控件的细线 | 混合方向可能折中成没有性格的通用 UI |

### 泛化检查后的修正

最初构想容易落入三种常见模板：奶油底+大衬线+陶土色、满屏报纸细线、多个圆角卡片堆叠。已作以下修正：

1. Editorial 改用偏冷的纤维灰、蓝墨色与单一校样蓝；细线只表达书目结构，不把整页做成报纸。
2. Reading Room 用宽幅阅读带和开放式封面群组代替卡片容器；暖意来自层次与绿色书布色，不使用木纹或拟物书架。
3. Editorial Personal 只保留一条 3px 书脊色线作为签名，去掉多余徽章、渐变和装饰性统计。
4. 三个方向的 Reader 都把永久 chrome 降到最低；控件态使用临时 sheet、popover 或边栏，不挤占默认阅读宽度。

## 共同设计基线

### 字体角色

本阶段定义的是**字体角色与回退栈**，不固定任何字体包依赖。

| 角色 | 建议 | CJK 处理 |
| --- | --- | --- |
| UI | 平台人文无衬线；原型使用 `Segoe UI Variable`, `Noto Sans CJK SC`, system-ui 回退 | 中文按钮不使用全大写；中英文混排保持正常字间距 |
| Reading | 出版方字体优先，其次平台正文衬线；原型使用 `Iowan Old Style` / `Palatino Linotype` / `Noto Serif CJK SC` 回退 | 禁止人为增加 CJK 字距；标点挤压和避头尾留给 EPUB 内容与引擎评审 |
| Utility | 窄幅 UI 无衬线或系统等宽仅用于页码、进度与状态 | 数字可使用 tabular figures；状态说明仍用 UI 字体 |

Reader 必须继续尊重已冻结的 `publisher / serif / sans / system` 设置语义；原型字体栈不是新的 IPC 枚举。

### 共享间距、形状与层级

- 间距：`4 / 8 / 12 / 16 / 24 / 32 / 48 / 64` px。正文垂直节奏从字体行高推导，不另造随机间距。
- 圆角：`0`（书封、分隔）、`4`（小控件）、`8`（临时面板）、`12`（Android bottom sheet）；圆形只用于图标按钮或触点。
- 阴影：默认无阴影。仅临时浮层、Android bottom sheet、被拿起的封面使用一层低对比阴影；结构靠留白与分隔，不靠 elevation 堆叠。
- 桌面触点：最小 32×32 px，主要动作 40×40 px；Android 触点最小 48×48 dp。
- 内容宽度：Reader 单栏以约 620–760 px 为舒适区；实际实现仍必须服从冻结的 `max_column_width_px` 和 reflow 规则。

### 动效与减弱动效

- 只动画“上下文从哪里来”：inspector 从选中封面方向展开，Reader 临时控件淡入，Android sheet 自底部出现。
- 建议时长：微反馈 100–140ms；面板 180–220ms；页面上下文转换不超过 260ms。Reader 翻页、字体重排和位置恢复不附加装饰动画。
- 搜索索引进度条可线性变化，但不使用无限发光、脉冲或旋转装饰。
- `prefers-reduced-motion: reduce` 下移除位移与平滑滚动，仅保留即时状态变化；三个原型都已包含对应 CSS。

### 可访问性

- Desktop 采用语义化 `header/nav/main/aside/article` 层级、可见 `:focus-visible`、跳转到主内容链接，以及不依赖颜色的选中状态。
- Reader 的上一页、下一页、目录、搜索、设置和批注必须在控件态有屏幕可发现入口；快捷键与边缘点击只是补充。
- Android 主要触点至少 48×48；底部 sheet 保留清晰标题与关闭动作，不把滑动手势作为唯一操作。
- 文本/背景目标至少达到 WCAG AA；正文允许系统缩放、应用字号 12–32 px 和浏览器缩放，不锁死 viewport。
- 状态使用标题+解释+可操作动作，不只依赖红/黄/绿；missing cover 有文字替代。
- 原型已提供高对比焦点与 `forced-colors` 基线；最终对比度仍需在 F3 用真实主题逐项测量。

## 三个方向

### A. Editorial / Ink & Paper

**构图**：顶部低矮刊头 + 大幅开放式封面网格 + 固定页边 inspector。Reader 把章节标题、正文与页边校样轨组成不对称版心。

```text
Desktop Library
┌ masthead ───────────────────────────────────────────┐
│ catalogue / large open cover field │ margin notes │
│                                     │ inspector    │
└─────────────────────────────────────┴──────────────┘

Reader active
┌ temporary top bar ──────────────────────────────────┐
│ TOC sheet │          reading measure        │ rail  │
└───────────┴─────────────────────────────────┴───────┘
```

**签名**：页边校样轨。它在 Library 表示选中书、在 Reader 表示章节/进度与临时工具来源，内容不是装饰编号。

**色彩角色**：

| 模式 | Background | Surface | Text | Muted | Divider | Accent | Selection | Error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Light | `#F1F2EE` | `#FBFCF8` | `#17242B` | `#667177` | `#CDD3D1` | `#315F78` | `#D8E7EC` | `#9B3E42` |
| Warm Paper | `#EEE9DE` | `#F8F4EA` | `#222722` | `#6E7068` | `#CEC7B9` | `#3F6871` | `#DDE7E1` | `#97443F` |
| Dark | `#151B1E` | `#1D2529` | `#E8ECE8` | `#9AA5A6` | `#394448` | `#83AFC0` | `#29434C` | `#E28A87` |

**排版**：UI 用克制的人文无衬线；书名与 Reader 正文用稳健的正文衬线，不做超大 display。中文章节标题约 28–32px，正文 17–19px/1.75；英文可稍紧，CJK 不加字距。

**响应式**：1000+ 本时默认 6–9 列密度、可切换紧凑书目；inspector 占用 280–320px，窗口窄于约 980px 时变临时侧 sheet。Android 选择 Reader，工具进入 bottom sheet，校样轨缩为顶部 folio 线。

**主要风险**：操作入口过于安静。补救方式是保留可发现的搜索按钮、选择边界和控件态工具栏，而不是永久加粗 chrome。

详见 [editorial/NOTES.md](editorial/NOTES.md)。

### C. Personal Library / Reading Room

**构图**：左侧短导航 + 横向阅读续接带 + 开放式“最近加入/系列”封面群组。selected inspector 从右侧推入，但不把每本书包进卡片。

```text
Desktop Library
┌ nav ┬ continue-reading ribbon ──────────────────────┐
│     │ recent covers / series clusters     inspector│
└─────┴─────────────────────────────────────┴─────────┘

Android Library
┌ greeting / search ──────────────────────────────────┐
│ continue reading                                    │
│ recent list                                         │
├ bottom navigation ──────────────────────────────────┤
```

**签名**：阅读续接带。它表现“我正在和哪些书相处”，不是推荐算法、阅读 streak 或分析面板。

**色彩角色**：

| 模式 | Background | Surface | Text | Muted | Divider | Accent | Selection | Error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Light | `#F3F1EA` | `#E8E3D8` | `#26322E` | `#6E756E` | `#CBC5B9` | `#35695A` | `#D8E6DF` | `#A34C46` |
| Warm Paper | `#EFE7D9` | `#E4D8C5` | `#2B2D27` | `#746E63` | `#C9BDA9` | `#4E6C57` | `#D7E1D4` | `#9A4B43` |
| Dark | `#18201D` | `#222C28` | `#ECF0EA` | `#A6AEA7` | `#3B4741` | `#86B5A0` | `#30483E` | `#E29188` |

**排版**：Library 以人文无衬线承担亲近感，封面书名可用适度衬线；Reader 仍采用稳定正文衬线。避免“手写体=个人化”的廉价捷径；CJK 使用完整字重的系统/思源回退。

**响应式**：Desktop 的续接带是横向内容结构，不是巨型 hero。1000+ 本依靠最近/系列分区、搜索、标签筛选与紧凑视图。Android 重新编排为纵向续读区、最近列表和底部导航，不缩小桌面侧栏。

**主要风险**：聚合进度和系列完成度容易超出现有批量契约，相关区域已明确标记依赖评审。

详见 [reading-room/NOTES.md](reading-room/NOTES.md)。

### A+C. Editorial Personal Library

**构图**：左侧窄导航、中央有呼吸的 cover grid、按需出现的右侧 detail leaf；Reader 延续 Editorial 的近乎隐身态。Search 在需要时成为密集但安静的临时层。

```text
Desktop Library
┌ rail ┬ collection / cover grid ┬ on-demand leaf ┐
│      │ search access           │ selected book  │
└──────┴─────────────────────────┴────────────────┘

Reader quiet → controls active
reading column + 3px spine line → temporary top bar + side sheet
```

**签名**：书脊色线。仅 3px 的稳定强调线把 Library 的选中书与 Reader 临时控件联系起来；不做动态取色，不引入图像分析依赖。

**色彩角色**：

| 模式 | Background | Surface | Text | Muted | Divider | Accent | Selection | Error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Light | `#F3F4F0` | `#FCFCF8` | `#1F2B31` | `#69736F` | `#D3D8D3` | `#3D6E68` | `#DCE8E4` | `#A4453E` |
| Warm Paper | `#EEE9DE` | `#F8F4E9` | `#272B28` | `#716E66` | `#CDC6B9` | `#456E64` | `#DCE5DD` | `#9D493F` |
| Dark | `#161D20` | `#20292C` | `#E9EEEA` | `#A1AAA6` | `#3A4546` | `#7EACA3` | `#2D4540` | `#E18C84` |

**排版**：UI 以平台无衬线保持原生感；书名与正文用成熟正文衬线。Library 信息层级由字重和距离建立，Reader 不依赖 display 字体制造气氛。

**响应式**：宽桌面使用三栏，窄桌面把 detail leaf 变为临时面板；Android 选择 Reader，以全屏正文、顶部轻触区和 bottom sheet 组织设置。1000+ 本保留 grid density 与 compact list 两种信息密度，默认不变成数据库表。

**主要风险**：混合后趋于“安全”。书脊色线、开放式封面编排与严格控制 chrome 是必须保留的三项性格锚点。

详见 [editorial-personal/NOTES.md](editorial-personal/NOTES.md)。

## 状态与搜索契约映射

| 设计状态 | 现有依据 | Phase 1 表达 |
| --- | --- | --- |
| 空书库 | `list_books -> []` | 解释“导入 EPUB”而非展示情绪插画；保留系统文件选择语义 |
| 缺失封面 | `cover_cache_path = null` | 使用带书名首字/标题的文字封面，不伪造图片 |
| 来源不可用 | `BookStatus::Missing` / `BOOK_SOURCE_UNAVAILABLE:` | 说明文件已移动，并提供“重新选择文件”动作 |
| 资源限制 | `BOOK_RESOURCE_LIMIT_EXCEEDED:` | 保留旧状态，说明释放空间/选较小文件/稍后重建，不暗示自动删除用户数据 |
| 索引中 | `SearchIndexStatus building` | 显示已索引/总章节和取消动作；不显示虚假剩余时间 |
| 已取消/待重建 | 任务取消、`pending/error` | 保留部分结果语义，提供继续或重建动作 |
| 无搜索结果 | `search_series -> []` | 回显查询范围与词，允许修改查询；不推荐无关内容 |
| 搜索来源失效 | `SEARCH_INDEX_UNAVAILABLE:` 或来源错误 | 保留查询，先处理来源或稍后重试 |

## Library 扩展性

- **10 本**：开放网格和较大封面，不用空洞的仪表盘填充空间。
- **100 本**：按最近加入、系列、标签与排序组织；selected inspector 不改变 grid 列宽。
- **1000+ 本**：网格密度与 compact list 可切换；搜索/筛选临时展开；长标题最多显示 2–3 行且完整标题通过详情/辅助文本可达。
- compact list 是同一藏书的另一种密度，不默认展示路径、大小、数据库 ID 等维护字段。
- 系列名和标签只在需要时出现；默认主视图仍由封面、书名与作者主导。

## 后端依赖评审清单

以下构想没有在本阶段实现，也不应以前端 N+1 调用或本地持久假状态绕过：

1. `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — **全库 Continue Reading 聚合**：当前 `list_books` 不含进度，`get_reading_progress` 按单书读取。若要在 1000+ 本下按最近阅读排序，需要在 B3 后单独评审批量只读契约或明确可接受的取数策略。
2. `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — **系列/收藏完成度聚合**：现有系列关系和单书进度可分别取得，但没有冻结的聚合完成度语义；“已读 3/7”不能先由原型变成产品事实。
3. `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — **统一全库搜索面板**：现有契约将 `BookSummary[]`、标签筛选与 `search_series` 分开；跨全部书籍的元数据+系列+全文统一查询、排序和索引状态尚无单一冻结契约。
4. `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — **全库最近阅读时间**：`ReadingProgress.updated_at` 存在，但没有批量读取；原型中的“昨天读过”仅为视觉占位，不授权新增字段或 Command。

不需要新后端能力的概念：最近加入（`added_at`）、缺失来源/解析错误状态、系列/标签关系、单书阅读设置、批注、系列范围索引状态与结果、重新定位流程。Android 图片导出当前明确未支持，因此原型不展示可执行导出入口。

## 比较与推荐

综合比较见 [FRONTEND_DESIGN_CANDIDATE.md](FRONTEND_DESIGN_CANDIDATE.md)。本轮推荐 **Editorial Personal Library** 进入下一次人工设计评审，但原因不是任务预设偏好：它在 Library 扩展性、Reader 沉浸和跨端适配之间得分最稳定，并能吸收 Editorial 的页边秩序与 Reading Room 的续接上下文。它仍需通过真实内容密度、1000+ 本列表和 CJK 长标题评审，才能成为最终规范。

## Phase 1 停止点

- 已探索三套方向与代表屏，未覆盖全部页面。
- 未创建或替换最终 `FRONTEND_DESIGN.md`。
- 未开始 F1、F2 或 F3。
- 下一步仅建议进行人工设计评审与方向裁决；任何生产实现必须等待 B3 门禁与单独授权。
