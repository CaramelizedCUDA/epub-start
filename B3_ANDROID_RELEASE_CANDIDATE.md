# B3 Android arm64 release 候选复测

日期：2026-08-28
来源提交：本轮 B3 收口提交（普通 release 与 `b3-diagnostics` release-like 诊断包均从同一工作树生成）
状态：**B3 技术冻结完成；候选未签发**。当前 arm64 静态制品、两台真实 arm64 设备的空白安装/首次启动、37 个固定样本运行态占用和 release-like 私有 data 分项均已取得范围内证据；正式 release 签名仍属最终发布门禁。

## B3 两阶段门禁

本文件区分两个结果：

1. **B3 技术冻结**：当前提交的 arm64 候选完成固定样本运行时占用、release-like 私有 data 精确分项，并与既有自动化、Windows、Android 来源链和资源预算证据合并后，冻结 Command、模型、错误、数据库、资源预算和来源状态语义。该结果是生产 F1–F3 的后端输入；本轮已达到该状态。
2. **B3 发布候选签发**：在技术冻结之后，用正式 release keystore 完成签名并记录签名制品。它是最终对外发布门禁，可推迟到前后端接近完成时，不阻塞隔离设计或 F1/F2 的开发验证。

本轮用于私有 data 统计的诊断包必须显式启用 `b3-diagnostics` Cargo feature，并单独标记为 release-like 诊断构建；普通 release 不注册诊断 Command，也不把诊断面板或报告文件打入发布制品。

## B3 样本集更新（2026-08-28）

后续 B3 复测不再只使用单个 `6.epub`。当前固定样本改为 [B3_ANDROID_SAMPLE_MANIFEST.md](B3_ANDROID_SAMPLE_MANIFEST.md) 中的 37 个唯一 EPUB，合计 215,965,079 字节（约 205.99 MiB）。37 个样本均已通过 ZIP、`META-INF/container.xml` 和 OPF rootfile 结构检查；根目录副本与附件副本因 SHA-256 完全相同而排除。本轮黑鲨与荣耀均完成 37/37 项导入/选择，实际占用结果见下文。

本轮已按清单完成两台设备的固定样本运行态复测。由于样本复测没有在两台设备上重新卸载并清空数据，以下是完整样本导入后的实际应用 data 观察值，不把跨设备差异解释为干净基线下的单本增量；B2 的单固定 EPUB 长期压力 fixture 仍按 [ANDROID_STORAGE_ACCEPTANCE.md](ANDROID_STORAGE_ACCEPTANCE.md) 原口径执行。

## 构建方式

- 先执行 Android Gradle 根工程与 `:app` clean；只删除项目构建输出，不清理 Cargo/Gradle 下载缓存、用户数据或 AVD 数据。
- 显式使用项目规定的 `D:\Android\Sdk`、NDK `27.3.13750724` 与 JDK `17.0.20`。
- `npm.cmd run tauri -- android build --target aarch64 --ci` 已完成当前源码的前端 production build 和 aarch64 Rust release 编译，并把新原生库同步到 `jniLibs/arm64-v8a`。Gradle 打包首次因 Google Maven TLS 无法重新取得四个 AndroidX 旧制品而中止；这不是代码、ABI 或 lint 失败。
- 随后复用 2026-08-23 已独立校验的 `D:\Android\offline-google-maven`，通过位于已忽略 `target/` 下的临时 init script，仅把缺失的精确模块版本绑定到本地仓库。`:tauri-android:generateReleaseLintModel` 在 `--offline` 下通过。
- 最终执行 `:app:assembleArm64Release` 与 `:app:bundleArm64Release`。该步跳过重复的 `rustBuildArm64Release` Gradle hook，因为同一次候选生成中，前述 Tauri CLI 已重新编译并同步当前提交的原生库；没有复用 2026-08-22 的旧 `.so`。

临时 init script 和所有 APK/AAB/`.so`/Gradle 报告均位于忽略目录，不纳入 Git。

## 静态制品结果

`npm.cmd run audit:android-release` 于当前工作树通过：

| 分项 | 当前值 | 相对已提交基线 | 结论 |
| --- | ---: | ---: | --- |
| arm64 APK | 11,960,465 B（11.406 MiB） | +3.49% | 低于 40 MiB 绝对上限与 10% 回归门禁 |
| arm64 AAB | 11,769,321 B（11.224 MiB） | +3.55% | 通过 10% 回归门禁 |
| Cargo release `.so` | 13,229,512 B（12.617 MiB） | +1.45% | 低于 30 MiB 绝对上限 |
| APK 内运行时 `.so` | 8,952,024 B（8.537 MiB） | +0.00% | 通过回归门禁 |
| 前端 `dist` | 596,824 B（4 文件，0.569 MiB） | +0.20% | 低于 2 MiB 绝对上限 |
| AAB symbol metadata | 12,650,912 B（12.065 MiB） | 不计安装占用 | 仅随 AAB 元数据保存 |

APK 与 AAB 的 ABI 集均只有 `arm64-v8a`；打包 ELF 均为 AArch64，未发现禁止的 `.debug*`、`.symtab`、`.strtab`，也未发现测试 EPUB、预置缓存或宿主路径 payload。

制品哈希：

- APK SHA-256：`626C60F025C14A4CC4CAE3F55A0BFEBADDD93F1EB2F03BFDA5BDD266E526E194`
- AAB SHA-256：`44BFFA39CD149C147EE6714EE46DDB80B6728DEEA41B3CABF994856EF5FF5FF9`
- Cargo release `.so` SHA-256：`449FEC7032D64316C19C58A7BD032C831616AA7ABE4FD8703093075204A105A6`

## Gradle release lint

完整 `:app:lintArm64Release` 在相同当前源码、本地校验仓库和离线解析条件下 `BUILD SUCCESSFUL`：

- 0 errors
- 31 warnings
- 1 hint

没有使用 lint baseline、禁用检查或跳过 lint 分析任务。release 打包自身的 `lintVitalArm64Release` 也通过。现存 warning 为非阻塞上游/兼容性提示；Gradle 8.14.3 另提示项目使用了将在 Gradle 9 移除的 deprecated features。

## arm64 设备空白安装与首次启动

本轮使用当前工作树生成的 **unsigned arm64 release APK** 做静态候选；两台设备的既有空白安装证据对应同一 APK SHA-256 的 debug-keystore 签名副本。为进行后续样本取证，又使用同一源码的 release-like `b3-diagnostics` 副本；签名只改变 APK 签名块，不改变候选的 arm64 原生库、前端资源或 release manifest，这些副本都不是正式发布签名。

| 设备 | Android | 当前 ABI | 空白安装 | 首次启动 | 运行态摘要 |
| --- | --- | --- | --- | --- | --- |
| 黑鲨 SKW-A0 | 9 / API 28 | `arm64-v8a`（abilist 还列出 32-bit ABI） | 卸载后全新安装成功 | `am start -W`：`Status: ok`，主 Activity 可见 | 无 crash；主进程 PSS 146,233 KiB，WebView 1 个 |
| 荣耀 PPG-AN00 | 15 / API 35 | `arm64-v8a` | 卸载后全新安装成功 | `monkey` 启动成功，主 Activity 可见 | 无 crash；主进程 PSS 151,491 KiB、RSS 315,348 KiB，WebView 1 个 |

黑鲨第一次通过 `monkey` 触发后仍回到桌面，不能直接算作启动通过；随后使用显式 `am start -W -n com.epubstart.reader/.MainActivity` 重试，得到 `Status: ok`、`Displayed ... +145ms`，进程保持运行，`stopped=false`、`notLaunched=false`，无 crash buffer 记录。因此黑鲨最终运行态按显式启动复测结果记录，不掩盖第一次观察。

两台设备的包管理器均确认 `primaryCpuAbi=arm64-v8a`、`secondaryCpuAbi=null`、`versionCode=1000`、`versionName=0.1.0`，并能解析 `dataDir=/data/user/0/com.epubstart.reader`。本轮设备证据位于：

- `target/b3-arm64-runtime-20260824/blackshark-skw-a0/`
- `target/b3-arm64-runtime-20260824/honor-ppg-an00/`
- `target/b3-arm64-runtime-20260824/app-arm64-release-debug-signed.apk`

普通 release 变体本身不是 debuggable，两个设备上的 `run-as com.epubstart.reader` 均按预期拒绝；Android shell 也无权遍历应用私有目录。因此普通 release 不直接提供私有 data 读数，私有 data 分项改由下节的 feature-gated release-like 诊断包取证。`df` 的设备级可用空间差值会受系统 dexopt、厂商服务和后台活动影响，只作为环境记录，不当作应用 data 大小。

## 固定样本运行态与 release-like 私有 data 分项（2026-08-28）

普通 release 使用上面的 unsigned APK/AAB 完成静态门禁；设备取证使用同一源码、显式启用 `b3-diagnostics` 的 release-like 诊断 APK，并以本地 debug keystore 签名后安装。该签名副本只用于诊断，不是正式发布签名；诊断 APK 位于忽略的 `target/` 目录，不进入 Git。

两台设备均按 [B3_ANDROID_SAMPLE_MANIFEST.md](B3_ANDROID_SAMPLE_MANIFEST.md) 完成 37/37 个样本的选择/导入。报告只通过 logcat 观察，不写入应用 data。由于这次样本复测没有在每台设备上重新卸载并清空数据，以下是导入完整样本后的实际占用观察值，不是可跨设备比较的干净基线增量：

| 设备 | 书籍样本执行 | `total_bytes` | 数据库 | 来源缓存 | 封面缓存 | 其它 | 搜索账面/文档数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 黑鲨 SKW-A0 | 37/37 | 232,900,308 B | 487,424 B | 216,516,206 B | 15,807,896 B | 88,782 B | 0 B / 0 |
| 荣耀 PPG-AN00 | 37/37 | 231,629,804 B | 471,040 B | 211,942,939 B | 14,908,943 B | 4,306,882 B | 0 B / 0 |

两次导入都产生了非空应用 data；荣耀在复测前已有旧书数据，黑鲨也不是本轮重新卸载后的零数据状态，因此不能把两列差异归因于 OEM 或某一本 EPUB。该证据证明固定样本导入链和分类统计可运行，并为后续正式签名前的复核保留了可重复输入。

为便于核对导入规模，诊断报告后来追加了只读 `book_count` 字段；其 Rust 单元测试已完成“故意返回 0 → 目标断言变红 → 修复查询 → 变绿”自证。追加字段后的诊断包已重新构建、签名并安装到两台设备，但设备随后进入锁屏，未能重新打开诊断面板取得现场书籍计数。因此本轮不把 `book_count` 写成 Android 运行态已验证项；上表的字节分类来自紧邻的、分类逻辑完全相同的诊断运行。

本轮额外边界：完整样本后的黑鲨匹配 PSS 未重新采集；荣耀最后一次捕获为 `TOTAL PSS 237633 KiB`、`TOTAL RSS 340580 KiB`。这些内存数受系统和后台进程影响，不作为跨设备发布预算，只作为运行态线索。

## 覆盖清单

已验证：

- 当前提交的前端 production build 与 aarch64 Rust release 编译；
- arm64 APK/AAB 的重新打包、ABI、ELF、禁止载荷、绝对体积和相对基线；
- 当前 arm64 变体的完整 Gradle release lint（0 error、31 warning、1 hint）；
- 候选制品与原生库 SHA-256；
- 两台真实 arm64 设备的卸载后空白安装、包 ABI、主 Activity 首次启动、WebView 进程/实例和主进程内存占用；
- 黑鲨首次 `monkey` 启动未保持运行后的显式 `am start -W` 重试与无 crash 复核；
- 两台真实 arm64 设备按固定清单完成 37/37 样本导入，以及 release-like 诊断构建的物理 data 分项观察；
- `book_count` 诊断字段的辅助逻辑变红自证和当前 ordinary/diagnostic 构建产物。

未验证：

- 重新卸载后的干净空白基线与逐本可比的 data/PSS 增量；
- 追加 `book_count` 字段后的设备现场书籍计数（设备锁屏导致诊断面板未重新打开）；
- 正式 release 签名；
- 更广 OEM/真实设备上的前端消费、WebView、性能和手势矩阵。

本轮 `adb devices -l` 在线设备为黑鲨 `SKW-A0` 与荣耀 `PPG-AN00`，两者均为 arm64；受控 `EpubStart_B2_API35` AVD 仍为 `x86_64`，不参与本轮 arm64 证据。B3 技术冻结已完成，生产 F1–F3 可以以冻结后的后端契约为输入推进；本文件仍明确标记为**候选未签发**，因为正式 release keystore 签名和干净基线增量复核属于最终发布门禁/后续复核，不在本轮宣称完成。
