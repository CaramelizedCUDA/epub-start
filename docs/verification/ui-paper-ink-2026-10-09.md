# 纸与墨 UI 重构记录

## 范围与依据

- 起点：`main` / `90e34fe`。保留已有 `src-tauri/gen/schemas/acl-manifests.json` 修改；未提交、切分支、推送或发布。
- 用户提供的 7 页手机 PDF 与交互 HTML 作为视觉参考。示例中的定时开书、内存导入、假统计和假管理动作不作为生产实现。
- UI：纸张底色、墨色文字、绿强调与系统字体；藏书/足迹/设置，折叠阅读洞察、继续阅读、两列手机书架、书籍操作面板、Reader 展示与设置拆分。
- TXT/PDF：复用不依赖 CFI/Rendition 的展示壳，具体锚点/页位置、解析器、依赖与迁移继续留在 P3；当前导入仍只支持 EPUB。

## 阅读行为

正文基线在 EPUB.js 主题内按用户建议使用 `justify`、`inter-character`、`trim-start`、`pretty`，固定版式排除，旧 WebView 由 CSS 自然忽略不支持属性。保留出版方块级对齐。新的顶部和底部留白在工具收起时不改变正文几何；设置仍通过原串行重排链执行。属性边界参见 [MDN text-justify](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/text-justify) 与 [text-spacing-trim](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/text-spacing-trim)，桌面浏览器支持不代表旧 Android 已验收。

[Issue #3](https://github.com/CaramelizedCUDA/epub-start/issues/3) 报告偶发章末漏页。代码确认按钮/键盘与手势原有不同的逻辑提交路径；实际列距漂移仍未经用户原环境测量确认。本次统一手势提交并为 default / horizontal / LTR / reflowable 分支加入末尾可滚动内容防御，保留 EPUB.js 队列、章节装载与 CFI 上报。此防御不能直接证明用户样本中的所有漏页已经消失。

本轮真实 DOM 检查另复现分页重开回章首：夹具保存和读回同一 `epubcfi(/6/2!/4/20/1:85)`，但首次 display 后已到第 1/4 页，稳定重排又使用临时章首。修复让 `initialHref`（优先）或保存 CFI 在主题、字体、图片和几何稳定后再次定位；这组操作完整纳入同一重排队列，防止并发全屏/resize 先捕获临时章首并在稍后覆盖目标。普通重排锚定算法不改。最终代码同一序列重新打开保持第 3/4 页，正文末尾标记可见。没有旧版本运行对照，因此不将该时序问题归因为本轮视觉改动。

## 验证

浏览器夹具位于忽略目录 `target/ui-refactor-smoke/`：生产 React 和真实 EPUB.js、三章有末尾标记的合成正文、模拟 IPC。此夹具的进度和设置只存内存，不代表 SQLite/SAF 或原生窗口验收。它不读取真实书架；测试服务器仅监听 `127.0.0.1:1420`。

| 范围 | 状态 | 边界 |
| --- | --- | --- |
| 前端构建 | PASS | 视觉增量最终 TypeScript + Vite，199 modules，退出码 0；源码 `6945c2539728`，无新增依赖 |
| Reader 逻辑回归 | PASS，76/76 | `npm.cmd run test:frontend -- --reader`，source `716623835a26`；引擎边界测试含真实 EPUB.js manager 方法，但没有原生 WebView |
| 390×844 手机 UI | PASS（初轮行为 smoke） | 两列书架、书籍面板、设置面板、字号 20→22、暖色→深色、关闭恢复焦点；不表示已对齐设计稿，视觉纠偏见下文 |
| 1280×900 桌面 UI | PASS（初轮行为 smoke） | 书架、折叠统计、系列/标签空状态、元数据搜索、批注入口、足迹、双页工具；最终展示增量见下文 |
| 章末可见与跨章 | PASS（合成样本） | 手机第 1 章 5/5 可见末尾标记后进入第 2 章；桌面奇数列补齐为 4 页，3/4 可见末尾，前后跨章正确 |
| 退出再打开恢复 | PASS（合成样本） | 1280×900，章末 3/4 → 退出 → 读回同一 CFI → 仍为 3/4；模拟存储，不代表原生重启持久化 |
| 差异、诊断清理 | PASS | `git diff --check`；生产代码中临时 fixture 日志已移除 |
| Windows WebView2 原生打开/重排/恢复 | NOT_RUN（最终视觉候选） | 隔离实例曾启动并通过真实 IPC 导入合成 EPUB；Reader 定向验收未结清，已按用户要求暂停 |
| Android 触摸、安全区、章末、重排/恢复 | 已执行边界抽验，存在 FAIL | 当前视觉源码的新 x86_64 profile 已安装到副本；实际结果、缺陷及未测范围见本文当前 Android 节，不判整体通过 |
| 用户原书、原设置下 issue #3 | NOT_RUN | 未提供确定性最小样本与几何日志 |

复用：现有来源、数据库、SAF、资源预算与图片 URL 修复代码未改，本次不重跑无传播路径的后端压力测试，也不以旧制品证明当前 Android 验收。首轮前端检查未构建 APK；后续隔离构建准备见下文，仍未执行 Rust 测试或设备完整验收。Rust 源码与 unwrap 统计登记没有修改。

定向红绿：旧手势实现不能通过“预览不改正文滚动位置”断言；隔离副本禁用末页防御后 `0 !== 1800` 变红，恢复后目标 10/10 通过。副本已恢复为干净编译产物。证据保留在忽略目录 `target/pagination-audit/`，没有故意缺陷进入生产源码。

初始恢复红绿：使用实际 reflow 源码，旧源码不能保留 saved CFI/显式章节目标，两项都在最终目标断言失败；增加队列测试后，新源码与原锚定测试合计 11/11。单目标证据 `target/pagination-audit/initial-restore-red.txt` 和 `initial-restore-green.txt`；并发证据 `queued-initial-red.txt` 和 `queued-initial-green.txt`，旧实现后续重排捕获临时章首而非目标。最终总回归 76/76 复用上述红绿证明，不重复注入。

独立 `code-review` 审阅已覆盖分页防御、释放点、UI 拆分与旧 WebView 兼容。恢复修复的增量审阅发现最终 display 绕过队列的 P2，现已修复、用并发红绿证明并经审阅关闭。最终没有未解决的本轮审阅项；这不替代未执行的原生设备验收。

## 2026-10-09 视觉纠偏与柔和深色（接续收尾）

用户在预览指出旧圆环统计、通栏 Reader 工具和预览外壳没有对齐稿，故先暂停原生验收。纠偏不从头设计、不改 EPUB 导航/恢复队列：
- `ReadingInsights.tsx` 改为折叠时长摘要、真实最近 7 天柱图和紧凑推荐，继续阅读卡使用卷名/全名层级。默认摘要周期为月；已有用户周期偏好保留，不用固定月数字覆盖真实数据。自然周不能冒充最近 7 天，图表按月级完整日桶读取，跨月补取前月，缺桶报错，可重试。
- `BookShelf.tsx` 调整标题、图标、两列书封与卡片密度；`ReaderChrome.tsx` 改为浮动标题/底部工具卡与安静页脚，显示真实章内页码，不增加假全书进度滑块。`EpubReader.tsx` 固定正文视口，不随工具显隐占位；设置标题/完成按钮不进入内部滚动区。
- `ReaderSettingsPanel.tsx` 压缩常用行距/页边距/字体/翻页方式，保留字号滑块、更多排版的精确输入、即时预览与既有全局/单书语义。预览 `mobile.html` 直接挂载生产 App，不再用提示条或固定高度 iframe 挤占手机视口。
- `reflow.ts` 深色纸张改为暖炭灰 `#262520`，正文为米灰 `#d6d0c3`；工具变量与色样同步。浅色/暖色及 EPUB 重排逻辑不变。

最终视觉源码指纹 `6945c2539728`（`src/`、Tailwind 配置与 npm 清单；未提交工作区）。以下仍为生产 React/真实 EPUB.js + **模拟 IPC**，不是 WebView2/SQLite/SAF 原生验收：

| 增量检查 | 结果与边界 |
| --- | --- |
| 最终前端构建 | PASS，`npm.cmd run build`，199 modules、退出码 0；`target/ui-paper-ink-native/visual-final-build.log` |
| 手机 390×844 | PASS：摘要展开/收起，7 个真实示例日桶和 2 条紧凑推荐；两列、无横向溢出；开书及返回；字号滑块到 20、精确输入到 22、完成恢复设置按钮焦点 |
| 正文主题与工具显隐 | PASS：深色正文/壳/色样均为 `rgb(38,37,32)`，正文/工具墨色为 `rgb(214,208,195)`；浅色/暖色值保持。手机 viewport 始终 `390×748 / y=48`，工具显隐页码与几何不变；模拟保存调用到达，不代表持久化 |
| 跨月/跨年与缺桶重试 | PASS：仅测试标签页模拟本地日期 2026-01-03，图表覆盖 2025-12-28 至 2026-01-03；缺少 12-31 时显示错误，不补零；重试重新取两个月份后恢复 7 个日桶 |
| 桌面 1280×900 | PASS：书架/7 列统计无横向溢出，Reader 工具和设置完成/返回可用；面板在窗口内，viewport `1280×804 / y=48` 在显隐/开面板时不变 |
| 七日柱顶长时长 | PASS（修前复现 → 修后通过）：相邻 90 分钟原标签宽 66.48px、列中心距 45.24px，实际重叠；改为等价 `90分` 后宽 21.73px，均在本列内、不相交。完整日期/时长保留在 aria-label/title |
| 增量独立审阅与差异 | 长标签 P2 已修复并复核关闭，无未解决相关审阅项；`git diff --check` PASS。最终预览已移除测试日期/IPC 临时替换，重新加载和展开无页面异常；Vite 继续供用户查看 |

明细、源码指纹及上述红绿/配色/跨月/桌面数据位于忽略目录 `target/ui-paper-ink-native/`；普通提交不会保留。Reader 76/76 与队列/分页红绿复用初轮 source `716623835a26`：本次只改变展示、预设接线和深色材料值，没有修改已验引擎协调逻辑，不重跑自动回归；旧夹具的固定页数不外推为新正文留白的页数。

原生准备仅留事实：Windows 独立 identifier 的开发实例已真实 IPC 导入合成 EPUB，当前已停止，尚未结清当前候选的 Reader 场景。现有 Android 35/x86_64 AVD 已复制到 `target/ui-paper-ink-native/avd/`，原 AVD 未清空；视觉纠偏前曾成功构建 `com.epubstart.reader.profile` 的 x86_64 profile APK（release Rust/现有 debug 签名，未安装运行），生成 schema 已按备份恢复，原有 ACL SHA256 `D3EACE193B1E453756736EAF27BB156DF62C7A41B2FE101403EE92EF93E69699` 保持。旧 APK 不包含本节最终视觉源码；恢复 Android 验收时须重新生成对应制品。未执行真机触摸/OEM/旧 WebView、安全区、Rust 测试/SAF、用户原样本 issue #3 或完整精确保位矩阵；继续由 E5/E9/E10 承接，不补勾历史阶段门禁。

## 启动前 Android 交接快照（历史，当前结果见下节）

用户最新要求下一会话使用 D 盘现有 Android 虚拟机验收，替代此前暂停安排。详细交接见 [安卓模拟器验收交接](../../.yan/安卓模拟器验收交接.md)，持续约束见 [.yan/账本](../../.yan/账本.md)。

- 使用 `EpubStart_B2_API35` 的仓库内 AVD 副本，先生成包含最终视觉源码的 x86_64 隔离 profile APK；核对 assets、源码摘要、包名/ABI与 APK 哈希，不复用旧 APK 冒充当前制品。
- 在真实 Android 应用内完成导入/开关书、READER-01/02、章末/跨章、字号/旋转重排、工具/面板/柔和深色/安全区和退出/重启持久化；模拟器触控、真实 IPC/SQLite与网页模拟证据分别记录，不能覆盖真机/OEM/旧 WebView或用户原样本问题。
- 本答仅编辑交接文档：核对分支/HEAD、已有改动、ACL SHA256和材料路径，未构建、安装或验收，不新增 PASS。上次构建、Reader 76/76及浏览器证据复用，相关逻辑未由本答改变。
- 交接核对未检测到 `1420` 监听；需看网页可运行 `npm.cmd run dev` 后打开既有预览。原 AVD/正式包/正式书库保持不动，不使用清数据或旧压力实验脚本。

## 2026-10-09 Android API35 副本原生边界抽验（当前结果）

用户要求继续原生验收，并补充自动化少量、重点看边界。本轮不扩全量/逐按钮矩阵，不改产品源码，不新增依赖、格式、IPC/schema，不提交/发布。**动作已执行并收尾，当前候选仍有 FAIL，不判整体通过。**

### 当前候选、隔离与证据
- 本轮重新生成 `target/ui-paper-ink-native/android-final-build/EpubStart-paper-ink-current-x86_64-profile-20261009.apk`，SHA256 **`122E9285489E907BC071C0D61D7434C2BC18009838C8F862DCA4455A00BF97A3`**，27,103,623 B。包 `com.epubstart.reader.profile`，仅 x86_64，code1000 / 0.1.0-profile，min24/target36，release Rust/custom-protocol，无 b3-diagnostics，现有 Gradle debug 签名，非正式签发。旧 APK 未作为当前候选。
- 50文件源码全摘要 `5B1596DBEB4B3A0439C4304A99B54D7D9155CF9F0715516822782CCFB4D9406E`，算法/范围与历史视觉短指纹不同；当前源码逐文件匹配。本次 frontend/Cargo/Gradle退出0，APK内 **4/4 assets** 与本次 dist 哈希一致并含最终暖炭灰/米灰；设备安装后及副本冷启后的 base.apk 哈希均与候选一致。制品/源码/schema/隔离已独立只读复核；原始构建证据在 `android-final-build/`。
- 实际环境：仓库内 `EpubStart_B2_API35` 副本 / `emulator-5580`，Android **35 / x86_64**，WebView **124.0.6367.219**；1080×1920 / 420dpi / DPR2.625 / 手势导航（navigation_mode=2）。竖屏CSS约412×732，横屏约732×412；没有真机、OEM、旧WebView或切口证据。
- 初始交接副本的旧closeout userdata 与后来 metadata key不配对，启动报 Invalid ext4 superblock。保留旧磁盘及备份，将**同一原 AVD 最后完整磁盘链只读复制**为副本内额外 `userdata-from-last-state.img` / `encryptionkey-from-last-state.img`，活动 qcow2 backing 均仅指同目录；system/vendor只读。未 wipe/格式化、未运行旧压力脚本，原 AVD未运行/清空。副本已有 profile APK、全部数据和db在安装前留于 `profile-before/`，随后保留数据安装。
- 以下 `A/` 均指 `target/ui-paper-ink-native/android-acceptance-20261009/`。动作由绑定serial的 Android input 和系统SAF选择器完成，CDP只观察真实 Tauri WebView/可见文本与调用真实读取IPC；截图来自 adb screencap。没有 Chrome网页/mock IPC/手工插库代替实际动作。

### 逐项实际结果
| 场景 | 状态 | 实际动作、结果与证据 |
| --- | --- | --- |
| 当前候选安装 | PASS | 安装前备份后保留profile数据安装；安装/冷启后APK哈希匹配。`A/installed-apk*-sha256.txt` |
| 真实导入/开书 | PASS（所测路径，非空库全流程） | 应用导入按钮→系统选择器→合成EPUB和本地6.epub；已有4本变6本，均available。合成书真实正文、6.epub封面/插图、目录标题及后续实际短篇正文打开。`actions.ndjson`、`after-import-*.json`、`representative-text-next.json` |
| 书籍面板/洞察展开 | PASS（展示/所测动作） | 合成书操作面板“开始阅读”可用；书架月摘要展开为10.03–10.09七日图与2条真实推荐，无横向溢出；未跑其他书籍写操作矩阵。`book-actions-synthetic.json`、`final-shelf-insights.json` |
| READER-01 快速A→B | PASS（单次定向边界） | A章末返回后立即选B并打开，约3.5秒进入B；B从封面下一页后返回书架，无A正文残留/重复iframe，A/B各自CFI按book_id保存。不是加载期连续取消/压力循环证明。`reader-01-boundary.json` |
| 按钮/代表触控 | PASS（代表正文）；早期未响应观察未闭合 | 按钮确实移动正文；A左滑进入后续列，B冷启后原生边缘点按前进、右滑返回，passive事件记录为touch，探针已删除。早期工具展开约200ms后极速点击、合成章末空白处一次点按/右滑未响应，归因仍未定，不能用后来PASS关闭全部触控边界。`input-boundary-recheck.json`、`chapter-boundary.json`、`actions.ndjson` |
| 合成章末/前后跨章 | PASS（可见文本判断） | 第1章末尾完整标记实际可见，再按下一页进入第2章正文；上一页回第1章末尾，标记仍可见。初次脚本标签只是动作意图，不能把标签当成功；用frames.visible/实际正文判定。`chapter-two-start.json`（实际为第1章末）、`cross-chapter-forward.json`、`cross-chapter-back.json` |
| READER-02 字号重排 | PASS（合理锚定，非行级精确） | B正文中滑块18→20，更多排版原生键入22/Enter，队列稳定后正文与保存值22px；旧目标句仍可见，但首个可见行有变化。键入过程曾预览中间12px，随后稳定22，不用中途采样判最终失败。`representative-anchor-before.json`、`slider-actual.json`、`representative-after-font-dark.json` |
| 旋转重排 | PASS（所测锚定） | B竖→横，目标句仍完整可见，22px不变；正文视口变为约732×316/y48，CFI合理调整。副本冷启实际回竖屏，目标句仍可见；不证明全部精确保位。`landscape-after-font.json`、`avd-restarted-reader.json` |
| 工具/设置面板 | PASS（受影响展示/输入） | 工具显隐、设置打开/关闭不改变正文视口（竖屏约412×636/y48）或当时页码；精确输入/内滚动后“完成”仍在固定头部，可直接关闭；横屏面板在窗口内、完成可点击。`settings-before.json`、`settings-precise-dark.json`、`landscape-panel-geometry-colors.json` |
| 柔和深色材料 | PASS（正文/壳/工具/色样） | 原生正文和shell为rgb(38,37,32)，正文/工具墨色rgb(214,208,195)，工具底rgba(38,37,32,.9)，色样同步。系统栏缺陷另列，不能合称整屏深色通过。`landscape-panel-geometry-colors.json`、`representative-after-font-dark.json` |
| 全局/单书设置 | PASS（修改/继承/持久化所测）；清除覆盖NOT_RUN | 先全局改dark，后开单书开关改B字号22；真实get settings显示全局dark/18，B有单书覆盖且字号22，A无覆盖且实际dark/18。覆盖记录为整组设置快照，不宣称只有字号字段被存入；未操作清除覆盖。`synthetic-restored-after-avd.json` |
| 退出/应用进程冷启 | PASS（本书、本横屏布局） | 退出B保存后只force-stop profile并COLD启动，实际打开“继续阅读”后仍3/41、同可见正文及`epubcfi(/6/58!/4/2/16/1:0)`，dark/22和覆盖不丢；PID4087→5904。`before-process-restart.json`、`saved-after-exit.json`、`process-restarted-reader.json` |
| AVD完全停机/冷启恢复 | PASS（磁盘与合理内容恢复） | 退出书后emu kill副本、以同盘/无快照加载保存重启，emulator/qemu进程及guest boot_id均改变；6本、全局dark/18、B覆盖22及同保存CFI仍在。冷启实际竖屏1/28，目标句仍可见，不是同几何横屏AVD冷启通过。A再打开仍第1章末5/5与`epubcfi(/6/2!/4/28/1:0)`，完整末尾标记可见。`avd-*-restart.json`、`avd-restarted-*.json`、`synthetic-restored-after-avd.json` |

### 未结缺陷与归因边界
1. **FAIL：真实章内页码向前偏一页。** 稳定按钮翻页后正文从第1–3段到第4–6段，CFI随后变为`epubcfi(/6/2!/4/10/1:0)`，但页脚仍1/5；连续到末尾标记曾显示4/5，跨章后返回才5/5。`turn-recheck-stable.json` / `geometry-after-turn.json`实测scrollLeft=411.8095、容器宽412；EPUB.js `default/index.js:779`用`Math.floor(start/pageWidth)`，应用`navigation.ts:22–24`直接消费它，存在浮点/整数几何取整嫌疑，尚未修复/红绿证明或旧版本对照。上答“下一页超时”不能等同于正文未翻动。
2. **FAIL：安静页脚未完整避开手势安全区。** quiet按钮44CSSpx，竖屏rect约y684–728，底边距仅4px；原生navigationBars frame `[0,1857][1080,1920]`（63px≈24CSSpx），命中区下沿侵入预留区约20CSSpx。浮动工具按钮/设置完成可点，不代表quiet整块命中区安全。`synthetic-restored-after-avd.json`、`android-window-final.txt`，不外推其他导航/切口。
3. **FAIL：深色状态栏图标对比度不足。** 原生深色截图仍为暗色系统图标；Reader window实际`vsysui/apr=LIGHT_STATUS_BAR(S) LIGHT_NAVIGATION_BAR(S)`，没有随阅读dark切换。`screens/landscape-settings.png`、`android-window-landscape.txt:685–696`。正文/工具材料PASS不能覆盖系统栏。
4. **FAIL：继续阅读把章级进度展示为全书百分比。** 三章合成书第1章末的`progression=1`被书架显示100%，并非全书读完；应用当前上报为章内`page/total`。`final-shelf-insights.json` / `navigation.ts:24`。本答只记录事实，不改冻结IPC/定位算法或擅自归因于视觉重构。

早期未响应输入缺少事件到达证据，仍保留观察而非宣称产品/工具根因已确认。CDP Log.enable回放的可选iBooks metadata 404及srcdoc脚本被sandbox阻止，与此次切书新异常区分；没有放宽allow-scripts/权限消除日志。helper拒绝部分可见卡片、过早采到body=null均为执行侧诊断，不记作产品PASS/FAIL。真实导入与本次重启恢复不覆盖SAF撤权、异常存储或进程在保存中断电。

### 保护、清理与未测
- 六个schema按开始前字节恢复，ACL哈希保持；本答文档变更限定集中记录、TODO、账本和交接，忽略目录保留制品/动作/备份/helper。最终工作区、原AVD所列保护盘链/配置、两本原书和备份哈希核对见`A/final-protection.json`；只证明所列保护对象，不冒充原AVD全目录审计。
- 副本旋转设置恢复原值accelerometer=1/user_rotation=0，退出Reader后停止副本，9223转发/9340截图服务已移除，旧profile日志采集随停机结束；原ADB server不杀，用户既有Vite1420预览保留。运行时passive探针已删除，无临时缺陷进入产品源码。
- 复用同源码Reader **76/76**、初始恢复/并发队列与分页红绿、浏览器跨月/缺桶/长标签证据：本答没有改已验引擎、前端或依赖，故不重跑全量/故障注入。当前APK静态一致性已独立复核，但它不替代上述实际运行态结果。
- **NOT_RUN/承接E5/E9/E10**：Windows最终视觉候选、Linux、真机手指/OEM/旧WebView、同几何横屏AVD冷启、全部精确保位、所有触控竞态、其他书籍写操作/设置清除/搜索批注矩阵、SAF撤权恢复、性能/耗电、正式签发；用户原样本issue #3仍无确定性证据。历史阶段门禁不补勾。下一步按用户指定定点处理上述缺陷，不以大矩阵代替定位；源码入口和最小复验条件见[修复交接](../../.yan/纸与墨修复交接.md)。交接仅为文档整理，不新增运行态结果或关闭缺陷。

## 2026-10-10 四项定点修复与最小复验

接续 10 月 9 日的修前交接，用户授权修复 PI-01–04。四项在下述限定路径通过，前节 FAIL 保留为修前事实；不据此宣布 E5/E9/E10/E11 或整体验收完成。本轮无新增依赖、IPC、权限、Schema、Rust 业务源码或 Git 写操作。

### 实现与制品

- **PI-01**：真实修前采样确认 412px 页宽对应 scrollLeft=411.809509，container.left=0.095238、view.left=-411.714294；正文 CFI 已到第二页，relocated 同步、下一帧、150ms 后仍报第一页。`navigation.ts` 仅在 default/reflowable/横向/LTR/单页/非 fullsize、匹配首个可见章节且距下一页边界不超过 1CSSpx、原读数恰少一页时纠正。CFI 和 manager 不改，既有章级 `page/total` 同步纠正读数，不变成全书进度。readerStore 的新建/重建两处提供对应实例的只读几何。
- **PI-02**：继续阅读卡删除章级百分比与进度条，以非空 CFI 显示“已保存阅读位置”，否则“尚无保存位置”；视觉与按钮无障碍名称同步，恢复回调保留。不迁移历史数据、不改推荐或进度契约。
- **PI-03/04**：MainActivity 使用既有 `onWebViewCreate`、WindowInsets 和 `evaluateJavascript`，只将实际覆盖 WebView 的 systemBars/displayCutout/mandatorySystemGestures 换算为 CSS 安全区，并读取顶层 Reader 的固定主题枚举来更新图标。正文与工具共享四边安全区、与 CSS env 取 max；仅安全区值变化派发既有 resize 进入原重排队列。绘制事件合并至最多约 250ms 一次，无自行循环的常驻计时器；暂停/销毁撤销待执行任务与监听，不替换 Wry Client、不新增原生通信入口。实际静止 CPU/耗电未测，不据静态限频宣称性能验收。

新 APK：`target/ui-paper-ink-native/fix-20261009/build/EpubStart-paper-ink-fixed-x86_64-profile-20261009.apk`，SHA256 **AF781F3B7A1FA74E297C0D16D08F49D6CAEE11A5E3610CD6A2B3EFA62FE56345**，27,104,135B。包 `com.epubstart.reader.profile`、仅 x86_64、release Rust/custom-protocol、无 b3-diagnostics、现有 debug 签名；不是正式发布制品。56 个列明输入含 MainActivity/Android 配置的摘要为 `C66FC8CD59C18A7696FCEE040213FCFBBCA35393388451C8813B487DC048A64A`，准确范围/算法以 `build/source-manifest.json` 为准。4/4 APK assets 与 dist 一致，安装包远端哈希一致；六份 schema 按本次开始字节恢复，ACL 仍为 `D3EACE19…69699`。

以下 `F/` 指 `target/ui-paper-ink-native/fix-20261009/`。安装前的 `acceptance/profile-before/` 和临安装前的 `profile-preinstall/` 分别保留旧 APK、完整 data.tar 与数据库，未覆盖旧 `android-acceptance-20261009/profile-before/`。保留数据安装，同一副本/serial/WebView 环境，没有重新导入六本书。

### 实际结果

| 范围 | 结果 | 实际证据与边界 |
| --- | --- | --- |
| 前端/对应 Android 构建、制品 | PASS | TypeScript/Vite 199 modules；offline x86_64 release Cargo 1m35s、Gradle profile 2m23s；包/ABI/签名/assets/SO/source/schema 核对通过。`F/build/` |
| Reader 相关回归 | PASS，79/79 | 新页码断言修前 expected2/actual1，78/79；修后 `--reader` 79/79、source `bee7d5f01265`。旧会话、错误分支、初始恢复/队列既有逻辑继续覆盖；不冒充真实 DOM。`F/reader-red-green.log` |
| PI-01 第二页/章末/跨章 | PASS（原生所测分支） | 新候选第二页 2/5，首章末标记可见且 5/5；前进到第二章 1/5，返回首章仍 5/5。以可见文本和 CFI 判定，不只看页码。`F/acceptance/page-check.json`；修前 `before-page-probe.json` |
| PI-02 继续阅读 | PASS | 首章末返回书架显示“已保存阅读位置”，无 100% 或全书进度条；再次继续仍同 `/4/26/1:0` CFI、同章末标记。空 CFI 边界另在现有 Edge 浏览器夹具显示“尚无保存位置”，含相同无障碍名称；夹具为真实 React+模拟 IPC，不是伪造原生数据。`page-check.json`、`empty-position-browser.json` |
| PI-03 竖横屏安全区与显隐 | PASS | 竖屏 quiet rect y652.1488–696.1488、横屏 y332.1667–376.1667，高度均44CSSpx；系统预留底边约32CSSpx（包括 mandatory gestures），完整避让且不盖正文。竖屏工具/设置及稳定横屏显隐/设置不改变 viewport 或当时 CFI。`chrome-check.json` 的竖屏节、`chrome-check-continued.json` 的稳定横屏节及对应 window 文件 |
| PI-04 主题/书架/旋转/进程冷启 | PASS | 深色 Reader 的 LIGHT_STATUS/NAVIGATION flags 均关闭、截图亮图标；浅色/暖色及书架 flags 开启、暗图标。旋转及 profile 冷启后与实际材料匹配。PID3593→4111，六本/全局 dark18/原真实书单书 dark22 保留。上述 chrome/window 文件、`cold-actual-portrait.json`、screens |
| 重排/内容恢复 | PASS（合理内容）/同几何横屏精确保位 NOT_RUN | 稳定横屏第11段可见，冷启实际回到竖屏，同段完整可见；几何从732×412变412×732、CFI相应由 `/4/22/1:86` 到 `/4/20/1:0`。脚本假定横屏保持的严格 CFI 断言失败，不把它改写成横屏通过。`cold-result.json` |
| 独立增量审阅/差异 | PASS | `code-review` Astra/xhigh 只读审阅无可行动发现；子代理实际 model/effort 已从 turn_context 核实并记录 `F/agent-runtime-models.json`。`git diff --check` 通过 |

观察与执行边界：首轮开书遮罩尚在，helper 拒绝点击；一次观察遇初始化 manager 缺少 container，改观察器后续接已完成路径。旋转初样本 iframe 仍为 about:blank、旧 relocated 与新 manager 读数混合，不能用于位置断言；随后要求正文非空、CFI 与 currentLocation 一致、几何连续1.5秒稳定，再实际显隐/设置，读数与正文不变。这是观测门槛，不是直接证明内部队列清空。原始部分记录、终止输出和不成立的冷启横屏假设均保留；不是宣称每个 helper 均退出0，也未将这些执行侧问题归为产品缺陷。

### 保护、复用与停止

- 退出 Reader，恢复副本 `accelerometer_rotation=1/user_rotation=0`，停止本轮副本并移除 9223 转发；检查页已关闭，已有 Vite1420（PID14588）与 ADB server 保留，最终 netstat/设备核对见 `F/closeout.json`。最终 `final-shelf.json` 仍六本；合成书最后为首章第4/5页 `/4/20/1:0`，不是最初章末位置。阅读动作产生的进度/时长保留，未清数据。
- 构建前后已核对未提交工作区字节，保留原改动；原 AVD 所列盘链/配置、原书、旧备份及未配对旧副本盘保护哈希全部一致，范围见 `F/protected-data-recheck.json`，不冒充原 AVD 全目录审计。
- 原有初始恢复/并发队列、分页红绿仍由未改算法及本次79项回归承接；统计跨月/缺桶/长标签、来源/数据库/SAF/资源预算实现未变，复用前节有效证据，不重跑后端压力。新制品与当前源码对应，旧 APK 只作修前材料。
- **NOT_RUN/仍由 E5/E9/E10/E11 承接**：Windows 最终原生候选、Linux、真机/OEM/旧 WebView、固定版式/RTL/双页真实运行、其他导航/切口、所有精确保位/触控竞态、SAF 撤权与异常存储、性能/耗电、正式签发及用户原样本 issue #3。早期触控归因缺口未被本轮关闭。所需四项最小检查已结清，停止扩验，不补勾历史阶段。

## 2026-10-11 独立审阅后三项定点修正

Sonnet 5.5 high 只读全量审阅、Haiku 5.5 max 记录核对（构建 199 modules、Reader 79/79 `bee7d5f01265`、APK/证据/ACL/manifest 抽查全部一致），主代理 Opus 5.5 复核。用户批准修正下列三项；书架点封面打开操作面板属已批准重构范围。

- **设置预览积压**：`readerStore.applyReadingSettings` 改为最新优先，排队中已被更新值取代的完整快照直接跳过，避免字号滑块每档各排一轮重排。新增 `readerStore.test.cjs`“queued settings previews replaced by a newer value are skipped”：修前 expected 3/actual 5 重建，修后通过。
- **原生同步永久阻塞**：`MainActivity.kt` 为 `evaluateJavascript` 加求值代号，暂停时作废旧回调；超过 2s 未回调时允许下一次绘制重新求值。
- **书架详情预选残留**：`BookShelf` 只在操作面板进入标签/批注时设置预选书，其他入口清除；预选书已不在列表时不传给页面。

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit`、Vite（输出 `target/audit-20261011/dist`） | PASS，199 modules |
| `test:frontend -- --reader` | PASS，80/80，source `8c17a0426545` |
| `test:frontend -- --library library` | PASS，5/5 |
| `git diff --check`、ACL `D3EACE19…69699` | PASS |
| 新 profile APK（Haiku 5.5 max 执行） | PASS：`fix-20261011/build/EpubStart-paper-ink-fix-x86_64-profile-20261011.apk`，SHA256 **A89684D37E925DD9398284DE7E58F15F178CF08588ABA228F9F8D9E36994D2AE**，27,104,135B；x86_64/profile/现有 debug 签名，assets 4/4 与新 dist 一致；56 项输入摘要 `16A6A82F…B1ECB1`。六份 schema 恢复、ACL 不变、工作区字节与原 AVD 等 15 项保护一致 |
| 系统栏图标（含 Home→返回） | PASS：dark 时 LIGHT_* 关闭，light/sepia/书架开启；同 PID 暂停恢复后仍跟随 |
| 竖屏安静页脚 | PASS：y652.1488–696.1488，高 44，位于 32.04px 底部预留区之上 |
| 字号滑块 21→27 快速拖动 | 合并 PASS；2s 稳定目标 FAIL：正文 21→22（约1.2s，正在执行的一轮）→27（约3.2s），中间 23–26 未重排，之后 CFI 稳定且持久化 27。模拟器为软件渲染且期间出现系统 ANR，真机耗时未测 |
| 书架标签/批注入口 | PASS：操作面板进入标签页预选该书；书架页签与头部批注入口均为默认第一本 |

`F2/` 指 `target/ui-paper-ink-native/fix-20261011/`，证据见 `F2/acceptance/checks.ndjson`、`screens/`、`closeout*.json`。收尾时副本已停、9223 移除，旋转读到 `accelerometer_rotation=0`（来源未查明）已恢复 1/0；6.epub dark/22、全局 dark/18、六本书保留。安装前备份在 `F2/acceptance/profile-before/`。旧 `AF781F3B…6345` 只作修前材料。横屏、冷启、删除/导入/SAF 及其余 NOT_RUN 范围同上节。
