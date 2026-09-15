# EPUB 首版代码交接 — 2026-09-15

> 最新接续：资源优化标识 `20260915-resource-optimized-1` 已将前端资源降至 652,245 B（相对原基线 +9.50%），新 Android 制品的资源审计通过。用户要求先优化，测试候选及回归/真机验收暂缓。详见 [同阶段后续记录](verification/e5-e11-epub-closeout-2026-09-14.md#2026-09-15-资源优化测试暂缓)。下文保留 `code-ready-1` 的原始结果，不改写其资源审计 FAIL。

## 本轮目标

按用户最新决定，先完成代码、相关自动检查及 Windows/Android 生产编译，在接近发行时集中进行交付测试。版本声明沿用 `0.1.0`，本轮标识为 `20260915-code-ready-1`；这是开发候选标识，不是新的正式发布版本。

源码来自 `c121d24f37c7196cf8efbce4a2c349c4d3a18ed6` 加本地整合补丁。当前候选目录 `D:\epub_start-epub-closeout-20260914` 不含 `.git`；原仓库 `D:\epub_start` 的分支、未提交 ACL、设计草稿和 Android assets 保留。没有提交、推送、标签或远端成果分支。

## 代码范围

| 范围 | 本候选代码情况 |
| --- | --- |
| E5 阅读引擎 | EPUB 构造/销毁、定位与受控请求归 engine；切书隔离、串行进度保存、重排/锚定与退出冲刷已接入。翻页表面跟手/回弹迁入 `engine/pageTurn.ts`，退出后旧控制器不能绑定新书或恢复旧动画。 |
| E6 目录与搜索 | 目录、书内搜索、系列索引/取消/状态轮询及命中章节跳转已接入；保留章节级精度提示及迟到结果隔离。 |
| E7 批注与图片 | 创建/编辑/删除/列表跳转与高亮接线、图片查看与桌面导出入口已具备；补齐旧写入/旧列表隔离、旧范围清理以及空 rendition 的交互绑定。Android 图片导出仍明确不支持。 |
| E8 设置与计时 | 全局/单书设置顺序写入、覆盖清除后重排、离页冲刷、可见计时/暂停/恢复/失效句柄处理已接入。 |
| E9 输入与布局 | 既有视觉保持；正文 iframe 非 passive 键盘监听、IME/编辑/浮层保护、手势和全屏入口已具备。分页保留 EPUB.js 的列边距，避免列距与翻页步长不一致。 |

代码存在与自动检查通过，只说明当前代码交接范围；各平台完整操作结果仍由后续交付测试确定。没有新增依赖、IPC、Schema、P3/P4、新格式、远程来源或同步功能。

## 已知验收反馈的处理

2026-09-15 用户手动验收报告：翻页后文字跨页、分页切到滚动后全白；其它项目未验证。白屏现场日志和测试库快照已保存。

- 白屏原因：新 rendition 尚未创建 manager，`views()` 返回普通数组；图片交互调用 `views().all()` 抛错，React 卸载界面。现在切换期间保持 loading，交互从 `getContents()` 安全读取，失败保留错误并解除 loading，退役监听不再重新附着。
- 跨页原因：1200px 双页下 EPUB.js 计划每页 600px，清除 body 两侧各 16px 的分页边距后，CSS 实际列距变成 616px。现在保留 EPUB.js 边距；修复后的实际 DOM 曾测得列距恢复 600px，并完成连续向前/向后翻页。
- 此前中断的诊断命令已落盘：分页到滚动得到非空正文、loading=false、无捕获异常。这是当时修复的局部开发态证据，不能代替此后移动手势控制器后的最终交付测试。

原 FAIL 和其它 NOT_RUN 保留在同阶段记录中。本轮按用户决定不再启动程序、安装到设备或继续手动验收。

## 自动检查与构建

结果以同阶段 [验证记录](verification/e5-e11-epub-closeout-2026-09-14.md) 及交接包 manifest 为准。已通过前端生产构建、Reader 50/50 自动回归；新增 5 项定向变红及恢复均通过。测试仍替换 EPUB.js/DOM/IPC 边界，不能据此声称真实 CFI/SQLite/SAF 通过。

| 检查/产物 | 本轮结果 |
| --- | --- |
| TypeScript/Vite 前端生产构建 | PASS |
| Reader 自动回归 | 50/50 PASS，源码摘要 `19f414647410`；本轮控制台结果，未另存完整回归原始日志 |
| 新增测试故障发现能力 | 5 项目标断言变红，恢复后 5 项通过；证据 `regression-red-green-v2/summary.json` |
| Windows x64 release | PASS，EXE 12,683,776 字节，ProductVersion `0.1.0`；未生成安装器，Authenticode `NotSigned` |
| Android arm64 release | PASS，APK 11,732,704 字节、AAB 11,550,546 字节；未签名构建，未安装 |
| Android 包内版本 | `com.epubstart.reader`，versionName `0.1.0`、versionCode `1000`，minSdk 24、targetSdk 36；只含 `arm64-v8a` |
| Android 完整 lint | PASS，0 error、31 warning、1 hint；未关闭 lint |
| Android 静态资源审计 | **FAIL**：前端资源 726,031 字节（0.692 MiB），相对 2026-08-22 基线增长 21.89%，超过 10% 增幅限制。低于 2 MiB 绝对上限；APK/AAB/原生库大小、ABI 和 ELF 检查通过。原预算和基线未改动。 |

因此，本候选可作为代码与构建接续成果，不能称为“所有发行检查通过”。资源增幅问题单列为发行准备事项，后续应先分析并缩减无效资源；确需调整基线时按项目授权处理，不能为消除失败而直接抬高预算。

Windows 使用原有可再生成 Cargo 缓存；Android 使用候选自己的 Cargo target，避免跨源码目录共享缓存遗漏生成的 Kotlin 基类。Java 17、SDK/NDK 和锁定依赖沿用本机既有工具链。构建不启用 `b3-diagnostics`。

建议重建命令（从源码根目录执行）：

```powershell
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npm.cmd run test:frontend -- --reader
if ($LASTEXITCODE -ne 0) { throw 'Reader regression failed' }
npm.cmd run tauri -- build --no-bundle
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed' }

$env:JAVA_HOME = 'D:\Android\jdk17\jdk-17.0.20+8'
$env:ANDROID_HOME = 'D:\Android\Sdk'
$env:NDK_HOME = 'D:\Android\Sdk\ndk\27.3.13750724'
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) 'src-tauri\target'
[Environment]::SetEnvironmentVariable('ORG_GRADLE_PROJECT_kotlin.incremental', 'false', 'Process')
[Environment]::SetEnvironmentVariable('ORG_GRADLE_PROJECT_kotlin.compiler.execution.strategy', 'in-process', 'Process')
npm.cmd run tauri -- android build --target aarch64 --ci
if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
```

这些是构建命令，不会安装或启动产品。JDK/SDK 路径应与实际本机一致；Kotlin 两个进程级设置用于本机 Cargo 位于 C:、工程位于 D: 的增量编译路径问题，不修改全局设置或项目依赖。

本次又对同一轮新生成的 arm64 原生库执行 `assembleArm64Release`、`bundleArm64Release` 和 `lintArm64Release`，只跳过已经完成的重复 Rust hook。离线 lint 缺失的既定 JUnit/Hamcrest 版本从本机已有 Maven 缓存补充仓库解析，5 项文件摘要与 Maven Central 的官方摘要匹配。该临时初始化文件在交接包中，未改源码依赖或锁文件；不要将跳过 Rust hook 作为干净重建的默认步骤。完整命令和前置条件见同阶段验证记录。

## 发行前集中处理

1. 冻结实际候选和版本身份，按同阶段 R/S/N/I/P/T/U/A/Q 清单完成 Windows、Android 9/15 交付测试；Linux 若纳入发行，另有本平台构建与运行证据。
2. 重点复测本次两项反馈，以及切书、字号/窗口/模式重排、退出重启、搜索、批注、图片、计时和 SAF。未测保持未测，不重新执行无变化的后端压力实验。
3. 处理当前前端资源增幅失败，再对冻结后的实际候选执行资源审计；不能复用本轮失败为通过证据。
4. 项目许可证与最终签名由发行阶段决定；当前代码包和未签名构建不构成正式签发。最终签名制品才做安装/升级/阅读恢复测试。
5. Git 接收和合并步骤随本轮补丁交付。先在新目录验证，保留原工作区未提交/未跟踪内容，不使用 `reset --hard` 或 `git clean`。

本轮输出目录：`D:\epub-start-deliveries\epub-closeout-20260914-local-20260915\code-ready-20260915`。补丁/源码包/构建文件 SHA-256、精确检查结果和工具链见其中 manifest。
