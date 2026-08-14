# 当前执行看板（Backend First）

本文件是唯一执行顺序。开始工作前必须阅读 [README.md](README.md)、[ARCHITECTURE.md](ARCHITECTURE.md)、[DATABASE.md](DATABASE.md)、[IPC.md](IPC.md)、[CONVENTIONS.md](CONVENTIONS.md)、[ROADMAP.md](ROADMAP.md) 和 [SECURITY.md](SECURITY.md)。

执行规则：

- 只处理本文件中第一个未完成且无外部阻塞的任务；满足完成标准并完成验证后才能勾选。
- B0–B3 期间禁止新增前端功能、视觉优化或交互重构。`src/` 只允许为 IPC 镜像、类型检查、安全修复和构建阻塞做最小改动。
- 前端现有实现是 legacy shell，不把旧的 `[x]` 前端条目继承为新前端验收结果。
- 未实现能力不得注册 stub、空返回、`todo!`、`unimplemented!` 或假进度；不支持能力必须返回稳定错误。
- 发现数据库、IPC、架构或安全文档冲突时，先停在文档/契约层解决，不用代码绕过规范。

## B0 后端审计与健康基线（复核中，完成证明已撤回）

### 0.1 已有基线（仅作证据，不等于完成）

- [x] `cargo fmt --check` 通过（2026-08-14）。
- [x] `cargo check` 通过（2026-08-14）。
- [x] `cargo test` 当前执行为绿色：67/67（2026-08-14）。覆盖事实：完整 Rust 测试套件成功执行；未覆盖事实：本次新增的 V1/V3 迁移失败回滚测试没有留存“故意注入缺陷→测试变红→恢复→测试变绿”证据，因此不能据此标记为“已验证”。
- [x] `npm.cmd run build` 通过（2026-08-14）；仅证明 TypeScript/Vite 可构建，不证明前端体验或后端完成。
- [x] `npm.cmd run tauri build` 通过两次、第二次 exit 0（2026-08-14 11:48/11:53），产出 MSI（5.20 MB）与 NSIS（3.01 MB）安装包；`Cargo.lock`/`package-lock.json` 均在位，构建可重复。
- [x] Android 环境准备已完成（2026-08-14）：工具链装于 `D:\Android\Sdk`（JDK17/cmdline-tools/platform-tools/android-35/build-tools/NDK27），Rust Android targets 已装，荣耀 PPG-AN00（Android 15）与黑鲨 SKW-A0（Android 9）可用于探查，固定 EPUB 样本已就绪（8 本）。这只解除环境阻塞，不代表 B1 门禁通过。

### 0.2 生产代码健康审计

- [x] 审计 `src-tauri/src` 生产代码：`panic!`/`todo!`/`unimplemented!`/`unreachable!` 0 处；由 `npm run audit:unwrap` 自动统计为 202 行（共 209 次调用），全部在 `#[cfg(test)]` 测试模块；生产 `.expect()` 仅 `lib.rs:94` 事件循环收口；锁 poisoning 均映射为错误（2026-08-14）。未统计 `src-tauri/target` 生成代码。
- [x] 审计 36 个 `#[tauri::command]`：绝大部分为薄适配；3 个缺口已记录修复任务（进度 Command 含业务逻辑、两个只读 Command 绕过 services 层、51 处小写 `internal error:` 前缀），见 [BACKEND_AUDIT.md](BACKEND_AUDIT.md) 缺口清单。
- [x] 审计 `lib.rs` 启动错误语义：setup 内目录/数据库/迁移失败均映射为带上下文错误传播，无启动期 panic 掩盖；唯一 `expect` 为 Tauri 事件循环收口（低风险，可选修复）。
- [x] 生成 Command 注册清单并三方比对：Rust 36 == IPC.md 36 == `tauri.ts` 36，命名一致；B2 搜索 Command 未注册（符合规定）；18 个系列/标签 wrapper 前端未调用（legacy shell 冻结，F2 接入）；发现并修复 IPC.md 缺少 `BOOK_RESOURCE_NOT_FOUND:` 行的文档缺口。
- [ ] 迁移实现清单已生成：V1/V2/V3 均使用 `BEGIN IMMEDIATE`+`COMMIT/ROLLBACK` 和版本门控；当前套件为绿色。未完成：V1/V3 新增回滚测试缺少变红自证，不能计入“失败回滚已验证”。接手 Agent 必须在各自目标迁移步骤注入会破坏事务回滚的缺陷，确认对应测试在目标步骤失败，再恢复实现并记录绿色结果。
- [x] 生成安全边界清单。辅助逻辑已测：ZIP 预算、路径规范化、MIME、CORS、错误脱敏以及桌面来源/租约相关单元测试；未测或不能据此证明：Android 稳定导入、干净 Android 构建、自动化设备流水线。桌面保存对话框与实际写入仅有历史人工运行态记录；`Range` 支持仍是 B1 缺口。legacy 前端/WebView 的资源请求方式不属于 B0 后端审计。

### 0.3 B0 完成标准

- [x] 形成 [BACKEND_AUDIT.md](BACKEND_AUDIT.md)，缺口清单含文件位置、风险等级、修复任务和验证命令。
- [x] 明确区分辅助逻辑（静态/单元自动验证）、桌面端人工运行态和 Android 设备探查；不再把环境就绪或等价调试路由当作 Android 门禁。
- [x] 已同步 README、ROADMAP、TODO、SECURITY 与 BACKEND_AUDIT 的当前结论，并保留 IPC.md 已修复的 `BOOK_RESOURCE_NOT_FOUND:` 文档记录。
- [ ] Android 平台工程可从干净、已审查的 scaffold 通过官方 `npm.cmd run tauri -- android build --debug --target aarch64` 构建；当前受 `.tauri/tauri-api` 目录冲突和本地 BuildTask 绕过污染阻塞，不能用手工复制 `.so` 的 APK 代替。
- [ ] 重新签发 B0 完成证明：先补齐 V1/V3 回滚测试变红/变绿证据并完成 Android 官方干净构建，再复核审计覆盖清单与文档结论；在此之前不得把 B0 标记为完成。

## B1 后端核心能力（当前阶段）

### 1. 来源、格式和协议

- [x] 来源指纹、`SourceLease`、独立 `Read + Seek` Reader 和 Android 私有缓存已落地。
- [x] 整本 EPUB 缓存已移除；ZIP 条目数、控制文件、单条目、总解压量和压缩比预算已统一。
- [x] `formats/capabilities.rs`、`registry.rs`、`active.rs` 和 EPUB 实现已建立；未支持格式返回 `FORMAT_NOT_SUPPORTED:`。
- [x] `services/` 已承载导入、打开、删除、重新定位、图片和格式用例；Command 保持薄适配。
- [ ] 对每条 `epub://` 资源请求补齐成功、来源失效、路径穿越、MIME、Range、CORS、超预算和并发 Reader 测试。
- [ ] 审计 `save_book_image` 的桌面保存、用户取消、非图片 MIME、来源失效和敏感信息不出前端；Android 明确返回稳定未支持错误。
- [ ] 补齐 Android SAF 选择、持久授权、重启校验、撤销授权和失效来源的静态测试。已有双机探查可作为复现线索，但不能替代静态/自动覆盖。
- [ ] **B1 Android 后端/平台首次实机门禁（未通过）：** 已观察到 SAF 选择、持久权限、重启、授权撤销、重新定位、私有缓存、FD 计数以及后端协议路由响应；但任意书仍可能间歇性导入卡住。待 B0 的官方干净构建关闭后，用双机直接验证 Rust/插件导入、来源读取、协议状态码/MIME/CORS/路径防护并定位导入卡住。legacy 前端/WebView 的 `fetch` 行为不作为本门禁或 B0 的否决条件。

### 2. 数据库、服务和错误契约

- [x] V1/V2/V3 迁移、来源缓存、设置、批注、系列、标签和关系基础已存在。
- [x] 批注服务已覆盖 CFI、长度、颜色、审计字段保留、缺失错误和删除级联。
- [ ] 审计全部仓储函数的参数化 SQL、事务边界、空结果语义和错误脱敏。
- [ ] 为系列、标签、设置和批注补齐并发更新、重复关系、删除级联、继承去重和失败回滚测试。
- [ ] 为所有公开 Command 固定稳定错误前缀，禁止返回原始 SQL、堆栈、完整路径或完整 Android URI。

### 3. B1 完成标准

- [ ] Rust 核心模块完成自动化测试：正常路径、错误路径、恶意输入、来源失效、权限失败和资源耗尽均有覆盖。
- [ ] `cargo fmt --check`、`cargo check`、完整 `cargo test` 通过；测试数量和新增覆盖范围写入本文件。
- [ ] IPC、模型、数据库和安全文档已同步，未留下未声明的接口或目录职责。

## B2 后端业务能力

### 4. 搜索与索引（真实后台实现）

- [ ] 设计并实现当前书/同系列搜索需要的后端任务模型：任务 ID、状态、进度、取消、错误、结果上限和来源失效。
- [ ] 使用 bundled SQLite FTS5 trigram 建立惰性增量索引；查询短于 3 个字符时使用参数化 `LIKE`。
- [ ] 索引按来源指纹失效，支持部分结果、手动重建和过期重建；禁止用前端数组或一次性整本 EPUB `Vec<u8>` 代替。
- [ ] 执行预算：单章节 8 MiB、单书 64 MiB、索引总量 2 GiB；所有计数使用溢出检查。
- [ ] 覆盖多卷、中日韩文本、同词多命中、跨章节结果、取消、来源不可用、损坏章节和资源超限测试。
- [ ] 注册并记录真实搜索 Command：`ensure_series_search_index`、`get_search_index_status`、`cancel_search_index`、`search_series`、`rebuild_search_index`；未实现前不得注册。
- [ ] 在 Android 真实设备验证索引取消、应用进程被系统终止后的恢复、低存储空间、大文件和来源失效行为。

### 5. 目录、系列、标签、设置和批注后端收口

- [ ] 固定目录/搜索所需的后端资源与错误契约；DOM/CFI 解析仍留给后端冻结后的 EPUB.js 前端阶段。
- [ ] 完成系列 CRUD、单系列归属、卷标、排序和关系事务。
- [ ] 完成标签组/标签 CRUD、书籍直接标签、系列继承标签、筛选查询和删除关系语义。
- [ ] 完成全局/单书阅读设置的持久化、逐字段覆盖、默认值和迁移回归。
- [ ] 完成批注数据契约的最终审计：纯文本、CFI、长度、颜色、重启恢复所需字段和删除级联。

### 6. B2 完成标准

- [ ] 所有后端业务能力都有真实服务实现、IPC 契约、数据库迁移（如需要）、错误语义和自动化测试。
- [ ] 搜索任务可取消、可查询、可重建，资源预算和来源失效行为可验证。
- [ ] 不存在“前端已接入但后端未实现”的 Command、假数据或临时本地状态替代品。

## B3 后端验证与契约冻结

- [ ] Windows 运行态回归：导入、封面、打开、资源链、删除、重新定位、进度、批注、设置、搜索、系列、标签和重启恢复。
- [ ] Android 静态链审计和 B1 首次实机来源链门禁完成；未通过时不得完成全平台 B3 冻结或开始 Android 前端功能接入。
- [ ] 运行 `cargo fmt --check`、`cargo check`、完整 `cargo test`、`npm.cmd run build` 和 `npm.cmd run tauri build`，记录版本、测试数量和已知警告。
- [ ] 完成文档审计：README、ARCHITECTURE、DATABASE、IPC、CONVENTIONS、ROADMAP、TODO、SECURITY 与实现一致。
- [ ] 建立后端契约冻结点：冻结 Command、模型、错误前缀、数据库字段、资源预算和来源状态语义。

## F1–F3 前端（B3 通过后才解锁）

以下任务在后端冻结前全部保持未开始：

- [ ] F1 重建应用壳层、导航、书架信息架构、加载/空/错状态；替换 legacy shell。
- [ ] F1 只消费冻结 IPC；不得在 React 解析 ZIP/XML/SQLite 或自行判断来源有效性。
- [ ] F2 接入阅读器、目录、搜索、批注、系列、标签、设置、来源重新定位和全屏等功能。
- [ ] F2 将 EPUB.js 生命周期、CFI 视口锚定、iframe 事件和交互状态集中在 `src/features/reader/engine/`。
- [ ] F2 在真实 Android 设备验证书架、阅读器、目录、搜索、批注、设置、图片查看和来源重新定位。
- [ ] F3 建立 Tailwind 视觉系统、响应式布局、可发现控件、键盘/触摸补充交互、深色模式和跨端细节。
- [ ] F3 完成 Windows/Linux/Android 运行态人工验收；Android 必须覆盖手势、窄屏、软键盘、性能、内存、耗电、系统/WebView 版本和发布候选回归；构建通过不等于体验完成。

## 后续扩展冻结说明

- P3 多格式和 P4 外部网盘均不属于当前执行看板；阅读器本体的 B0–B3、F1–F3 完成前不得启动。
- P3 固定顺序为：P3.0 多格式架构与 `ImportInspector` → P3.1 TXT → P3.2 CBZ/纯图片 ZIP → P3.3 PDF → P3.4 CBR → P3.5 通用 ZIP 分发包。
- ZIP 只作为分发容器或 CBZ 兼容图片归档，不增加 `BookFormat::Zip`；现有 `zip` crate 不代表通用 ZIP/漫画能力已经获批。
- P4 排在 P3.5 之后，只在路线图中保留方向；当前不新增远程 `source_kind`、账号/令牌 Schema、Provider Command、网络依赖或前端入口。
- 远程书籍来源与阅读进度/批注的跨设备同步是两项不同能力；后者未进入当前路线图实施范围。

## 历史记录

- 2026-08-14：撤回 B0 完成证明。保留桌面构建与 67/67 绿色执行事实，但 V1/V3 新增迁移回滚测试缺少变红自证，Android 官方构建也不能从干净 scaffold 稳定复现；两项均是 B0 缺口。Android 导入偶发卡住属于 B1 运行态缺口。前端 `fetch(epub://...)` 不属于 B0 后端判定。后续修改方向见 [BACKEND_AUDIT.md](BACKEND_AUDIT.md) 0.2.5、0.4 与缺口清单。
- Phase 1 Windows 桌面 EPUB 基线、来源重新定位和 CFI 恢复保留历史验收记录；Android 当前是代码链/构建复现性阻塞，不再错误标记为缺少 SDK/NDK/设备。
