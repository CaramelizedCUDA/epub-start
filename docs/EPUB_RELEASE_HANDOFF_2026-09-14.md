# EPUB 候选发布接续 — 2026-09-14

> 2026-09-16 当前入口：[首版说明](releases/v0.1.0.md)。验收代码已归入 main，本轮按维护者范围收尾；不再扩大测试。下文保留历史准备状态和当时门禁，不代表当前重新待做的全部工作。

> 最新接续：用户于 2026-09-15 决定先完成代码与 Windows/Android 构建，交付测试留到接近发行时。已产出未签名构建及更新补丁，前端资源增幅审计仍失败。当前事实见 [首版代码交接](EPUB_CODE_READY_2026-09-15.md)；下文保留云端交付时的准备说明和历史状态。

这是 E11 准备资料，不是发布通过记录。执行范围服从 `VERIFICATION.md`；场景与本轮事实见 `verification/e5-e11-epub-closeout-2026-09-14.md`。本轮基线为 `c121d24f37c7196cf8efbce4a2c349c4d3a18ed6`，无新提交/PR/正式制品。

## 1. 先冻结可识别、可复现的候选

先在独立 worktree 应用补丁、审查差异、运行正式前端 build/Reader 回归和规定的影响面检查。不要从本地含 ACL schema、P3/P4 草稿或 Android assets 的未提交工作区直接产生“已验收候选”。这些内容不属于云端补丁；需要合入时先评审，并按真实影响面补检查。

审核提交后记录 commit SHA、dirty 状态、`package-lock.json`/`Cargo.lock` hash、前端/原生声明版本、工具链、构建命令和输入 assets。基线 package.json 为 0.1.0；本轮未提高版本，也未证明各平台打包版本一致。最终版本由项目发布决定，届时检查 npm/Cargo/Tauri/Android versionCode/versionName，不能仅改发布说明。

同一候选在 Windows、Linux、Android 9 和 Android 15 使用同一套已审查源码。平台制品的字节 hash 可以不同，必须分别记录；禁止复制旧 `.so` 或混入旧 dist 后声称同源码。对必要的本地 Android 资源记录 hash/生成方式；未经批准的视觉草稿不能当作构建资源导入。

## 2. 构建与验证顺序

在候选目录先执行：

```powershell
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'production build failed' }
npm.cmd run test:frontend -- --reader
if ($LASTEXITCODE -ne 0) { throw 'Reader regression failed' }
```

本轮没有改 Rust/IPC/schema/资源预算，不为这组前端变更重跑无关后端审计。若随后合入本地 ACL、Rust、锁文件或其他契约改动，重新按 `VERIFICATION.md` 判影响面，不能继续套用“纯前端”结论。

真实 Windows 开发运行使用项目既有 `npm.cmd run tauri -- dev` 入口；先关闭其他实例并保护/隔离测试数据。**独立源码 worktree 不等于独立应用数据库**：不应仅凭改 APPDATA 环境变量就断言数据隔离；使用已确认的隔离配置或专用测试账户，并核实实际 data 路径。删除/清历史/来源失效只在可恢复的测试库进行。

Android 沿用 `DEVELOPMENT.md` 和 `../B3_ANDROID_RELEASE_CANDIDATE.md` 的工具链/构建路径。已有记录要求 SDK `D:\Android\Sdk`、NDK `27.3.13750724`、JDK `17.0.20`；应现场核对，不假定新 worktree 自动拥有旧工作区 Android assets/生成目录。不能把历史离线 Maven 回退或跳过 Rust hook 当成每次可用的固定捷径。

项目已有普通候选构建入口：

```powershell
npm.cmd run tauri -- android build --target aarch64 --ci
if ($LASTEXITCODE -ne 0) { throw 'Android candidate build failed' }
npm.cmd run audit:android-release
if ($LASTEXITCODE -ne 0) { throw 'Android static release audit failed' }
```

若生成工程缺失，按开发文档完成该独立目录的 Android 初始化；先核对需要的本地资源，再复制明确获准的资源或按已记录方式重新生成。构建失败应保留日志和真实原因，不偷偷借用旧原生库。完整 `:app:lintArm64Release` 仍是正式签发门禁；运行目录/生成工程和工具链均按实际构建填写。

普通发布不能启用 `b3-diagnostics` 或包含诊断前端入口/测试 EPUB/缓存/宿主路径载荷。诊断包、debug 签名副本、unsigned APK/AAB 和正式签名包分别命名、分别记录，不可互换结论。Linux 必须另有实际 Tauri/WebKitGTK 构建和业务矩阵，Node 或 WSL 逻辑检查不自动等于 Linux 桌面应用通过。

## 3. E10 签核材料

逐项完成本轮记录中的 R/S/N/I/P/T/U/A/Q 场景。设备现场记录至少包含候选 SHA、安装包 hash、应用版本、OS/API、WebView 版本、样本 hash、动作、观察、日志/截图/数据库查询证据和结论。真实 DOM CFI 应从 EPUB.js relocated 和实际 save/getReadingProgress 往返取证；不要手写位置字符串，或把单元测试中的 opaque token 用于业务证明。

对 Android SAF 要实际经过系统文件选择器并验证权限/来源变化；对计时要实际前台、锁屏/后台和重启；对持久化要真正关闭并重启应用，不能只重建 React 组件。任何未知、未执行或环境阻塞保留其状态，不借用旧版本通过值填表。

应用更新或安装签名不一致时停止检查原因，**不要为了跑通而卸载生产安装或清空用户数据**。升级测试使用兼容的测试签名/可恢复数据；空白安装只用专用测试环境。

## 4. E11 最终门禁

| 门禁 | 当前状态 | 完成时必须留存 |
| --- | --- | --- |
| E10 同源码完整矩阵 | 未完成 | Windows/Linux/Android 9/15 的逐场景结果和环境 |
| 生产构建/相关逻辑回归 | 本轮环境阻塞 | 正式 npm 入口日志，不是本轮离线替身日志 |
| 静态预算、ABI、禁止载荷 | 当前制品未生成 | `audit:android-release` 及对应制品 hash；不复用旧 size 当新结果 |
| 完整 release lint | 当前未运行 | 真实 Gradle 报告，不禁用 lint/不以旧报告代替 |
| 项目许可证 | 待用户决定 | 明确选择及适当项目文件；本次不代选；整理第三方声明但不宣称法律审查完成 |
| 最终签名 | 未签发 | 由本地受控凭据完成；只记录公开证书指纹、验证结果和制品 hash |
| 最终制品 smoke | 未执行 | 对最终签名包安装/启动/导入/翻页/退出/重启恢复，至少含正常升级/测试新装路径 |
| 发布资料 | 草稿 | 版本、commit、变更、平台支持/限制、已知问题、hash 和用户可复现的报告方式 |

签名密钥、密码、token 不入聊天/仓库/日志。签名完成后使用项目现有本地工具验证，例如对 APK 使用 `apksigner verify --verbose --print-certs`，AAB 使用适当的 JAR 签名验证，Windows 制品检查 Authenticode；具体工具路径和最终制品路径由当次构建记录给出。只跑 verify 不等于已完成最终业务 smoke。

构建最终包后重新记录其 SHA-256。E10 后又有代码或打包输入变化时按影响面补回归：仅 commit 编号变化不自动要求全部重跑，真实源码/锁文件/资源/权限变化也不能被“只是合并”掩盖。最终签发结论必须指向实际安装验证的那一个签名制品。

## 5. 发布说明草稿（不得标正式发布）

本轮候选修复阅读会话和迟到响应隔离、保存顺序、目录/搜索反馈及章节跳转、批注覆盖竞态、阅读设置清除/顺序写入、计时会话和键盘输入边界。保留 EPUB-only 与现有设计。

当前限制：尚未通过本轮完整生产构建和真实跨端矩阵；真实 CFI/重排/退出恢复、图片工具、锁屏计时、Linux 和双 Android 兼容/性能仍须验收。Android 图片导出未支持；固定/混合版式等超出原证据范围的能力不能据本轮推断通过。P3/P4、新格式、远程来源及跨设备同步不在本候选范围。
