# B3 Android arm64 release 候选复测

日期：2026-08-24
来源提交：`ce97a535e452eb90e5a08cb5c64fa1432c38e5b3`（与当前 `HEAD` 的生产代码和 Android 工程无差异；后续提交仅加入隔离设计探索材料）
状态：**静态候选通过；两台真实 arm64 设备已完成空白安装与首次启动运行态复测；固定样本运行时占用和正式 release 签名仍未签发**。

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
| Cargo release `.so` | 13,040,512 B（12.436 MiB） | +0.00% | 低于 30 MiB 绝对上限 |
| APK 内运行时 `.so` | 8,952,024 B（8.537 MiB） | +0.00% | 通过回归门禁 |
| 前端 `dist` | 596,444 B（4 文件，0.569 MiB） | +0.13% | 低于 2 MiB 绝对上限 |
| AAB symbol metadata | 12,650,912 B（12.065 MiB） | 不计安装占用 | 仅随 AAB 元数据保存 |

APK 与 AAB 的 ABI 集均只有 `arm64-v8a`；打包 ELF 均为 AArch64，未发现禁止的 `.debug*`、`.symtab`、`.strtab`，也未发现测试 EPUB、预置缓存或宿主路径 payload。

制品哈希：

- APK SHA-256：`626C60F025C14A4CC4CAE3F55A0BFEBADDD93F1EB2F03BFDA5BDD266E526E194`
- AAB SHA-256：`44BFFA39CD149C147EE6714EE46DDB80B6728DEEA41B3CABF994856EF5FF5FF9`
- Cargo release `.so` SHA-256：`E54496A3D5F9E95CE7CEC03264022982AC9DA52AB848DF14B308D9548D811A1F`

## Gradle release lint

完整 `:app:lintArm64Release` 在相同当前源码、本地校验仓库和离线解析条件下 `BUILD SUCCESSFUL`：

- 0 errors
- 31 warnings
- 1 hint

没有使用 lint baseline、禁用检查或跳过 lint 分析任务。release 打包自身的 `lintVitalArm64Release` 也通过。现存 warning 为非阻塞上游/兼容性提示；Gradle 8.14.3 另提示项目使用了将在 Gradle 9 移除的 deprecated features。

## arm64 设备空白安装与首次启动

本轮使用当前提交生成的 **unsigned arm64 release APK** 做静态候选；为使 Android 接受本地安装，先用现有 debug keystore 重新签名了一份仅用于运行态复测的副本。签名只改变 APK 签名块，不改变当前候选的 arm64 原生库、前端资源或 release manifest；该副本不是正式发布签名。

| 设备 | Android | 当前 ABI | 空白安装 | 首次启动 | 运行态摘要 |
| --- | --- | --- | --- | --- | --- |
| 黑鲨 SKW-A0 | 9 / API 28 | `arm64-v8a`（abilist 还列出 32-bit ABI） | 卸载后全新安装成功 | `am start -W`：`Status: ok`，主 Activity 可见 | 无 crash；主进程 PSS 146,233 KiB，WebView 1 个 |
| 荣耀 PPG-AN00 | 15 / API 35 | `arm64-v8a` | 卸载后全新安装成功 | `monkey` 启动成功，主 Activity 可见 | 无 crash；主进程 PSS 151,491 KiB、RSS 315,348 KiB，WebView 1 个 |

黑鲨第一次通过 `monkey` 触发后仍回到桌面，不能直接算作启动通过；随后使用显式 `am start -W -n com.epubstart.reader/.MainActivity` 重试，得到 `Status: ok`、`Displayed ... +145ms`，进程保持运行，`stopped=false`、`notLaunched=false`，无 crash buffer 记录。因此黑鲨最终运行态按显式启动复测结果记录，不掩盖第一次观察。

两台设备的包管理器均确认 `primaryCpuAbi=arm64-v8a`、`secondaryCpuAbi=null`、`versionCode=1000`、`versionName=0.1.0`，并能解析 `dataDir=/data/user/0/com.epubstart.reader`。本轮设备证据位于：

- `target/b3-arm64-runtime-20260824/blackshark-skw-a0/`
- `target/b3-arm64-runtime-20260824/honor-ppg-an00/`
- `target/b3-arm64-runtime-20260824/app-arm64-release-debug-signed.apk`

release 变体本身不是 debuggable，两个设备上的 `run-as com.epubstart.reader` 均按预期拒绝；Android shell 也无权遍历应用私有目录。因此本轮**不声称精确的应用私有 data 字节分项**。`df` 的设备级可用空间差值会受系统 dexopt、厂商服务和后台活动影响，只作为环境记录，不当作应用 data 大小。固定 EPUB 导入后的运行时占用尚未在这份 arm64 候选上执行。

## 覆盖清单

已验证：

- 当前提交的前端 production build 与 aarch64 Rust release 编译；
- arm64 APK/AAB 的重新打包、ABI、ELF、禁止载荷、绝对体积和相对基线；
- 当前 arm64 变体的完整 Gradle release lint；
- 候选制品与原生库 SHA-256；
- 两台真实 arm64 设备的卸载后空白安装、包 ABI、主 Activity 首次启动、WebView 进程/实例和主进程内存占用；
- 黑鲨首次 `monkey` 启动未保持运行后的显式 `am start -W` 重试与无 crash 复核。

未验证：

- release 私有 data 的精确字节分项（release 不可 `run-as`，设备 shell 无权读取）；
- 当前 arm64 候选导入固定 EPUB 后的运行时占用；
- 正式 release 签名；
- 更广 OEM/真实设备上的前端消费、WebView、性能和手势矩阵。

本轮 `adb devices -l` 在线设备为黑鲨 `SKW-A0` 与荣耀 `PPG-AN00`，两者均为 arm64；受控 `EpubStart_B2_API35` AVD 仍为 `x86_64`，不参与本轮 arm64 证据。当前已关闭本候选的空白安装、首次启动和主进程运行态证据缺口，但因固定样本运行时占用、精确私有 data 分项和正式 release 签名仍未完成，本文件仍不签发完整 B3 发布候选。
