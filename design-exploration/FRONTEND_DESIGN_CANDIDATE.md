# EpubStart 前端设计候选（Phase 1）

> **CANDIDATE ONLY** — 供人工评审，不是最终生产规范。B3 技术冻结已解锁 F1，但本文件不等同于生产实现授权。

## 结论先行

建议把 **Editorial Personal Library（A+C）** 带入下一轮设计评审，同时保留两个不可稀释的来源：

- Library 从 Reading Room 继承“继续阅读优先、系列有身份、详情按需出现”；
- Reader 从 Editorial 继承“正文第一、页边秩序、控件临时出现”。

这一建议不是因为 A+C 在任务中被标为偏好。单看 Reader，Editorial 更纯粹；单看 Android Library，Reading Room 更自然。A+C 获胜是因为它在 10、100、1000+ 本规模和桌面/Android 双端上没有明显短板，并能用单一“书脊色线”保持身份，避免混合成无性格的安全方案。

## 评分方法

- 正向指标：1=弱，5=强。
- 两项风险：1=低风险，5=高风险；因此风险分越低越好。

| 指标 | Editorial | Reading Room | Editorial Personal |
| --- | ---: | ---: | ---: |
| Reading immersion | 5 | 4 | 5 |
| Library scalability | 4 | 4 | 5 |
| Desktop suitability | 5 | 4 | 5 |
| Android suitability | 3 | 5 | 4 |
| Accessibility | 4 | 4 | 5 |
| Visual identity | 5 | 4 | 5 |
| Long-term maintainability | 4 | 4 | 4 |
| Risk of becoming generic | 3 | 2 | 2 |
| Risk of becoming overly decorative | 2 | 4 | 2 |

## 逐项理由

### Reading immersion

- **Editorial — 5**：最窄的永久 chrome、最清晰的正文版心与页边层级；是三者中最像“读书”而不是“操作软件”的方向。
- **Reading Room — 4**：Reader 仍克制，但个人化上下文和较暖的层次会比 Editorial 多占一点注意力。
- **Editorial Personal — 5**：直接继承 Editorial 的 Reader，并用 3px 书脊线保留书的身份，不引入永久侧栏。

### Library scalability

- **Editorial — 4**：开放网格、密度切换与页边 inspector 可扩展；但对“接着读”的优先级表达较弱。
- **Reading Room — 4**：最近/系列/续读分区适合日常使用；若分区过多，会让 1000+ 本的全库浏览变碎。
- **Editorial Personal — 5**：默认 cover grid、可切 compact list、临时搜索层和 on-demand detail leaf 形成最完整的密度梯度。

### Desktop suitability

- **Editorial — 5**：宽屏上的非对称版心、页边 inspector 和键盘导航都自然。
- **Reading Room — 4**：横向续接带很适合桌面，但较宽的情境区会压缩中等窗口的藏书密度。
- **Editorial Personal — 5**：宽屏三栏、窄屏临时详情层，能利用空间而不永久挤压内容。

### Android suitability

- **Editorial — 3**：页边结构在窄屏需要较多重构；Android Reader 可成立，但 Library 的刊物式构图迁移成本更高。
- **Reading Room — 5**：续读、最近和底部导航天然适合纵向触屏，且不是桌面缩小版。
- **Editorial Personal — 4**：全屏 Reader 与 bottom sheet 很稳，Library 仍需验证大藏书下的移动端搜索/筛选流。

### Accessibility

- **Editorial — 4**：层级清晰、对比克制；风险是控件过度隐身，需要保证键盘聚焦时主动召回。
- **Reading Room — 4**：动作更可发现、Android 触点更自然；多分区可能增加屏幕阅读器的导航负担。
- **Editorial Personal — 5**：保留清晰 landmark、可见控件态和单一临时层；选中态同时使用线条、位置与文字。

### Visual identity

- **Editorial — 5**：页边校样轨与非对称版心最鲜明。
- **Reading Room — 4**：阅读续接带有情感，但如果文案和真实书目不足，可能接近常见媒体库首页。
- **Editorial Personal — 5**：书脊色线把 Library 与 Reader 串成同一产品，且不依赖装饰资产。

### Long-term maintainability

- **Editorial — 4**：token 少、结构清楚；复杂点在多窗口宽度下的版心与 inspector。
- **Reading Room — 4**：分区可复用，但持续增加“个人化区块”会造成壳层膨胀，需要严格限额。
- **Editorial Personal — 4**：结构较完整但状态较多；必须把 shell、detail leaf、reader sheets 变成少量稳定深模块，而非堆组件。

### Risk of becoming generic

- **Editorial — 3**：编辑感很容易退化成常见“奶油纸张+报纸细线”模板；本案用冷纤维灰和有语义的页边轨降低风险，但仍需警惕。
- **Reading Room — 2**：开放封面群组和阅读续接带较少见；只要不退回卡片 dashboard，就有独立性。
- **Editorial Personal — 2**：书脊色线与两种信息密度提供明确锚点；风险来自后续实现时把它简化成普通侧栏+卡片网格。

### Risk of becoming overly decorative

- **Editorial — 2**：只允许页边轨一个签名元素，其他部分高度克制。
- **Reading Room — 4**：最容易加入不必要的回忆、成就、封面堆叠和动画；必须拒绝阅读 streak 与情绪化数据。
- **Editorial Personal — 2**：固定色线而非封面动态取色，阴影只用于临时层，装饰预算可控。

## 最强方向

**Editorial Personal Library**。

保留条件：

1. Library 的默认视图仍是开放式藏书场，不变成圆角卡片墙。
2. Reader 安静态不常驻目录、搜索、设置或批注面板。
3. 书脊色线固定为语义 accent，不做封面取色、渐变或发光。
4. 搜索需要密集时可以密集，但只在临时层中出现，关闭后归还空间。
5. 任何“继续阅读/系列完成度”聚合必须先解决标记的契约评审，不以 N+1 或假状态进入生产。

## 各替代方向应带走的最强想法

### 从 Editorial 带走

- 页边校样轨的语义：进度、选中与上下文信息共享同一视觉位置。
- Reader 的非对称版心与低 chrome。
- inspector 使用边界与留白，不使用浮动卡片。

### 从 Reading Room 带走

- “接着读”优先于“最近导入”，但前提是取数契约可扩展。
- 系列作为一组有记忆的书，而不是重复元数据标签。
- Android Library 采用纵向续读+底部导航，而非缩小桌面三栏。

### 从 Editorial Personal 保留

- 3px 书脊色线。
- grid / compact list 两种密度，详情 leaf 按需出现。
- Reader 控件通过顶部临时条、侧 sheet 与 Android bottom sheet 召回。

## 应明确拒绝的元素

- 圆角容器套圆角卡片、每本书一个数据记录框。
- 阅读 streak、每日分钟数、无业务意义的统计图。
- 木纹、假书架、纸张纹理、翻页卷角或厚重投影。
- 由封面动态取色驱动整页主题；这会增加视觉噪声和实现依赖。
- 永久占用 Reader 的目录、搜索、设置或批注栏。
- 只有 hover 才出现的关键动作；触屏和键盘必须同样可发现。
- 将 `source_locator`、缓存路径、数据库 ID 或文件维护细节暴露为 Library 主信息。
- 将 B2 的 `cfi = null` 搜索命中伪装成已经具有精确页内高亮。
- 在 Android 展示尚未支持的图片导出动作。

## 建议混合方案

### Library

- 基础结构：Editorial Personal 的窄 rail + 开放网格 + detail leaf。
- 首屏上下文：只保留一条 Reading Room 风格的“继续阅读”横带，数量上限 3；没有可扩展进度契约前不实现。
- 搜索：顶部安静入口；展开后分为 Library、Series、Content 三个真实范围，不把不同索引状态揉成一个假统一结果。
- 大藏书：grid 负责浏览，compact list 负责快速扫描；series/tag/sort 作为临时筛选，不变成常驻数据库工具栏。

### Reader

- 安静态：Editorial 的正文版心 + 书脊色线 + 最小 folio。
- 控件态：顶部条显示返回、标题、进度；左/右 sheet 分别承载目录/搜索与设置/批注，一次只打开一个。
- Android：全文屏幕，轻触召回顶部动作与底部 sheet；返回动作始终可见于控件态，手势不是唯一入口。

### Search

- Library 元数据、系列范围全文和当前书章节内搜索应在视觉上属于同一系统，但契约和状态必须保持来源清晰。
- indexing 显示已索引/总章节、取消和部分结果；不显示无法证明的剩余时间。
- no result 回显范围与查询，不推荐无关内容。
- source unavailable / resource limit 提供可操作修复，不清空用户的查询。

## 未决问题

1. 书脊色线是否应保持全局固定 teal，还是允许用户主题选择有限的 3–4 个预设 accent？本轮建议固定，避免提前扩大设置契约。
2. 1000+ 本下 compact list 的默认字段应只有封面缩略、书名、作者、系列和状态，还是还需最近阅读？后者涉及批量进度契约。
3. Desktop inspector 在 900–1100px 窗口应覆盖内容还是推动网格？本轮建议覆盖并保留当前选中位置，需真实窗口原型验证。
4. Android Library 更适合底部导航的“藏书 / 搜索 / 设置”，还是“藏书 / 系列 / 搜索”？设置可进入头像/溢出菜单，但必须保持可发现。
5. CJK 正文在简中、繁中、日文混排时的推荐行高与标点策略，需要使用真实 EPUB 内容在 F3 人工对比，不能由静态 mock 定案。
6. 阅读器控件自动隐藏时长、键盘聚焦召回与屏幕阅读器模式需要在 F2 原型中联合验证。

## 后端假设与评审标记

- `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — 全库 Continue Reading 与最近阅读排序需要可扩展的批量进度读取策略。
- `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — 系列/收藏完成度没有冻结聚合语义。
- `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — 元数据、标签、系列全文和当前书搜索目前是分开的真实能力；统一全库查询需要契约评审。
- `DESIGN_DEPENDENCY_REVIEW_REQUIRED` — 若 compact list 展示最近阅读时间，同样依赖批量进度读取。

这些标记只提出设计评审问题；本目录没有新增 Command、字段、聚合逻辑或生产 mock。

## 下一次人工评审建议

使用三组真实内容做 45–60 分钟评审：

1. 10 本混合中/日/英书名，判断空白与亲近感；
2. 100 本、长系列名和缺失封面，判断结构与 inspector；
3. 1000+ 本生成目录，判断 grid/list 密度、键盘路径和搜索范围。

先裁决 Library 的信息架构和 Reader 的控件召回方式，再确定 token；不要在同一轮讨论生产组件拆分。B3 技术冻结已经完成，评审通过后再进入单独授权的 F1 实现。

## 停止声明

本候选文档到 Phase 1 为止。未创建最终 `FRONTEND_DESIGN.md`，未开始生产实现；生产 F1–F3 仍需先完成方案裁决。
