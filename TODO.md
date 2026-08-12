# 当前冲刺任务（TODO - Phase 2）

开始任何实现前必须阅读本文件，只处理第一个未完成且无外部阻塞的任务。完成标准和验证通过后才能勾选；宏观边界见 [ROADMAP.md](ROADMAP.md)，Schema 和 IPC 分别见 [DATABASE.md](DATABASE.md)、[IPC.md](IPC.md)。

## Phase 1 收尾

- [x] Windows 桌面导入、封面、删除、EPUB 阅读、可见翻页、来源重新定位和应用完全重启后的 CFI 恢复已经确认。
- [x] Phase 1 功能开发结束；当前阶段切换为 Phase 2。
- [ ] **外部阻塞：Android 认证环境。** 缺少 Android SDK/NDK、Rust target 和设备；Rust/Kotlin 构建、持久授权重启、撤销授权和设备重新定位仍未认证，不得宣称全平台完成。该阻塞保留至认证环境获批并配置。
- [x] 已知架构债已整改：来源使用受控 Reader/租约，整本 `epub_bytes_cache` 已移除；ZIP 预算和恶意输入测试通过。
- [x] Phase 1 已验证基线（历史记录）：`cargo fmt --check`、`cargo check`、`cargo test` 32/32、`npm run build`、`npm run tauri build`；2026-07-21 协议资源链运行态 200，`Failed to fetch` 已修复。2026-07-22 当前代码回归为 Rust 25/25、前端主包 507.95 kB，Windows MSI/NSIS 发布构建通过。

## Phase 2 执行任务

### 1. 来源、安全预算与内存整改

- [x] 实现来源指纹、`SourceLease`、独立 `Read + Seek` Reader 和 Android 私有来源缓存；桌面直接读取文件。
- [x] 移除整本 `epub_bytes_cache`；缓存按指纹失效，Android 总量 1 GiB、单本压缩源 512 MiB，并保护在用租约。
- [x] 统一 ZIP 预算：5,000 条目、2 MiB 控制文件、50 MiB 单条目、2 GiB 总解压量和 200:1 压缩比。
- [x] 完成标准：导入、重新定位和协议资源请求均不保留整本 EPUB `Vec<u8>`；缓存、指纹和恶意 ZIP 测试通过（Rust 25/25）。

### 2. 格式能力与协议边界

- [x] 建立 `formats/capabilities.rs`、`registry.rs`、`active.rs` 和 `formats/epub/`；`BookFormat` 保持现有共享模型唯一来源。
- [x] 建立 `services/` 编排层，Command 只保留 IPC 适配；protocol 只依赖公开资源能力，导入/打开/重定位/删除用例已下沉（Rust 27/27，前端构建通过）。
- [x] 未支持格式稳定返回 `FORMAT_NOT_SUPPORTED:`，禁止 stub handler、`todo!`、`unimplemented!` 或 panic。
- [x] 完成标准：现有 EPUB 导入/打开/协议/重新定位契约保持，架构边界测试通过；桌面真实运行态仍需发布前人工回归。

### 3. V2 数据库与 IPC

- [x] 追加 V2 迁移：来源缓存、系列、标签组/标签、设置、notes range、FTS5 搜索索引。
- [x] 实现基础 Rust/TypeScript 模型、仓储、Commands、`lib/tauri.ts` 和脱敏错误映射：批注、全局/单书设置、系列、标签组/标签及关系 API 已接入；搜索命令按第 9 节随真实后台索引交付，不设置 stub。
- [x] 完成标准：空库、V1 升级、重复启动、V2 失败回滚和 V1/V2 级联测试通过；系列单归属、重排、继承去重与关系删除测试通过；V1 来源与进度字段未变（Rust 39/39，前端构建通过）。

### 4. 图形化阅读器、目录与设置

- [x] 提供屏幕可见的上一页、下一页、目录、搜索、批注、设置和全屏控件；键盘/点击区仅作为补充。
- [x] 使用 EPUB.js 统一解析 EPUB 2 NCX 与 EPUB 3 NAV，递归渲染嵌套目录树，并根据 `relocated.start.href` 标记当前章节（前端构建通过）。
- [x] 实现 light/sepia/dark、publisher/serif/sans/system、字号、行距、段落间距、首行缩进、独立四边距、最大列宽、分页/滚动和单双页设置；V3 迁移保持全局默认与单书逐字段覆盖。
- [x] 数值设置改为可键入步进器，预览即时生效，按钮变化 300ms 防抖保存，失焦/Enter 提交；异步保存失败重试一次，第二次失败提示但不回滚预览。
- [x] 修复全屏/窗口 resize 重排竞争：300ms 防抖；ESC 与全屏按钮复用首行锚定退出逻辑；missing 卡片立即提示并提供独立重新选择操作；通用导入按指纹恢复唯一匹配的 missing/error 原 ID；滚动模式使用 continuous manager 双向跨章节加载并校正向上预载位置；分页设置和全屏操作捕获第一条可见文本行的起始 CFI，恢复后使该行仍为视口第一行。
- [x] 修复分页几何回归：首次 `renderTo` 即使用最终设置，字体/图片稳定后再做一次锚定重排；单/双/自动模式共享容器宽度计算，最大列宽按单列上限解释，自动模式在桌面可用宽度达到 1000px 时切换双页；分页恢复不再平移 iframe 根元素。
- [x] 修复分页布局与 flow 切换回归：最大列宽重新参与 EPUB.js 几何计算，正文 body 不再以 CSS `max-width` 二次缩窄；阅读设置跨 Rendition 全局串行，连续滚动切换等待 iframe 资源和布局稳定后再恢复首行锚点并安装校正器；缩窄布局的 iframe 外侧点击由 reader engine 接管。
- [x] 完成标准：设置重排前保存首行 CFI、重排后恢复；可见控件覆盖阅读操作。已知 EPUB.js 限制：全屏切换后页码会重新计算；大幅调整字号时位置允许存在 ±1–2 段偏差。

### 5. EPUB 图片查看与桌面导出

- [x] 正文图片单击进入阅读器内图片查看器；桌面支持滚轮缩放和放大后拖动，触屏支持双指缩放与拖动，单击图片或空白返回正文。
- [x] 正文和图片查看器均提供右键菜单；触屏提供长按入口；桌面“另存为”经 `book_id -> SourceLease -> ActiveFormat -> ResourceProvider` 受控读取单个图片并调用系统保存对话框。
- [x] 图片查看器保留设置、全屏/退出全屏和可见“另存为”控件；EPUB iframe 图片事件不会触发翻页命中区。
- [ ] **外部阻塞：Android 图片导出与手势设备验收。** 当前私有 SAF 插件未实现 `ACTION_CREATE_DOCUMENT` 写入链；Android 长按会明确返回能力未支持，双指/拖动只完成静态实现，须在 SDK/设备环境获批后补齐导出并验收。
- [x] 完成标准：Rust 路径规范化、图片 MIME、资源预算与来源状态均受控；桌面编译/构建通过，Android 不伪装导出成功。
- [x] 2026-07-23 自动验证：`cargo fmt --check`、`cargo check`、`cargo test` 50/50、`npm.cmd run build`、`npm.cmd run tauri build` 通过；前端主包 548.60 kB 告警保留，Windows MSI/NSIS 生成成功。桌面交互与保存结果仍需人工验收。
- [x] 2026-07-24 人工验收确认桌面图片保存正常；修复图片任务引入的左右边缘点击翻页回归，改为 iframe 内避让图片/链接/选区的 25% 边缘判定；修复相对图片 URL 导致左键/右键入口失效；正文右键“更多工具”提供放大图像和另存为；书架页新增全局设置和全屏/退出全屏控件。
- [x] 2026-07-24 回归自动验证：`cargo fmt --check`、`cargo check`、`cargo test` 50/50、`npm.cmd run build`、`npm.cmd run tauri build` 通过；前端主包 555.52 kB 告警保留，Windows MSI/NSIS 生成成功。点击翻页、正文图片左键/右键菜单和书架控件仍需人工复验。
- [x] 2026-07-24 二次人工验收暴露回归后完成静态修复：分页边缘命中改用阅读器视口全局坐标并增加单次导航锁；图片查看与安全导出路径解析解耦，图片右键会先屏蔽 WebView 原生菜单；书架 `Esc` 主动退出全屏。`cargo fmt --check`、`cargo check`、Rust 50/50 与前端构建通过，主包 556.64 kB 告警保留；Windows 发布构建因正在运行的 `target/release/epub-start.exe` 锁定输出文件而受环境阻塞。四项运行时行为仍待人工复验，不以构建成功替代验收。

### 6. 高亮与批注

- [ ] 实现选区浮动菜单、纯高亮、批注文字、改色、编辑、删除、列表和点击跳转。
- [ ] 保存标准 `cfi_range` 及可独立定位的起止 CFI，重启后恢复高亮；内容只按纯文本渲染。
- [ ] 完成标准：跨节点选区、重启恢复、删除级联、长度/颜色校验和 CFI 往返测试通过。

### 7. 当前书全文搜索

- [ ] 使用 EPUB.js 逐 spine 搜索并及时卸载章节，返回章节、摘要和精确 CFI。
- [ ] 提供搜索进度、取消、结果上限和中日韩文本支持。
- [ ] 完成标准：同词多命中、跨节点命中、点击跳转、取消和资源预算验收通过。

### 8. 系列、标签组与标签

- [ ] 实现系列 CRUD、单系列归属、卷标与排序。
- [ ] 实现用户标签组、标签 CRUD、书籍直接标签、系列多标签和动态继承。
- [ ] 书架支持按标签组/标签筛选并区分直接与继承标签；删除关系不得删除图书。
- [ ] 完成标准：系列单归属、继承去重、标签组删除变未分组、危险操作确认和图形化管理验收通过。

### 9. 同系列全文搜索

- [ ] 使用 bundled SQLite FTS5 trigram 建立后台惰性增量索引；短于 3 字符的查询使用参数化 `LIKE`。
- [ ] 按来源指纹失效；显示索引进度、部分结果、取消、错误和手动重建。
- [ ] 执行索引预算：单章节 8 MiB、单书 64 MiB、索引总量 2 GiB。
- [ ] 完成标准：多卷、中日韩、索引失效、取消、过期重建和来源不可用测试通过。

### 10. 发布前审计

- [x] 运行 `cargo fmt --check`、`cargo check`、完整 `cargo test`、`npm.cmd run build`、`npm.cmd run tauri build`（2026-07-23；最新 Rust 46/46，分页几何修复后前端主包 542.13 kB 告警保留，Windows MSI/NSIS 构建成功）。
- [ ] Windows 运行态验证导入、封面、删除、资源链、目录、批注、设置、搜索、系列、标签和重启恢复。
- [ ] 审计 README、ARCHITECTURE、DATABASE、IPC、CONVENTIONS、ROADMAP、TODO、SECURITY 与实现一致性。
