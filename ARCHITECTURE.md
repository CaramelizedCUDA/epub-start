# 架构蓝图与职责边界

本文件规定模块职责和目录位置。持久化字段以 [DATABASE.md](DATABASE.md) 为准，公开 Command 契约以 [IPC.md](IPC.md) 为准，依赖限制以 [README.md](README.md) 为准。

## 开发阶段边界

项目采用 Backend First。B0–B3 阶段以 `src-tauri/`、SQLite、平台适配、协议和 IPC 为主；`src/` 仅保留可运行的 legacy shell，并允许为契约同步、类型检查、安全修复和构建阻塞做最小改动。不得在后端阶段新增 React 功能、视觉方案或交互优化。

后端通过 [ROADMAP.md](ROADMAP.md) 的 B3 门禁后，建立 IPC/模型/错误语义/资源预算的契约冻结点，才进入前端 F1–F3。前端重建必须以冻结契约为输入；任何后端语义变化都必须重新走 [IPC.md](IPC.md)、模型、测试和 TODO 审计流程。

## 目录结构

```text
src/
  components/                 # 可复用的纯 UI 组件
  features/
    library/                  # 书架、导入、失联书籍重新定位
    reader/                   # EPUB.js 初始化、Rendition、CFI 翻页
  stores/                     # Zustand 状态仓库
  lib/tauri.ts                # 类型化 invoke 封装及错误转换
  types/
    models.ts                 # 与 Rust serde 模型一一对应
    ipc.ts                    # Command 入参和返回类型

src-tauri/src/
  commands/                   # #[tauri::command] 的薄适配层
  db/                         # models.rs、migrations.rs、repository.rs
  platform/                   # Android SAF 与桌面来源校验
  source/                     # 指纹、受控 Reader、Android 私有来源缓存与真实 LRU
  formats/                    # 格式能力、薄分派与 EPUB 实现
  protocol/                   # 资源 URI 路由与受控响应，不解析格式
  services/                   # 导入、打开、删除、封面缓存、批注、设置、目录管理与索引等用例编排
  resource_budget.rs          # 来源、封面和搜索等可重建数据的统一硬预算
  lib.rs                      # 应用状态、插件和 Command 注册
src-tauri/gen/android/app/src/main/java/com/epubstart/reader/
  EpubSafPlugin.kt            # 项目自有 Tauri Android SAF 插件
```

新文件必须放入最小且匹配的目录。不得把数据库 SQL 放进 Command、不得把 EPUB 解析塞进 React 组件、不得创建另一个未声明的共享模型来源。

## Rust 后端：`src-tauri/`

允许：文件 I/O、ZIP 解压和流式读取、`container.xml`/OPF/NCX 解析、SQLite CRUD、来源权限校验、后台任务、`epub://` 协议、Tauri Commands。

禁止：UI 渲染、DOM 操作、React 状态或 EPUB.js `Rendition` 调用。Command 是薄层：解析参数、调用领域服务、将错误转换为 `String`；业务逻辑归属 `db/`、`source/`、`formats/`、`services/` 或 `platform/`。

所有 IPC 模型使用 `#[derive(Serialize, Deserialize)]`，所有 Command 返回 `Result<T, String>`。不可在业务逻辑或 Command 中 `panic`、`unwrap`、`expect`。

## React 前端：`src/`

允许：函数组件、Hooks、Tailwind UI、Zustand 状态、调用类型化 IPC、EPUB.js XHTML/CSS 渲染、CFI 定位、高亮交互和错误提示。

禁止：Node `fs`、直接读取主机路径或 `content://` URI、ZIP/XML/SQLite 解析、大型文件内存密集计算。前端永远不得自行推断来源是否有效，必须消费 Rust 返回的状态和错误。

## 数据流与错误处理

```text
React UI -> lib/tauri.ts -> invoke(command, args) -> Rust command
Rust command -> services -> db/source/formats/platform -> Result<T, String> -> React store/UI
```

`invoke` 的拒绝结果必须由 `src/lib/tauri.ts` 转为可识别错误。前端遇到 `BOOK_SOURCE_UNAVAILABLE:` 时显示“文件已移动，请重新选择”，并优先通过 `relocate_book` 请求重新关联；通用 `import_book` 也必须只在 `missing/error` 记录中按指纹恢复唯一匹配，禁止合并可用副本或在多候选时猜测。

任何修改 `#[tauri::command]` 参数或返回值的变更，必须在同一变更中更新 [IPC.md](IPC.md)、`src/types/models.ts`、`src/types/ipc.ts`、`src/lib/tauri.ts` 及调用点。

## 来源与资源协议

`books.source_locator` 是受 Rust 管理的统一来源定位符：桌面端为绝对路径，Android 为 `content://` URI。导入与打开前均由 Rust 校验：

- 桌面端检查文件存在性、可读性、大小、修改时间，并在可行时比较 EPUB package identifier。
- Android 通过项目自有 `EpubSafPlugin.kt` 以 `ACTION_OPEN_DOCUMENT` 获得 URI。Intent 必须包含 `CATEGORY_OPENABLE`、`FLAG_GRANT_READ_URI_PERMISSION` 与 `FLAG_GRANT_PERSISTABLE_URI_PERMISSION`；结果回调必须先成功调用 `takePersistableUriPermission`，随后才可把 URI 返回 Rust 或写入数据库。用户取消返回空选择，不视为错误。
- Android 插件持有 Tauri 提供的 Activity 上下文，负责 SAF 文件选择、持久权限查询、`ContentResolver` 元数据查询和只读文件描述符获取。Rust 的 `platform/` 通过 Tauri 移动插件句柄调用它；Command 与 protocol 层不得直接调用 Kotlin、JNI 或 `ContentResolver`。
- `content://` 来源必须通过文件描述符或字节流进入 Rust。EPUB ZIP、`container.xml`、OPF 和封面仍由 Rust 解析；禁止将 URI 传给 `std::fs`、`Path` 或 EPUB.js，禁止通过 JSON 在 Kotlin 与 Rust 之间复制整本 EPUB。
- SAF Provider 可能不提供文件大小或修改时间。不可获得的值使用数据库约定的 `0`，不得用当前时间伪造；重新定位规则以 [DATABASE.md](DATABASE.md) 为准。
- 重启后 `open_book` 必须重新验证持久读取权限。授权撤销、Provider 不可访问或文件已删除时，按来源失效处理。
- 校验失败时，Rust 把书籍状态更新为 `missing`，再返回 `BOOK_SOURCE_UNAVAILABLE:` 错误；解析异常则更新为 `error`。

EPUB 内部资源的逻辑地址为 `book/{book_id}/{entry_path}`：Windows WebView2 通过 `http://epub.localhost/book/{book_id}/{entry_path}` 访问，Linux/Android 使用 `epub://localhost/book/{book_id}/{entry_path}`。URL 选择属于 `platform::epub_root_url` 的平台职责。协议处理器在 Rust 中根据已验证来源打开 ZIP，并返回对应 XHTML、CSS、图片或字体的正确 MIME 响应。`entry_path` 必须进行规范化并拒绝路径穿越。封面缓存可由同一受控资源机制暴露。

`asset://` 只可用于已授权的普通本地缓存文件；不能替代 `epub://`，也不能把 EPUB ZIP 内路径直接映射到宿主文件系统。

当前来源架构只承诺桌面绝对路径和 Android `content://` URI。P4 外部网盘解锁前，不新增远程来源枚举、Provider 层、账号/凭据模块或网络 Reader，也不为未选型的远程协议提前重构 `SourceLease`。未来远程来源应优先评估“Provider 下载到应用受控缓存，再复用现有 Reader/格式/协议链”；若选择远程 Range/流式读取，必须另行证明随机 ZIP 访问、取消、重试和资源预算可控。

## 制品与运行时存储边界

Android 体积必须分层测量，不能用系统设置页的单一数字替代：构建/发布流程负责 APK/AAB、Rust 原生库与前端 `dist`；Android 系统负责安装解包和运行时优化；应用后端负责数据库、来源缓存、封面与搜索索引。制品瘦身不得通过删除用户数据或降低 ZIP 安全预算实现，缓存治理也不能掩盖发布包携带调试符号、测试 EPUB 或预置缓存的问题。

- `source/` 是来源缓存生命周期的唯一负责人：写入采用临时文件加原子替换，命中以单调时间更新 `source_cache_entries.last_accessed_at`，淘汰按持久化真实 LRU，并在整个 `SourceLease` 生命周期内保护在用文件。启动时删除临时/孤儿文件、清除缺失或大小不符的元数据，并重新执行预算。
- `db/` 只持久化来源缓存元数据；B2 复用 `source_cache_entries.cache_size_bytes` 与 `last_accessed_at`，其中大小取最终文件的真实 metadata。该实现不需要新迁移，V2 保持不可改写；未来字段缺口仍只能追加迁移。
- `CoverCache` 是封面缓存的唯一维护 seam：候选使用临时文件、flush 与原子 rename，导入预算检查同时保护候选和旧封面；数据库写入失败清理候选，成功后才清理被替换封面。启动时事务化清除缺失/越界路径并删除目录内孤儿，删书也只能通过该 seam 清理。封面淘汰按 `books.updated_at, books.id` 确定顺序；前端直接读取 asset 不会回到 Rust，因此不得把它描述为可观测的“封面命中 LRU”。
- B2 已实施：来源缓存软/硬上限 256/512 MiB，封面缓存软/硬上限 64/128 MiB，搜索索引 UTF-8 文本字节账面硬上限 256 MiB；`resource_budget.rs` 冻结合计硬上限 896 MiB，不超过 1 GiB。同系列后台索引由任务注册表保证最多一个活动任务，错误状态清理、FTS 重建和状态更新使用单一事务。达到硬上限且无法安全淘汰时返回 `BOOK_RESOURCE_LIMIT_EXCEEDED:`，不得删除活动租约、数据库或用户明确保存的内容。辅助逻辑与重启恢复已有变红自证；Android 低存储、长期压力、page/WAL 与真实淘汰占用仍按延期验收包阻塞。
- 构建侧门禁为 arm64 release APK ≤ 40 MiB、Rust 原生库 ≤ 30 MiB、前端 `dist` ≤ 2 MiB，且相对已提交基线增长超过 10% 必须解释。`scripts/audit-android-release.mjs` 同时检查工具链漂移、ABI、打包 ELF 调试段和测试/缓存 payload。debug 只用于原生诊断；profile 使用 release Rust、可调试应用、关闭 JNI debug/R8 并采用独立包名；release 不得包含原生调试段、测试样本和本机缓存。

来源/封面预算与 release 静态门禁已经由代码和自动化满足，但这不替代 Android 运行态：搜索索引 256 MiB 仍只是持久化 UTF-8 文本字节账面上限，真实 page/WAL、ENOSPC、进程中断和长期压力必须按 [ANDROID_STORAGE_ACCEPTANCE.md](ANDROID_STORAGE_ACCEPTANCE.md) 取证。首个完整 B2 release 基线位于 `release-baselines/android-arm64-release.json`；后续只允许收紧，放宽需人工批准并同步 [ROADMAP.md](ROADMAP.md)、[TODO.md](TODO.md) 与 [SECURITY.md](SECURITY.md)。完整 Gradle release lint 仍需要取得当前环境缺失的 AndroidX lint runtime 制品；跳过 lint 生成的 APK/AAB 只可用于静态体积审计。缓存统计/清理目前保持内部维护，无需新增公开 Command；未来若暴露，必须先设计 [IPC.md](IPC.md) 契约，禁止预注册 stub。

## B1–B2 后端能力边界

```text
platform/  -> 只处理桌面路径、Android SAF 与权限
source/    -> 提供来源指纹、SourceLease 和独立 Read + Seek Reader
formats/   -> 解释格式内容；mod.rs 只声明模块，registry.rs 负责薄分派
protocol/  -> 通过 ResourceProvider 获取资源并构造 MIME/CORS/Range 响应
services/  -> 编排数据库、来源和格式能力
commands/  -> IPC 薄适配
```

后端业务新记录的 UUID 与时间戳由 `services/` 生成；Command 不接受前端伪造的审计字段。`notes_service` 是批注公开 seam：创建/更新输入先修剪外层空白，`cfi_start`/`cfi_end` 必须非空，空白 `cfi_range` 归一为 `NULL`；单个 CFI、选中文本和正文分别限制为 4,096、10,000、20,000 个字符，正文与选中文本只作为字面纯文本持久化，颜色规范为小写 `#RRGGBB`。服务层同时负责归属、审计字段保留与缺失错误，数据库只负责参数化持久化和删书级联。`settings_service` 负责全局/单书设置解析，`catalog_service` 负责系列、标签组/标签和关系事务；搜索/索引服务负责任务状态、取消和预算。

阅读设置的公开 seam 是 `settings_service`：全局设置读取/保存整行，单书设置以可空字段逐项覆盖，全局与单书值在服务层合并为 `effective`；`NULL` 只表示继承，不由渲染层自行解释。单书清除通过删除覆盖行恢复全局值；图书存在性、范围/枚举校验和服务生成的 `updated_at` 均在写入前完成，Command 只负责 IPC 参数适配。

系列模块的公开 seam 位于 `catalog_service`：它统一完成名称/卷标校验、实体存在性、单系列归属、完整有序关系读取和重排编排；Command 不拼接关系写入。`book_series.book_id` 主键与单条 UPSERT 保证每本书最多一个系列，批量重排由仓储在 `BEGIN IMMEDIATE` 事务内完成，语句失败或 `COMMIT` 失败都必须回滚并释放事务。

标签模块复用同一 `catalog_service` seam：它统一完成标签组/标签输入校验、稳定唯一冲突映射、系列标签读取、书籍直接标签与系列继承标签合并，以及按全部所选有效标签筛选书籍。Command 不组合直接/继承关系，也不在渲染层本地筛选；筛选只返回 `BookSummary`，不得暴露 `source_locator`/`source_kind`。关系替换由仓储在单个事务中完成，直接关系与继承关系重复时只保留直接关系语义。

`BookFormat` 继续位于数据库共享模型中，禁止在 `formats/` 重复定义。B2 当前真实能力接口为 `MetadataProvider`、`ResourceProvider` 与 `SearchContentProvider`；不得声明没有实现的 `TocProvider`/`TextContentProvider` 占位接口，也不得以默认空值、`todo!`、`unimplemented!` 或 panic 伪装支持。`ResourceProvider` 统一提供 EPUB.js 打开目录与正文所需的 `container.xml`、OPF、NAV/NCX、spine XHTML 及其 CSS/图片/字体资源；目录树的解析、DOM 渲染和当前位置推导由后端冻结后的 EPUB.js 统一导航模型完成，Rust 不重复构造目录模型。`SearchContentProvider` 只提取有预算的 spine 纯文本供后端索引，不合成 CFI。当前 `ActiveFormat` 只有 EPUB 实现，其他枚举值由注册表返回稳定的 `FORMAT_NOT_SUPPORTED:`；搜索索引、任务状态和资源预算属于后端，不能由前端本地数组替代。

CFI 的 DOM 解析、高亮 range 生成和渲染继续属于后端冻结后的前端 EPUB.js 适配层；Rust 只保存经过长度校验的透明 CFI 字符串。PDF/CBZ/CBR 的页面能力接口、Cargo Feature 隔离和相关依赖留待 P3 技术选型，不在 B1–B3 提前冻结。

`protocol/` 禁止依赖 `formats::epub::*`。资源请求必须按 `book_id -> SourceLease -> ActiveFormat -> ResourceProvider -> Response` 流转；来源租约存活期间缓存不得被淘汰，每个请求使用独立 Reader，禁止共享可变 `ZipArchive`。

搜索索引必须按 `book_id -> SourceLease -> ActiveFormat -> SearchContentProvider -> search_service` 流转；`search_service` 不得直接依赖 `formats::epub::*`。后端结果以 `book_id + spine_index + OPF manifest href` 标识命中章节，B2 的 `cfi` 固定为 `null`；精确 CFI 只能在打开目标图书后由 EPUB.js 根据真实 package/DOM 生成。

## P3 多格式目标边界（冻结设计）

当前代码不得提前实现本节，但现有架构也不得把 EPUB 的 CFI、EPUB.js Rendition 或文本排版设置误写成所有格式的通用能力。长期阅读模型分为可重排文档（EPUB/TXT）和固定页面（PDF/CBZ/CBR）；PDF 的文本层能力按文件声明，不是固定保证。

P3.0 需要先设计 capability 组合，而不是万能 Reader 或散落的格式分支：`MetadataProvider`、`ResourceProvider`、`TocProvider`、`TextContentProvider`、`PageProvider`、`SearchProvider`、`AnnotationProvider`。格式不支持某项能力时返回稳定的不支持结果，前端隐藏入口；不得用空目录、空搜索结果或默认页伪装支持。

导入检查应独立于格式处理器：

```text
SelectedSource / future cached remote source
  -> ImportInspector
  -> ImportCandidate[]
  -> FormatRegistry
  -> format-specific import service
```

`ImportInspector` 负责识别 EPUB、单书分发包、纯图片漫画归档和多书候选；格式处理器负责解释已经确定的格式内容。ZIP 是外层分发容器或 CBZ 图片归档，不是数据库图书格式；禁止定义 `BookFormat::Zip`。EPUB 必须先通过 EPUB 签名与容器结构识别，不能被外层 ZIP 规则解包。暂存文件只进入应用私有目录，成功后原子转入受控缓存，失败或取消必须清理。

位置和设置同样按阅读模型隔离：EPUB 使用 CFI，TXT 使用经过设计的文本锚点，PDF/漫画使用页码及必要的页内坐标；文本排版设置与页面缩放/阅读方向分开持久化。具体 Schema 和 IPC 只能在 P3.0 评审后通过追加迁移引入。

## 前端阶段结构（后端冻结后）

以下内容描述 F1–F3 的目标结构，不表示当前阶段已经完成，也不授权在 B3 之前继续扩展前端：

分页正文点击由 EPUB iframe 捕获事件，但判定方向时必须换算为阅读器视口坐标，并按整个视口左右各 25% 命中；一个用户点击只允许触发一次翻页，滚动模式不得启用该命中区。图片、链接、表单控件、活动文本选区和已渲染的高亮标记必须优先。

图片查看与图片导出是独立能力。事件绑定优先使用 Rendition `rendered(section, view)` 的章节 href 与 view contents；查看器可使用当前已加载的 `currentSrc/src`，导出则仍必须解析并校验受控 EPUB 条目路径。图片左键和右键事件必须先阻止 WebView 原生菜单与正文导航；导出路径无法解析时仍允许查看，但导出必须返回受控错误。

```text
src/features/library/        # 书架、系列、标签组和筛选
src/features/reader/         # 可见工具栏、抽屉和阅读交互
src/features/reader/engine/  # EPUB.js 生命周期、目录、搜索、高亮、主题与统一重排适配
src/stores/                  # Zustand 业务状态
```

上一页、下一页、目录、搜索、批注和阅读设置必须有屏幕上可发现的控件；键盘、触摸区和悬停只能作为补充。分页正文左右各 25% 的点击翻页在 EPUB iframe 内判定，图片、链接、表单控件和活动文本选区必须优先，不得用主页面透明元素覆盖 iframe 图片命中。书架页提供全局阅读设置与全屏/退出全屏入口；书架设置只读取/保存全局默认值，不修改单书覆盖。目录由 EPUB.js 的 NCX/NAV 统一导航模型递归渲染，当前位置仅从 `relocated` 事件的章节 href 推导，不在 Rust 重复解析目录。分页使用 default manager；滚动阅读必须使用 continuous manager 预载相邻 spine 项并支持自然双向跨章滚动，向上预载或裁剪章节时必须以首个可见文本行校正滚动位置。排版切换通过重建 Rendition 保持 CFI。阅读设置由 Rust 持久化；数值项使用可键入的 `- / 输入框 / + / 单位` 控件，输入过程立即预览，按钮变化 300ms 防抖保存，失焦/Enter 提交键入值，保存失败重试一次且不回滚预览。设置、全屏、ESC 退出全屏和窗口尺寸变化都必须经 `reader/engine/reflow.ts` 串行执行“捕获视口第一条可见文本行的起始 CFI → 重排/resize → 等待 relocated → 重注入主题 → 恢复该 CFI”，禁止只恢复章节/页级 CFI 冒充目光锚点，也禁止调用点直接触发 `rendition.resize()`。连续滚动可再按原 `viewportY` 校正像素位置；分页模式不得通过 `top/transform` 平移 iframe 文档根元素，以免破坏 EPUB.js 多列坐标。样式仍只使用 TailwindCSS，EPUB iframe 内容样式通过 EPUB.js 注入。分页布局宽度由 `reader/engine/reflow.ts` 的 `readerViewportGeometry` 在 `renderTo`/`resize` 前统一计算：单页不超过 `max_column_width_px`，双页不超过 `2 * max_column_width_px + gap`；正文 body 不再注入 `max-width`，避免破坏 EPUB.js 的列宽与分页坐标。iframe 外侧点击由 reader engine 处理，保证缩窄布局时左右区域仍可翻页。自动跨页在桌面可用宽度达到 1000px 时采用双页，否则采用单页；首次展示在字体与图片稳定后以相同几何做一次锚定重排。

高亮与批注由 `reader/engine/highlights.ts` 适配：Rendition `selected` 事件给出选区 CFI range，前端据此生成可独立定位的起止 CFI 与纯文本选中内容，经既有 notes 命令保存；`cfi_range` 通过 `rendition.annotations.highlight` 渲染为可点击标记，标记点击打开改色/编辑/删除菜单，批注列表点击按 `cfi_start` 定位并恢复。渲染、列表与正文输入只按纯文本处理。EPUB.js 在每次 view 渲染时自动重注入已注册标记，因此翻页与重启后只需重新注册一次；主题、排版切换或重建 Rendition 后必须重新注册全部标记。标记点击不得触发边缘翻页。

EPUB 正文图片事件由 `reader/engine/imageInteractions.ts` 适配各 Rendition iframe；条目路径从 Rendition `rendered` 事件的章节 href 与图片原始相对 `src` 解析，或校验当前 `epub_root_url` 与 `book_id` 下的绝对资源 URL，不得依赖 WebView 最终生成的 `blob:` 地址反推来源。单击/触屏进入 React 图片查看器，并阻止事件继续触发正文导航。正文图片右键/长按菜单显示“更多工具”，至少包含“放大图像”和“另存为”；查看器负责有限倍率缩放、拖动、双指手势、返回正文、设置和全屏控件。图片导出不得把资源字节或来源路径交给前端：`save_book_image` 必须按 `book_id -> SourceLease -> ActiveFormat -> ResourceProvider -> 平台保存` 流转，复用协议层相同的 ZIP 单条目预算与路径规范化，只允许 `image/*` MIME。桌面通过系统保存对话框写入用户选择的文件；Android 在私有 SAF 插件加入 `ACTION_CREATE_DOCUMENT` 与设备验收前返回稳定的未支持错误，不得以 WebView 下载或普通主机路径绕过 SAF。
