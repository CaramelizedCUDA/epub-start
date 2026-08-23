# Direction A+C — Editorial Personal Library

## 设计命题

Library 采用 Personal Library 的拥有感、续读上下文和系列身份；Reader 采用 Editorial 的正文优先与极低 chrome。两者通过一条固定的 3px 书脊色线联系，而不是通过卡片、渐变或动态封面取色。

## 签名元素：书脊色线

- Library 标记当前选中书、continue line 和 detail leaf 来源。
- Reader 安静态只保留同一条线；控件态继续作为目录选中与进度强调色。
- Android 缩为正文左侧短线和 bottom sheet 进度色。
- accent 固定为语义 token `#3D6E68`；不做图像分析，不新增依赖或设置字段。

## Token 与字体

- Background `#F3F4F0`
- Surface `#FCFCF8`
- Warm paper `#F8F4E9`
- Primary text `#1F2B31`
- Muted text `#69736F`
- Divider `#D3D8D3`
- Accent `#3D6E68`
- Selection `#DCE8E4`
- Error `#A4453E`
- Spacing `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`
- Radius `0 / 4 / 8 / 12`；封面、网格和桌面主区块保持直角

UI 使用平台人文无衬线回退；书名/Reader 使用成熟正文衬线回退。这里定义角色，不硬编码字体包，也不扩展 `publisher / serif / sans / system` 阅读设置契约。CJK 不人为增加字距，长标题在网格截断、在 detail leaf 完整呈现。

## 布局与扩展性

- 宽桌面：76px rail + 弹性 cover field + 300px detail leaf。
- 中等窗口：detail leaf 变覆盖式临时层；搜索移到第二行，不压缩书名。
- 10 本：封面保持较大；不添加统计或推荐填空。
- 100 本：grid、系列与标签筛选提供组织。
- 1000+ 本：grid density 与 compact list 双密度；默认视图仍不展示路径、大小、ID 等维护字段。
- Reader 正文约 620–720px；正式实现必须继续服从 `max_column_width_px` 与统一 reflow 契约。
- Android 只演示 Reader，以全屏正文、顶部动作和 bottom sheet 重新编排。

## 交互与状态

- Library 选中同时使用 3px 色线、底边、`aria-current` 与 detail 标题，不只依赖颜色。
- Search 作为临时密集层；Library 元数据、系列全文与当前书查找在视觉上可统一，但必须显示真实范围和各自索引状态。
- Reader 安静态通过轻触、键盘操作或焦点召回；控件态提供目录、搜索、批注、设置、全屏、上一页与下一页。
- 一次只打开一个 sheet；关闭后焦点返回触发点。
- 空书库、缺失封面、来源不可用、索引中、无结果、资源限制、取消/重建沿用顶层 README 的状态语义。
- Android 图片导出当前返回未支持，因此原型没有展示导出动作。

## Motion 与可访问性

- 封面 lift 2px/140ms；sheet 180–220ms；其余保持静态。
- Reader 翻页、reflow、位置恢复和错误不添加装饰动画。
- `prefers-reduced-motion` 下取消位移与平滑滚动；`forced-colors` 保留选中轮廓。
- 使用 skip link、语义 landmark、原生 button/a、可见 focus ring。
- Android 主要触点 ≥48px，关闭与翻页动作可见，手势不是唯一入口。
- 正文允许字号、系统缩放与浏览器缩放；不锁死 viewport。

## 后端边界

- `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — 全库 Continue Reading、最近阅读排序与 compact list 的最近阅读字段需要批量进度读取策略，不能在 1000+ 本下直接 N+1。
- `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — 系列/收藏完成度没有冻结聚合语义。
- `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — 元数据、标签、系列全文和当前书查找目前是分开的能力；统一全库查询需要 B3 后契约评审。

最近加入、系列/标签关系、单书进度、设置、批注、来源状态和系列范围索引均有现有契约依据。本原型没有新增 Command、Schema、生产 mock 或运行时依赖。

## Phase 1 限定

`index.html` 与 `styles.css` 是离线静态原型。没有启动生产应用、没有修改生产路径、没有进入 F1。
