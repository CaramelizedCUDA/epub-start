# B3 Android arm64 release 候选复测

日期：2026-08-24
来源提交：`ce97a535e452eb90e5a08cb5c64fa1432c38e5b3`
状态：**静态候选通过；设备安装/运行时占用未签发**。

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

## 覆盖清单

已验证：

- 当前提交的前端 production build 与 aarch64 Rust release 编译；
- arm64 APK/AAB 的重新打包、ABI、ELF、禁止载荷、绝对体积和相对基线；
- 当前 arm64 变体的完整 Gradle release lint；
- 候选制品与原生库 SHA-256。

未验证：

- 当前 arm64 候选的空白安装、首次启动 code/data 分项及固定样本运行时占用；
- 正式 release 签名；
- 更广 OEM/真实设备上的前端消费、WebView、性能和手势矩阵。

本轮 `adb devices -l` 没有在线设备；现有受控 `EpubStart_B2_API35` AVD 为 `x86_64`，不能安装 arm64-only APK。B2 已有的 x86_64 profile 空白安装与受控存储证据继续有效，但不能替代本候选的 arm64 安装证据。因此本文件关闭 B3 发布候选门禁的静态部分，不签发其设备运行时部分。
