# Direction A — Editorial / Ink & Paper

## 设计命题

Library 是一张正在使用的编目桌；Reader 是正文和一条有语义的页边轨。编辑感来自字排、版心和信息位置，不来自报纸装饰、纸张纹理或大标题。

## 签名元素：页边校样轨

- Library 中标记当前选中的书，并承载 selection、册次和藏书总量。
- Reader 中承载章节、阅读比例和临时翻页动作。
- 轨道上的编号都对应真实册次/章节/页码，不使用无意义的 `01/02/03` 装饰。
- 轨道之外保持克制，避免第二个视觉噱头。

## Token

原型变量位于 `styles.css`：

- Background `#F1F2EE`
- Surface `#FBFCF8`
- Primary text `#17242B`
- Muted text `#667177`
- Divider `#CDD3D1`
- Accent `#315F78`
- Selection `#D8E7EC`
- Error `#9B3E42`
- Spacing `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`
- Radius `0 / 4 / 8 / 12`；封面保持直角

Warm Paper 与 Dark 语义色见上层 [README.md](../README.md)。

## 字体

- UI：平台人文无衬线，原型回退为 `Segoe UI Variable / Noto Sans CJK SC / system-ui`。
- Reading：出版方字体优先，原型回退为 `Iowan Old Style / Palatino Linotype / Noto Serif CJK SC / Songti SC`。
- Utility：仅页码、进度、folio 使用小号 UI 字体与 tabular figures。
- CJK 不增加人为字距；长书名最多三行，完整信息在 inspector 中可达。
- 这里没有要求安装任何字体包，也没有扩展阅读设置枚举。

## 布局与扩展性

- 宽桌面：masthead 72px；Library 为 `minmax(content) + 330px inspector`；封面随宽度 5–9 列。
- 中等窗口：inspector 缩为 290px；再窄时变为覆盖式 side sheet，不持续挤压网格。
- 1000+ 本：默认提高 grid density；紧凑书目是另一种密度，但不显示来源路径、数据库 ID 或缓存字段。
- Reader：正文约 620–720px，页边轨不参与正文宽度；正式实现仍服从 `max_column_width_px` 与 reflow 契约。
- Android：只演示 Reader。桌面目录不缩小，改为 bottom sheet 内的触摸入口。

## 交互

- Library：箭头键/Tab 可移动到书；Enter 打开；选中同时有左轨、底线和 inspector 标题，不依赖颜色。
- Search：入口始终可见；本方向原型只暗示书名/作者与系列范围，不伪装全库统一索引。
- Reader 安静态：正文、轻量 folio、进度轨；通过轻触、键盘动作或显式焦点召回控件。
- Reader 控件态：顶部工具条与单个临时 sheet；目录、搜索、批注、设置一次只占一个上下文层。
- Android：顶部动作+bottom sheet；48px 触点，关闭按钮可见，手势为补充。

## Motion

- 封面 hover/focus 仅上移 2px，140ms。
- 临时 sheet 180–220ms，表达来自边缘/底部的上下文。
- Reader 翻页、字体重排、搜索结果和错误不加装饰动画。
- `prefers-reduced-motion: reduce` 下全部位移和过渡接近即时。

## 状态与错误

- 空书库直接邀请“导入 EPUB”。
- 缺失封面使用文字封面；来源不可用另以正文状态说明，不把两者混为一谈。
- 索引中显示 `indexed / total` 与取消，不显示预测剩余时间。
- 资源限制明确旧索引/阅读数据仍保留，不暗示自动清除用户数据。
- 取消后保留部分结果语义；重建是显式动作。

## 可访问性

- 有 skip link、landmark、原生 button/a、可见 `focus-visible`。
- Reader 控件态提供上一页、下一页、目录、搜索、批注、设置和全屏的可发现入口。
- Android 主要触点 ≥48px。
- 选中/错误状态使用文字和结构，不只用颜色。
- CSS 包含 reduced motion 与 forced colors 处理。

## 后端边界

本原型不展示需要新增后端的个人化聚合。系列范围全文状态、来源不可用、资源限制、批注、设置、目录资源和进度均映射现有契约。

若未来把当前搜索入口扩展成元数据+全部系列全文的统一全库查询，必须保留：

`DESIGN_DEPENDENCY_REVIEW_REQUIRED` — 现有搜索能力按 Library 数据、标签筛选、系列索引与当前书 EPUB.js 查找分开，不能由静态原型假定一个新 Command。

## Phase 1 限定

`index.html` 和 `styles.css` 是离线静态原型；没有生产导入、Tauri 调用、运行时依赖或 F1 实现。
