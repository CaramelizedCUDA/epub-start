# 架构蓝图与职责边界

本文件规定模块职责和目录位置。持久化字段以 [DATABASE.md](DATABASE.md) 为准，公开 Command 契约以 [IPC.md](IPC.md) 为准，依赖限制以 [README.md](README.md) 为准。

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
  source/                     # 指纹、受控 Reader、Android 私有来源缓存
  formats/                    # 格式能力、薄分派与 EPUB 实现
  protocol/                   # 资源 URI 路由与受控响应，不解析格式
  services/                   # 导入、打开、删除、批注、设置、目录管理与索引等用例编排
  lib.rs                      # 应用状态、插件和 Command 注册
src-tauri/gen/android/app/src/main/java/com/epubstart/app/
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

## Phase 2 后端能力边界

```text
platform/  -> 只处理桌面路径、Android SAF 与权限
source/    -> 提供来源指纹、SourceLease 和独立 Read + Seek Reader
formats/   -> 解释格式内容；mod.rs 只声明模块，registry.rs 负责薄分派
protocol/  -> 通过 ResourceProvider 获取资源并构造 MIME/CORS/Range 响应
services/  -> 编排数据库、来源和格式能力
commands/  -> IPC 薄适配
```

Phase 2 新记录的 UUID 与时间戳由 `services/` 生成；Command 不接受前端伪造的审计字段。`notes_service` 负责批注长度、颜色、归属与缺失状态校验，`settings_service` 负责全局/单书设置解析，`catalog_service` 负责系列、标签组/标签和关系事务；`db/` 只执行参数化持久化与级联约束。

`BookFormat` 继续位于数据库共享模型中，禁止在 `formats/` 重复定义。Phase 2 的能力接口拆分为 `MetadataProvider`、`TocProvider`、`TextContentProvider` 与 `ResourceProvider`；接口不得以默认空值、`todo!`、`unimplemented!` 或 panic 伪装不支持的能力。`ActiveFormat` 在 Phase 2 只有 EPUB 实现，其他枚举值由注册表返回稳定的 `FORMAT_NOT_SUPPORTED:`，不创建空目录或占位处理器。目录与当前书 DOM 搜索由前端 EPUB.js engine 实现，因此 Rust 不创建虚假的 TOC/Text provider 实现。

CFI 的 DOM 解析、高亮 range 生成和渲染继续属于前端 EPUB.js 适配层；Rust 只保存经过长度校验的透明 CFI 字符串。PDF/CBZ/CBR 的页面能力接口、Cargo Feature 隔离和相关依赖留待 Phase 3 技术选型，不在 Phase 2 提前冻结。

`protocol/` 禁止依赖 `formats::epub::*`。资源请求必须按 `book_id -> SourceLease -> ActiveFormat -> ResourceProvider -> Response` 流转；来源租约存活期间缓存不得被淘汰，每个请求使用独立 Reader，禁止共享可变 `ZipArchive`。

## 前端 Phase 2 结构

分页正文点击由 EPUB iframe 捕获事件，但判定方向时必须换算为阅读器视口坐标，并按整个视口左右各 25% 命中；一个用户点击只允许触发一次翻页，滚动模式不得启用该命中区。图片、链接、表单控件和活动文本选区必须优先。

图片查看与图片导出是独立能力。事件绑定优先使用 Rendition `rendered(section, view)` 的章节 href 与 view contents；查看器可使用当前已加载的 `currentSrc/src`，导出则仍必须解析并校验受控 EPUB 条目路径。图片左键和右键事件必须先阻止 WebView 原生菜单与正文导航；导出路径无法解析时仍允许查看，但导出必须返回受控错误。

```text
src/features/library/        # 书架、系列、标签组和筛选
src/features/reader/         # 可见工具栏、抽屉和阅读交互
src/features/reader/engine/  # EPUB.js 生命周期、目录、搜索、高亮、主题与统一重排适配
src/stores/                  # Zustand 业务状态
```

上一页、下一页、目录、搜索、批注和阅读设置必须有屏幕上可发现的控件；键盘、触摸区和悬停只能作为补充。分页正文左右各 25% 的点击翻页在 EPUB iframe 内判定，图片、链接、表单控件和活动文本选区必须优先，不得用主页面透明元素覆盖 iframe 图片命中。书架页提供全局阅读设置与全屏/退出全屏入口；书架设置只读取/保存全局默认值，不修改单书覆盖。目录由 EPUB.js 的 NCX/NAV 统一导航模型递归渲染，当前位置仅从 `relocated` 事件的章节 href 推导，不在 Rust 重复解析目录。分页使用 default manager；滚动阅读必须使用 continuous manager 预载相邻 spine 项并支持自然双向跨章滚动，向上预载或裁剪章节时必须以首个可见文本行校正滚动位置。排版切换通过重建 Rendition 保持 CFI。阅读设置由 Rust 持久化；数值项使用可键入的 `- / 输入框 / + / 单位` 控件，输入过程立即预览，按钮变化 300ms 防抖保存，失焦/Enter 提交键入值，保存失败重试一次且不回滚预览。设置、全屏、ESC 退出全屏和窗口尺寸变化都必须经 `reader/engine/reflow.ts` 串行执行“捕获视口第一条可见文本行的起始 CFI → 重排/resize → 等待 relocated → 重注入主题 → 恢复该 CFI”，禁止只恢复章节/页级 CFI 冒充目光锚点，也禁止调用点直接触发 `rendition.resize()`。连续滚动可再按原 `viewportY` 校正像素位置；分页模式不得通过 `top/transform` 平移 iframe 文档根元素，以免破坏 EPUB.js 多列坐标。样式仍只使用 TailwindCSS，EPUB iframe 内容样式通过 EPUB.js 注入。分页布局宽度由 `reader/engine/reflow.ts` 的 `readerViewportGeometry` 在 `renderTo`/`resize` 前统一计算：单页不超过 `max_column_width_px`，双页不超过 `2 * max_column_width_px + gap`；正文 body 不再注入 `max-width`，避免破坏 EPUB.js 的列宽与分页坐标。iframe 外侧点击由 reader engine 处理，保证缩窄布局时左右区域仍可翻页。自动跨页在桌面可用宽度达到 1000px 时采用双页，否则采用单页；首次展示在字体与图片稳定后以相同几何做一次锚定重排。

EPUB 正文图片事件由 `reader/engine/imageInteractions.ts` 适配各 Rendition iframe；条目路径从 Rendition `rendered` 事件的章节 href 与图片原始相对 `src` 解析，或校验当前 `epub_root_url` 与 `book_id` 下的绝对资源 URL，不得依赖 WebView 最终生成的 `blob:` 地址反推来源。单击/触屏进入 React 图片查看器，并阻止事件继续触发正文导航。正文图片右键/长按菜单显示“更多工具”，至少包含“放大图像”和“另存为”；查看器负责有限倍率缩放、拖动、双指手势、返回正文、设置和全屏控件。图片导出不得把资源字节或来源路径交给前端：`save_book_image` 必须按 `book_id -> SourceLease -> ActiveFormat -> ResourceProvider -> 平台保存` 流转，复用协议层相同的 ZIP 单条目预算与路径规范化，只允许 `image/*` MIME。桌面通过系统保存对话框写入用户选择的文件；Android 在私有 SAF 插件加入 `ACTION_CREATE_DOCUMENT` 与设备验收前返回稳定的未支持错误，不得以 WebView 下载或普通主机路径绕过 SAF。
