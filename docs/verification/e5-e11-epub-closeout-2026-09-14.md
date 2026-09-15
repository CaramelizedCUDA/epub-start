# E5–E11 EPUB 云端收尾候选记录 — 2026-09-14

## 候选与结论

起点分支：`codex/e1-shelf-closeout`；起点 SHA：`c121d24f37c7196cf8efbce4a2c349c4d3a18ed6`。本次没有 Git 提交、推送或 PR 授权，交付形式为未提交的补丁。不存在可填写的“最终提交 SHA”。不能把 `main` 当起点，也不能将外部工作区的本地设计/ACL/assets 视为本候选内容。

本轮完成了一组可应用的前端修复和验证/交接资料；**不是 E5–E11 全部完成，也不是已通过合并门禁或正式签发的候选**。E5–E9 尚缺规定的生产构建和真实 UI/业务影响面验证；E10/E11 保持未完成。验证范围只由 `../VERIFICATION.md` 决定，本记录不另立降低门槛的规则。

只处理 EPUB。没有修改 Rust、SQLite schema、IPC、Command 注册、ACL/capabilities、依赖清单/锁文件、P3/P4、来源类型或跨设备同步；没有选择项目许可证。Android 图片导出保持现有明确未支持契约。保留现有视觉，不导入未批准原型。

## 实现子项与尚未关闭的边界

| 范围 | 本轮实现 | 不能据此推断 |
| --- | --- | --- |
| E5 生命周期 | EPUB 构造/受控请求、rendition 构造、30 秒超时清理、幂等销毁进入 `engine/lifecycle.ts`；定位事件和目录匹配进入 `engine/navigation.ts` | 不代表所有既有触摸/动画 DOM 操作都已迁出 `EpubReader`，也不代表第三方引擎真实销毁已验收 |
| E5 会话/恢复 | 按书串行保存；重开同一本书等待退出保存；进度读取失败不默认为无进度；首屏显示完成前不切换 rendition；初次滚动模式装配稳定器；隐藏/pagehide 提前冲刷；App 打开请求隔离、按书重新挂载 | pagehide 仅 best effort，不能保证原生进程立即终止时 IPC 已提交；窗口关闭/杀进程必须真实测试 |
| E6 书内搜索 | 通过 `Book.load` 顺序读取章节、不卸载显示中的共享 section；50 条预算、部分失败反馈、查询和会话双重失效保护；回车入口 | 仍是章节级搜索，不声称文本命中精确 CFI |
| E6 系列搜索 | 现有 IPC pipeline 移入 `seriesSearch.ts`；成员查询、任务创建、轮询及最终查询逐段隔离；只按实际取得的任务 ID 取消；取消/离页停止后续轮询；保留部分索引信息；href 经 App/Reader 传递给 EPUB.js | 本轮没有真实构建、取消、恢复 SQLite FTS 索引；50 条显示上限提示不等于完整容量门禁通过 |
| E7 批注 | 旧书写入回执不能在新书绘制；旧列表不能擦除较新批注；同书重排后的列表装配当前 rendition；改范围先撤销旧标记；旧标记/旧编辑回执隔离 | 实际高亮、定位、重启恢复、图片缩放/触摸返回/桌面保存仍未测；现有图片工具保留，不重做 |
| E8 设置 | Reader 与书架共用顺序队列；退出/切换 scope 冲刷待保存设置；清除覆盖等待旧写入并读取有效值后重排；预览尊重单书覆盖；迟到 UI 回执受会话代际保护 | 生产设置往返、窗口立即终止、多个应用进程同时写入未验证；队列不声称取消已发出的 IPC |
| E8 计时 | 避免旧回执覆盖新暂停意图；跳过过期的可见心跳；pagehide/pageshow 生命周期；失效句柄等待下一次真实前台活动重建 | 不补记未知时段；不代表 Android 锁屏/后台/WebView 生命周期或 SQLite 时长已通过 |
| E9 输入/反馈 | 父窗口与 rendition 按键接入；IME、系统组合键、已处理事件、编辑区/浮层保护；图片查看器 Escape 返回；补搜索反馈 | 没有以截图代替真实 UI smoke；触摸、软键盘、横屏、安全区、深色、无障碍完整矩阵未测 |

## 本轮实际执行的检查

最终补充离线组：**43/43 通过**，无取消或跳过。其中 Reader 25、计时 5、设置/按键/生命周期辅助 6、系列搜索 7。运行 Node 22.16.0、全局 TypeScript 5.8.3，实际被测的 store、hook 和适配函数是候选源码。

重要边界：这是单独的离线取证驱动，不是仓库的 `npm run build` 或正式 `npm run test:frontend -- --reader`。它使用受控 EPUB.js/DOM/reflow、IPC、React effect 和最小 Zustand 替身，以及相关模型类型投影。它不能证明真实 React/Zustand 组件、EPUB.js DOM、Tauri、SQLite 或 SAF。正式入口已接入新用例，但本环境未执行正式入口。

| 检查 | 结果 | 证据/限制 |
| --- | --- | --- |
| 候选离线逻辑组 | PASS，43/43 | 交接包 `evidence/candidate-offline-43-green.txt` |
| Reader 原版对照 | 5 通过、20 个目标断言失败 | `final-reader-red.txt`；对照使用原版 store 与候选测试；不是用编译失败充当变红 |
| 计时原版对照 | 5 个目标断言失败 | `offline-baseline-summary.txt` 中计时 5 项；相关 hook/测试未变，复用该范围的变红证据 |
| 辅助函数故障注入 | 6/6 目标断言变红 | `helper-red-green.json` 与逐项日志；只改隔离副本 |
| 系列搜索故障注入 | 7/7 目标断言变红 | `series-red-green.json`；一次不合格的类型错误注入另存日志，不计有效自证 |
| 正式前端构建 | BLOCKED，未执行 | 容器无法取得完整仓库依赖树；Git/包下载 DNS 不可用；没有把不完整目录中的失败当作产品构建失败 |
| 正式 Reader 测试入口 | BLOCKED，未执行 | 未取得仓库实际 npm 依赖；离线替身检查不能代替 |
| 真实 EPUB.js DOM / CFI | NOT_RUN | 有 Chromium，但无可启动的完整应用与真实 EPUB.js 依赖；未重造零高度 fixture 来冒充产品故障 |
| Tauri/SQLite / Android SAF | NOT_RUN，环境阻塞 | 无 Windows/Android 设备；Linux 无 cargo/rustc；无 adb |
| 原创 EPUB2/3 样本结构 | PASS，2 个 | ZIP CRC、mimetype 首项不压缩、XML/OPF 引用检查；未运行 EPUBCheck，未运行真实 Reader |
| Rust 审计/既有后端压力 | 未重复 | 本轮不改 Rust、模型、数据库或资源预算，按验证策略复用有效范围 |

43 项中有 37 项新增、1 项调整、5 项既有用例保持；新增/调整的 38 项均有原版对照或隔离故障注入的目标断言自证。**UI 接线不因此变成已自动验证**：App/BookShelf/ArchiveSearchPage/EpubReader 的真实组件交互和完整生产类型检查留给本地必跑项。

本次 GitHub 读取成功，但 Git/包下载失败；同一基线 SHA 查询到的 Actions runs 数为 0，没有可挪用的该提交 CI 产物。环境详情及时间在交接包 `environment.json`。这个环境障碍不应登记成产品缺陷。

## 补丁完整性口径

容器没有完整 Git checkout。完整读回的 App、ArchiveSearchPage、readerStore、useReadingActivity、原 Reader 测试均核对原始 Git blob；EpubReader、BookShelf、测试 runner、TODO 使用固定 SHA 的精确上下文片段形成补丁。

交接包记录每个原文件的 blob SHA 和补丁 SHA-256。云端可检查完整读回文件及片段上下文的补丁适用性；**这不等于对完整仓库执行过 `git apply --check`**。本地必须在指定基线的独立 worktree 对完整源码执行该命令，再运行正式构建/回归。片段核验用的未读区域填充物绝不进入补丁或产品文件。

## 复用证据，不改历史

`e5-reader-2026-09-08.md` 保留原结论。其 6 项逻辑回归作为本轮起点，其中首次显示/设置切换用例按新目标更新；旧浏览器 iframe 高度为 0 只说明当时入口阻塞，不能证明产品有缺陷，也不能证明恢复成功。

`e5-reader-cover-layout-2026-09-08.md` 的 EPUB3 封面识别、既有后端检查，以及未改动的普通重排图片约束证据只在原影响面内复用。本轮不改其 Rust/排版算法；但 Reader 初始化顺序有变化，因此必须补真实打开/排版/恢复，不把旧 build 或布局 fixture 当作本候选 CFI 证据。

B0–B4、E1–E4 的已完成历史仍按各自原范围保留。未改动的 libraryStore/后台契约证据有效；App 打开请求、书架设置和搜索跳转的受影响 UI 路径必须新测。旧双机启动、37 样本导入或旧签名副本不能替代当前同源码跨端验收。

## E10：同源码候选与本地场景

版本标识必须同时记录：本地审核提交 SHA、dirty 状态、补丁 SHA-256、锁文件 hash、Node/Rust/Tauri/WebView 版本、设备型号/OS/API、构建命令/变体、安装包 hash、样本 hash。未提交补丁身份为“基线 + 补丁”，不能冒写成新的 commit SHA。正式 E10 建议在审核后冻结的干净候选提交上构建；额外 Android assets 必须记录来源/hash，不借用旧 `.so`。

| 平台 | 本轮状态 | 接续环境 |
| --- | --- | --- |
| Windows | 业务 NOT_RUN；无 Windows 主机 | 独立 worktree、实际 Tauri/WebView2、隔离测试数据；先正式 build/Reader 回归再运行 |
| Linux | 业务 NOT_RUN；本容器缺 Rust/Tauri 构建条件 | 真实 Linux Tauri/WebKitGTK 环境，记录发行版/窗口系统；Node 逻辑运行不等于 Linux 应用通过 |
| Android 9 / API 28 | NOT_RUN；无设备/adb | 真机与实际 WebView/SAF；历史 SKW-A0 仅为既有取证设备记录 |
| Android 15 / API 35 | NOT_RUN；无设备/adb | 真机与实际 WebView/SAF；历史 PPG-AN00 仅为既有取证设备记录 |

下表每一项均套用同一候选和上述实际版本字段。本轮所有真实业务结果为 NOT_RUN；执行后逐项填写实际观察、证据路径、通过/失败/阻塞原因，不只填写“启动成功”。

| ID | 前置条件 | 动作 | 预期结果 |
| --- | --- | --- | --- |
| R1 开关书 | 原创 A/B EPUB 和实际完整 Reader；书架到打开路径可用 | 连续选择 A/B；加载中返回/重选；重复 5 次 | 最后一次打开意图生效；旧请求不换回 A，无旧批注/菜单/搜索残留 |
| R2 CFI/重排 | A 的第 2 章中部可见；记录第一行文字和真实 relocated CFI | 改字号/边距/主题、分页↔滚动、窗口缩放/全屏；正常返回后重开 | 按契约保持文本锚点；CFI 来自真实 DOM，不以页码相同代替；无封面/大图溢页回归 |
| R3 保存/重启 | 真实 SQLite；调试断点可观察 save/getReadingProgress | 翻页后立即返回并重开，再退出窗口/重启；另测系统终止 | 正常退出保存可读回且不被旧写覆盖；终止只承诺已经提交的进度，不虚构最后瞬间保存；失败可见 |
| S1 书内搜索 | A/B 含 ALPHA-SEARCH；网络/资源延迟可观察 | 输入后清空、换词、切书；选择命中；测试不含关键词 | 旧结果不回填；加载/空/部分失败/50 条上限提示明确；章节跳转不冒充精确 CFI |
| S2 系列索引 | 两个真实系列；至少一组足以跨多个轮询的样本 | 构建/取消、切换系列/范围、离页；重开后恢复；引入既定超限/部分样本 | 索引状态来自 SQLite；取消不伪造 ready/pending；部分结果/错误可读；旧轮询/查询不覆盖新范围；打开命中书及章节 |
| N1 批注 | 两书和一条真实选区；记录 book_id/CFI | 创建/改色/改文/删除；写入时切书；返回/重启；从批注列表跳转 | 按书隔离；无旧范围残留；真实高亮/位置恢复；数据库删除与 UI 一致 |
| I1 图片 | 封面及章中大图 | 放大、拖动/捏合、长按、返回、Escape；Windows 保存和取消；Android 触发导出 | 手势/返回不误翻页；桌面保存/取消真实；Android 明确不支持且不生成假成功文件 |
| P1 设置 | 全球默认与 A 单书覆盖不同 | 连续修改、切 scope、立即清除覆盖、立即退出重开；在书架再修改默认 | 旧保存不能复活已清覆盖；正文应用有效设置；单书继承语义和重排正确；失败不假报已保存 |
| T1 计时 | 真实可見 Reader 与 30 秒心跳；另备没有正文的失败打开 | 前台/失焦/锁屏/后台/返回、进程终止/重启；查看书架和足迹；独立删除历史 | 无正文不计时；不补记未知后台时段；失效句柄恢复；历史与阅读进度删除语义独立 |
| U1 键盘/触摸 | 正文 iframe 获焦；搜索框/批注/图片/设置浮层 | 方向键、中文 IME、Ctrl/Alt/Meta 组合键、Escape；触摸翻页/取消拖动 | 编辑/组合键不误翻页；浮层优先返回；正文键盘有效；实际触摸逻辑无退化 |
| U2 版式环境 | 每个平台同一本书 | 窄屏、横屏、软键盘弹收、安全区、系统/应用深色、全屏退出 | 控件可达、不遮住正文/输入；无明显跳位；无大幅视觉重做；无启动截图代替结果 |
| A1 来源异常 | 专用测试库，用户数据已备份 | Android SAF 取消/失效/重新定位/重启；导入失败重试；删除后刷新 | 按 E2 来源、级联和保留契约执行；没有真实 SAF 不填通过 |
| Q1 兼容/性能 | 固定样本清单、相同测量条件；干净候选 | 按既定 B3/E10 样本口径记录内存、交互延迟与 Android 耗电 | 原始读数/条件/版本可追溯；不把旧机数据或构建体积当当前运行态性能 |

最小影响面先跑 Windows 与至少一台 Android 的 R1–R3、S1/S2、N1/I1、P1/T1、U1/U2；另一台 Android 与 Linux、A1/Q1 在 E10 关闭前结清。Windows/Android 的启动截图只能附作环境信息。

原创新样本随交接包提供：`E5-A-epub3-reflow.epub` 与 `E5-B-epub2-reflow.epub`，各三章、每章 80 个唯一标记段落，含大图。它们只用于可复现的最小路径，不覆盖 EPUB 固定/混合版式、复杂出版 CSS、RTL/竖排或既定 37 本完整兼容样本。

## E11 承接

见 `../EPUB_RELEASE_HANDOFF_2026-09-14.md`。许可证、完整 E10、版本和静态/签名门禁、最终签名制品安装/启动/真实阅读恢复未结清前，不签“正式版完成”。本次没有生成、签名或安装正式制品，也没有索取凭据。

## 2026-09-15 本地接续：第一里程碑

### 候选身份与保护范围

- 原仓库为 `D:\epub_start`，本地及本轮复查的远端 `codex/e1-shelf-closeout` 均为 `c121d24f37c7196cf8efbce4a2c349c4d3a18ed6`。
- 接收目录为 `D:\epub_start-epub-closeout-20260914`，从该提交导出完整源码。此目录没有 `.git`，没有创建分支、提交、stash、合并或推送；不把源码副本描述为 Git 工作树。
- 云端补丁 SHA-256 为 `3a4aa87781f7ce32aab52dfd1d60067c5903cd4630e09f4ea68933d886732871`。21 个文件的补丁完整应用，9 个已有文件基线 blob 与 17 个完整新文件哈希匹配。Windows 全局 `core.autocrlf=true` 最初产生 CRLF，已仅将候选的 21 个文件恢复 LF 并核对哈希；未修改全局或原仓库配置。
- 本地输出根目录：`D:\epub-start-deliveries\epub-closeout-20260914-local-20260915`。其中 `delivery/` 保留原交付，`backup/` 保存 1,617 个文件、2,590,860,473 字节。源码、ACL 修改、设计草稿、Android assets、测试样本、既有验收资料和三个现有应用数据库目录均按源/目标清单与 SHA-256 核对。
- 备份未包含 `.git` 原目录、node_modules、Rust/Gradle 构建目录及 `target/frontend-tests`；Git refs 另保存在 bundle。四个 Android JNI 符号链接的目标字节与原目标路径一并保存，原链接未改。详细排除目录见输出中的 `backup-plan.json`，不能称整盘备份。

### 审阅发现与实际修复

首次正式构建在 `EpubReader.tsx` 的 `rendition.on/off('keydown', handleKey)` 出现 TS2345：项目 EPUB.js 声明接受 unknown 事件参数，而回调声明为 KeyboardEvent。

检查实际安装的 EPUB.js 0.3.93 源码同时发现，其 Contents 使用 passive DOM 监听器转发键盘事件；在转发回调中调用 preventDefault 无法取消默认滚动。仅改类型断言无法解决这条输入路径。

将正文键盘绑定集中到 `engine/keyboard.ts` 的 `installReaderKeyboard`：直接使用非 passive 文档监听器，在 rendered/relocated 时同步当前文档，避免重复注册并清理退役文档；清理后的迟到事件不能重新绑定。父窗口仍使用原有 KeyboardEvent 入口，组合键、IME、编辑区与浮层保护保持。未修改 EPUB.js 依赖、IPC、Rust、数据库、ACL 或视觉方案。

### 本地检查与证据

执行环境：Windows，Node 22.22.2、npm 10.9.7；在独立接收目录按现有锁文件执行 `npm.cmd ci --no-audit --no-fund`，未升级或增加依赖。

| 检查 | 结果 | 输出根目录下的证据 |
| --- | --- | --- |
| 原包逐文件完整性、完整基线 apply check | PASS，60 项包内校验，21 个补丁路径 | `candidate-identity.json`、`apply-check.log` |
| 首次正式 Reader 回归 | PASS，43/43，源码摘要 `43c05531f882` | `reader-initial.log` |
| 首次生产构建 | FAIL，两个 TS2345，已修复 | `build-initial.log` |
| 修复后正式生产构建 | PASS，TypeScript 与 Vite 均完成 | `build-final.log` |
| 修复后正式 Reader 回归 | PASS，45/45，源码摘要 `095038dcf430` | `reader-final.log` |
| 新增键盘测试故障发现能力 | 两项定向断言变红；恢复后 2/2 PASS | `keyboard-red-green/summary.json` 和对应日志 |

新增测试分别验证默认滚动可取消/单次绑定，以及退役文档与迟到事件不再触发。故障注入只修改隔离的已编译适配器：将 passive 改为 true、移除 disposed 防护，分别在目标断言失败，随后恢复原字节。候选生产代码未注入故意缺陷。

正式回归使用实际 Zustand 和 TypeScript；EPUB.js、DOM/reflow、高亮、IPC 与 React effect 仍有受控替身。新增键盘测试的文档派发同样是受控模型，不能声明浏览器、真实 Tauri、CFI 或 SQLite 已通过。

复用：云端 38 项新增/调整用例的定向变红证据，原断言及对应逻辑未因本地键盘绑定修复失效；本轮在正式入口重跑取得 43 项绿色结果后增加两项。`e5-reader-cover-layout-2026-09-08.md` 的未变化 Rust 封面提取及后端证据继续在原范围有效；本轮没有重跑 Rust/unwrap/预算或无关 libraryStore 用例。原云端和历史记录结论保持。

### 未执行与下一步

第一里程碑只完成独立接收、代码审阅与自动检查，尚未通过合并门禁。未启动真实 Reader，未构建或安装 Android，未执行新候选的 Windows/Linux/Android 运行验收。没有把设备未测写成设备阻塞。

下一步先核实隔离应用的实际数据路径，再从本候选启动 Windows Tauri；可参考原工作区 `target/e5-manual/desktop.config.json` 的独立标识，但不能仅凭配置文件认定隔离已生效。优先 R1–R3 的快速切书、真实正文 CFI/重排、退出与重启恢复，并验证 U1 的 iframe 默认滚动取消与输入保护；共享生命周期按验证策略补至少一台 Android 相关路径。之后承接 E6–E9 的真实消费及 E10 全矩阵。签名、许可证与正式发布仍归 E11。

## 2026-09-15 本地续推：代码与两端构建候选

### 本轮范围与身份

用户在首次手动验收失败后明确改为先完成代码与自动检查，临近发行再集中进行交付测试，并确认 Windows、Android 都交付。此次按该决定推进，运行态检查延期由 E10/E11 承接，不能将其替换为通过。上节“下一步”是第一里程碑时的计划，已由本节接续。

候选仍为 `c121d24f37c7196cf8efbce4a2c349c4d3a18ed6` 加未提交补丁，代码在 `D:\epub_start-epub-closeout-20260914`；标识 `20260915-code-ready-1`，声明版本 `0.1.0`。没有 Git 分支操作、提交、推送、标签或正式发布。成果和日志位于原输出根目录下的 `code-ready-20260915`，补丁与源码身份以 `manifest.json` 为准。

### 原始失败、修复与证据边界

首次用户验收结果保留 **FAIL**：翻页后文字跨页；切换滚动后全白，不能继续。其它验收项为 **NOT_RUN**。

1. 白屏：实际 WebView 异常 `views.all is not a function or its return value is not iterable` 定位到 `imageInteractions`。新 rendition 的 manager 尚未启动，`views()` 返回数组。`readerStore` 现在在流式切换期间保持 loading 至 display/重排/批注恢复结束，失败保存真实错误并在 finally 清除 loading；图片和高亮绑定通过 `getContents()` 读取，销毁后的回调不能再绑定。
2. 跨页：实际 1200px 双页容器的 EPUB.js 每页步长 600px，body 两侧各 16px 边距被覆盖后实际列距 616px，导致翻页逐步偏移。`reflow` 保留 EPUB.js 控制的列边距。
3. 此后将组件中的 EPUB.js 翻页容器选择、跟手、回弹、动画与销毁迁入 `engine/pageTurn.ts`。控制器绑定当前 rendition 的容器，采用其 page delta；退役控制器和迟到动画不能操作后来打开的书。React 保留交互显示状态和调用。

现场证据在输出根目录 `manual-failure-01`。`scroll-to-pages-before-fix.json`/`console-before-fix.txt` 保留白屏复现；`actual-column-origins-before.json` 与 `actual-column-origins-after.json` 记录 616px → 600px 列距；`next-four-pages-after.json` 记录修复后四次向前翻页。用户中断前命令已落盘的 `pages-to-scroll-after.json` 还包含向后翻页与分页到滚动的非空正文、loading=false、零捕获异常。

这些是当时修复的局部 Windows 开发态证据，只复用于未变化的列边距与空 rendition 故障判断。后来迁移了手势控制器，因此不能当作当前最终源码的完整手势或两端验收。真实 CFI 重启恢复、反向模式切换全流程和其它用户验收项仍未完成；本轮不再启动程序或安装设备。现场数据库/书籍等私有诊断资料不放入源码或公开交接包。

### 自动检查与新测试有效性

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript/Vite 生产构建 | PASS | 两端正常构建日志中的前端构建步骤 |
| `npm.cmd run test:frontend -- --reader` | 50/50 PASS，源码摘要 `19f414647410` | 本轮工具控制台；没有另存完整原始回归日志，勿与第一里程碑的 45 项日志混称 |
| 新增 5 项目标故障注入与恢复 | 5 项定向断言变红，恢复后 5 项通过 | `regression-red-green-v2/summary.json` 和对应 red/green 日志 |
| Windows x64 普通 release | PASS，无 `b3-diagnostics`，未生成安装器 | `windows-release-build.log` |
| Android aarch64 普通 release | PASS，无 `b3-diagnostics` | `android-release-build-isolated.log` |
| arm64 APK/AAB 与完整 lint | PASS，lint 0 error、31 warning、1 hint | `android-arm64-package-lint-offline.log`、`android-lint.xml/html/txt` |
| Android release 静态审计 | **FAIL，仅前端资源增幅超限** | `android-static-audit.log`，详见下一节 |

5 项新增用例分别针对切换期间提前解除 loading、替换失败被吞、忽略 EPUB.js page delta、退役控制器复活及 RTL 错误采用横向动画。定向故障只注入编译后的隔离副本，目标测试确实触发断言；恢复副本后通过，未修改生产源码。第一次故障验证因副本找不到 Zustand 依赖而未到达断言，该日志不算红证据；补齐副本的 NODE_PATH 后在 `regression-red-green-v2` 获得有效证据。

这些逻辑测试的 EPUB.js/DOM/IPC 边界仍有替身，不证明真实排版、CFI、数据库或 SAF。前两轮键盘及云端定向变红证据在未改断言和对应逻辑范围复用；历史 Rust、SQLite 压力、来源与封面提取未改，复用原范围证据。本轮没有 Rust/IPC/Schema/锁文件语义变化，不重复 Rust 全量测试或 unwrap 统计。

### 构建路径及实际环境问题

工具链：Node 22.22.2、npm 10.9.7、Rust 1.97.1、JDK 17.0.20、Gradle 8.14.3、AGP 8.11.0、NDK 27.3.13750724、Tauri 2.11.5。前端、npm/Cargo 清单与锁文件未升级。Windows 用原有可再生成 Cargo 缓存执行 `npm.cmd run tauri -- build --no-bundle`。

Android 第一次共享旧 Cargo target 时，构建脚本缓存未为新项目生成 `TauriActivity.kt`，Kotlin 编译失败；另有 C:/D: 混合根路径造成增量编译错误。转为候选自己的 `src-tauri/target`，以本轮新源码运行 `npm.cmd run tauri -- android build --target aarch64 --ci` 后成功；仅以进程级设置关闭 Kotlin incremental 并使用 in-process 编译。失败日志保留为 `android-release-build.log`，不能当作最终构建结果。

随后为既有审计路径生成 arm64 命名变体并执行完整 lint。前置条件是上一条正常 Tauri CLI 已在同一轮完成当前源码的 arm64 编译与原生库同步；仅在此前提下从 `src-tauri/gen/android` 执行：

```powershell
.\gradlew.bat :app:assembleArm64Release :app:bundleArm64Release :app:lintArm64Release `
  -x :app:rustBuildArm64Release --offline `
  '-Pkotlin.incremental=false' '-Pkotlin.compiler.execution.strategy=in-process' `
  -I 'D:\epub-start-deliveries\epub-closeout-20260914-local-20260915\code-ready-20260915\existing-test-maven.init.gradle'
if ($LASTEXITCODE -ne 0) { throw 'Android packaging/lint failed' }
```

不得在干净构建中跳过 Rust hook。此次没有复制旧库或旧 dist。PowerShell 首次未引用 `-P` 参数导致任务解析失败，之后离线 lint 缺已存在版本的 JUnit/Hamcrest；均保留失败日志。最终临时 Maven 初始化文件只路由本机已有 `junit:4.13.2`、`hamcrest-core:1.3`、`hamcrest-parent:1.3`，5 个 jar/pom 的摘要与 Maven Central 官方摘要核对匹配，证据 `maven-cache-checksums.json`。未新增依赖或关闭 lint。

### 当前制品与资源审计失败

| 项目 | 实际值 |
| --- | --- |
| Windows EXE | 12,683,776 字节，ProductVersion 0.1.0，Authenticode `NotSigned` |
| Android APK | 11,732,704 字节，相对基线 +1.51% |
| Android AAB | 11,550,546 字节，相对基线 +1.63% |
| Cargo release 原生库 | 13,302,040 字节，+2.01% |
| 打包后原生库 | 9,126,880 字节，+1.96% |
| 前端 dist | 726,031 字节，4 文件，0.692 MiB，**+21.89%，超过 10% 增幅限制** |
| APK/AAB ABI 与 ELF | 仅 arm64-v8a，AArch64，禁止 ELF 节不存在 |
| APK 实际版本 | `com.epubstart.reader`，versionName 0.1.0、versionCode 1000、minSdk 24、targetSdk 36 |

基线为 `release-baselines/android-arm64-release.json` 的 2026-08-22 记录。前端仍低于 2 MiB 绝对上限，但相对增长门禁失败；这是实际失败，不是未测。本轮没有放宽阈值或重设基线。代码编译、回归及 lint 已过，发行准备仍须处理这一项并对最终制品复查。当前未签名 APK/AAB 不作为已可安装验收的包。

### 接续与停止点

交付更新源码、对基线可重放的补丁、构建文件、hash 清单与 PowerShell 合并步骤；保留旧里程碑和原工作区。实际保护复核、补丁重放和逐文件比对结果记入交接包 manifest。

下一节点是发行准备：先解决资源增幅，再冻结待发行源码、版本与制品；按用户安排集中执行 Windows 与 Android 交付测试，最终签名后再做安装/升级/阅读恢复 smoke。Linux 未在本轮首版目标内，仍未测，原 E10 全平台条件没有因此改为通过。许可证待项目决定，不索取签名秘密，不创建正式发布。E5–E11 原复选框保留原运行态与阶段含义；新的代码收口清单见 TODO 顶部及 [首版代码交接](../EPUB_CODE_READY_2026-09-15.md)。

## 2026-09-15 资源优化：测试暂缓

用户在确定双端测试候选期间要求先优化资源，再考虑测试。本轮据此暂停候选签定与回归/运行态验收，先解决已记录的前端资源增幅失败。标识 `20260915-resource-optimized-1`，来源是已逐项验证 224 个源文件的 `20260915-code-ready-1` 加下述五个文件的资源优化；原仓库业务源码未合并，版本仍为 0.1.0。

### 影响面与实现

- `vite.config.ts` 与 `engine/browserXml.ts`：将 EPUB.js 引入的非浏览器 XML 兼容实现绑定为 WebView 原生 DOMParser/XMLSerializer。Reader 原本就在 `parseEpubResponse` 使用原生 DOMParser；EPUB.js 内部调用均未强制使用其非浏览器解析器，支持的 WebView 也不走 Trident/IE 序列化分支。保留 XML/XHTML/HTML、CFI、分页/滚动与内容资源能力；不为 Node/SSR/IE 提供兼容承诺。没有编辑 node_modules。
- `src/lib/window.ts`、`BookShelf.tsx` 与 `engine/reflow.ts`：只封装当前使用的全屏查询、切换和主窗口 resize 事件，替代整个 Window 类的打包。调用现有 `plugin:window|is_fullscreen` / `set_fullscreen`，保留错误传播；Tauri 2.11.5 的后端实现确认省略 label 取发起调用的当前窗口。resize 仍通过官方 event API 发往现有 `main` 窗口，消费者原本就不使用 PhysicalSize 载荷。

这改变了 XML 兼容代码的打包边界与窗口 API 接入边界。后续必须关注真实正文/章节解析、序列化、全屏/退出全屏和 resize 后重排；构建和源码核对不能替代这些运行验证。未新增依赖、Rust/IPC/Schema、权限或资源预算变更；CSS 产物的 SHA-256 与优化前相同。测试按用户安排延期，既有 E5–E11 标记不补勾。

### 构建及资源结果

| 分项 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 前端 dist | 726,031 B | 652,245 B |
| EPUB.js chunk | 350,071 B | 290,232 B |
| 应用 JS chunk | 333,038 B | 319,091 B |
| CSS | 42,416 B | 42,416 B |
| HTML | 506 B | 506 B |
| 相对原 dist 基线增幅 | 21.89%，FAIL | 9.50%，PASS |
| Android arm64 APK | 11,732,704 B | 11,709,272 B |
| Android arm64 AAB | 11,550,546 B | 11,505,548 B |
| Cargo release 原生库 | 13,302,040 B | 13,278,544 B |
| APK 内原生库 | 9,126,880 B | 9,103,456 B |

前端减少 73,786 B（10.16%）。原基线 595,644 B、相对上限 10%、绝对上限 2 MiB 均未改变；相对门禁剩余 2,963 B，后续源码变更须重新核对，不按“已经优化过”豁免预算。

- PASS：`npm.cmd run build`（TypeScript 与 Vite）。
- PASS：Windows x64 `tauri build --no-bundle` 与 Android aarch64 正常 Tauri 构建；都使用本轮相同 dist。临时配置仅跳过已完成的前端重建，不改变产品 ID/权限。Windows 未生成安装器。
- PASS：在同一轮正常 Android 构建重新编译并同步原生库后，生成 arm64 命名 APK/AAB，再执行 `npm.cmd run audit:android-release`。大小、工具链、ABI、ELF、禁止载荷与前端相对增幅全部通过；无新签名。
- PASS：最终 bundle 已无非浏览器 XML 实现和整个 Window 类的标志，保留原生 XML、全屏查询/设置、resize 事件引用，未包含诊断面板。
- 复用：代码收口阶段的完整 Android lint（0 error、31 warning、1 hint），原生/Kotlin/Manifest/权限/依赖未变；本轮打包正常执行 lintVital。原 50 项 Reader 结果仅保留其原范围，不宣称本轮重新执行。
- NOT_RUN：本轮自动回归、Windows/Android 应用启动、安装、真实 XML/CFI/重排/全屏/持久化/SAF/性能验收，按用户要求暂缓。没有把未测写成通过。

### 制品与后续

输出目录 `D:\epub-start-deliveries\epub-closeout-20260914-local-20260915\resource-optimization-20260915`。其中 manifest、源码包、差异补丁、构建日志及新未签名制品用于后续接续；本轮不将其标作正式版或已签定的双端测试候选。

此前 `test-candidate-20260915` 的 Windows 隔离包与 Android profile 打包已完成（Android 在中断被处理前完成）；均未运行/安装，STATUS.json 明确其为优化前快照且候选准备已暂停。后续测试应从本次优化后的源码重新确定相应制品，不能继续用优化前包验证新代码。

## 2026-09-15 PC / Android 双线真实验收

用户已明确恢复并要求执行双线验收。当前候选 `20260915-resource-optimized-1`，版本0.1.0；基础提交 `c121d24f37c7196cf8efbce4a2c349c4d3a18ed6`。**本轮结论 FAIL，E5/E9相关问题尚未结清，E10/E11不能关闭。** 上节“测试暂缓”属于此前交接快照。

- 同源身份：开始核对226源码文件、4个dist文件及优化制品；Windows构建自动更新的Cargo换行与生成schema已留证并恢复，更新本节/TODO前226文件再次全部匹配manifest。本轮没有业务代码修复。
- PC：Windows 11 build26100 / WebView2 152；新隔离release EXE，标识 `com.epubstart.acceptance20260915`，SHA-256 `aaf1f3e14f52b40d07edc7525bc32911dc942fd9e8a325987b29b2e3a0e71cc7`。
- Android：HONOR PPG-AN00，Android15/API35 / WebView151.0.7922.200；新隔离arm64 profile APK，标识 `com.epubstart.reader.profile`，SHA-256 `52e5b03315d08d10f7f425205076303f7f9a189d596e8d7a7322056d944f8182`。其native与前端载荷和优化release相同；profile/test签名不替代最终release验收。

| 结果 | 实际范围 |
| --- | --- |
| FAIL：两端R2 | 固定字号和视口，分页→滚动→分页后原CFI字符移出视口；多次往返继续偏移。真实iframe Range证据，不以页码判断。 |
| FAIL：Android R1 | 加载中关闭A再开B，重复捕获displayOptions/navigation/package未定义异常；已记录真实bundle调用栈。 |
| FAIL：Android U2 | 800×361横屏设置按钮超出底栏约44.88px，下一页/目录重叠约10px。 |
| PASS：本轮自动回归 | Reader 50/50，source digest `19f414647410`；不代替真实设备证据。 |
| PASS：已测功能子项 | 两端真实正文/导航、基本搜索、批注生命周期、设置覆盖继承、保存及已提交位置重启恢复、前后台计时；PC键盘与图像保存/取消，Android SAF导入/取消与实际触摸/图片手势。详情逐子项列出，未测边界未写为整组通过。 |
| PASS：PC补充基础阅读 | 用户加入的6本EPUB各打开正文并翻一页；不等同整本兼容性或性能验收。 |
| NOT_RUN / 单项测试途径BLOCKED | 搜索部分/超限/长任务取消、完整来源失效/重定位/失败重试/删除、锁屏/独立删除历史、完整输入/布局矩阵、系列/标签完整写入、旧Android/Linux及Q1；Android尝试的撤权命令被现有应用ACL拒绝，未绕过或改权限。 |

集中报告与复现证据：[双线验收结果](../../../epub-start-deliveries/epub-closeout-20260914-local-20260915/dual-acceptance-20260915/双线验收结果.md)，含两端详细表、实测制品和证据哈希。复用同源优化release资源预算/ABI/ELF与未受影响的后端压力证据；本次没有扩大Rust/unwrap检查或重复无关破坏性实验。未比较优化前行为，不声称缺陷由资源优化引入。

原仓库已有改动和正式应用数据保留；PC测试进程已结束、8本隔离书库保留，Android隔离书库保留且旋转恢复原值。仅同步TODO、本节和原仓库当前文档入口，未提交、合并、发布或正式签发。修复以上真实失败后按影响面复测，未测矩阵归E10承接。


## 2026-09-16 双线修复与收敛判断

用户授权修复首轮验收问题；讨论重构后，同意完成本轮新包复测，以真实失败是否收敛决定下一步。最终 `20260916-dual-fix-2` 为基线 `c121d24f37c7196cf8efbce4a2c349c4d3a18ed6` 加独立副本改动，未提交/合并。

- 生命周期退休、取消和队列清退；工具栏容器布局；单字符锚点及导航缓存尝试；对应回归测试。没有修改 Rust 业务、IPC、Schema、依赖、安全或资源门槛。
- 正式 Reader 65/65、类型检查、前端及双平台生产编译、新 Android APK/AAB 静态审计通过。前端 654,755 B，相对原基线 +9.92%。新增行为以冻结/中间源码对照证明目标断言失败；自动 PASS 不代表真实位置通过。
- PC / HONOR Android 15 快速开关书和工具栏所测项通过。PC 正常返回/重启、已提交位置强制终止后恢复，Android 竖屏恢复通过。
- **最终 FAIL**：PC 模式往返原 p036:206 在 1200px 视口中 x=1337；Android 稳定字号调整后首字 x=-288.25，旋转后原字 x=2012；横屏 800×361 / 21px 已提交 p039:0 后重启到 p036:67，保存字 x=3007。R2 与横屏 R3 不能关闭。
- 候选 1 的位置 PASS 与候选 2 的导航 PASS 不能合并成整体通过。候选 2 修复尝试保留供审阅及重现；按本轮用户确认停止追加补丁，建议先设计 Reader 会话/排版操作/位置目标的局部重构。尚未实施重构。
- 原 PC 四个既有数据库哈希不变，隔离书库 8 本全部保留；Android profile 更新保留书库、正式包保留。旧 Android / Linux、完整语料、性能耗电及之前未测阶段边界不扩跑、不补勾。

最终 [集中报告与复现证据](../../../epub-start-deliveries/epub-closeout-20260914-local-20260915/dual-fix-20260915/修复与复测结果.md)、[源码/制品/补丁身份清单](../../../epub-start-deliveries/epub-closeout-20260914-local-20260915/dual-fix-20260915/manifest.json)。Android 使用隔离测试签名 profile，release APK 未签名；Windows 为隔离验收 EXE。不是正式发行或完整 E10/E11 验收。


### 2026-09-16 用户调整首版验收范围（覆盖上一节的阻断与重构建议）

本轮收尾时用户明确：首版需要安全正常导入 EPUB，并在用户确定的舒服排版下正常阅读全文；改字号/换排版后的阅读位置变化可以接受。精确保位后置，横屏重启回退保留为已知体验问题，暂不据此启动重构。上一节所有坐标、保存值和自动/实测结果保留；原精确保位 FAIL 是历史测量，不再作为当前首版阻断。

本轮开关书/工具栏修复在所测范围通过。下一步优先补固定排版全书连续阅读与内容完整性检查；当前证据仅覆盖所列导入、打开、翻页等子项，没有完整逐页走完所有测试书，不能声明完整首版发行验收通过。精确保位变更也不能因用户接受限制而宣称已修复。Reader 重构暂缓，无新依赖、契约或数据变更。


### 2026-09-16 用户确认结束本轮

用户说明先前版本在实际使用中基本能满足安全导入和固定舒服排版阅读全文，并明确要求准备收尾。按此结束本轮，不再追加全书测试或重构。上文全书逐页覆盖不足保留为证据边界，不作为继续扩测要求；已知位置体验限制保留，不虚构已修好。源码、补丁、制品、证据已归档；没有 Git 写操作、正式签发或发布。
