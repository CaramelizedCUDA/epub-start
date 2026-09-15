# v0.1.0 发布记录 — 2026-09-16

## 范围与许可

维护者确认首版采用 GNU GPL 第三版，按 `GPL-3.0-only` 落地。仓库保留完整 LICENSE、项目 NOTICE 和第三方声明；本次发布 Windows x64 免安装 ZIP、Android arm64 APK，以及对应源码和许可归档。

业务代码继续对应 `1a9175728c1b478e831ddebf3bca0a0ea3098bc7` / `20260916-dual-fix-2`。本次只补许可、签名、打包与发布文档；不修改 Reader、Rust 业务代码、IPC、迁移、依赖版本或权限。维护者此前停止追加验收的决定继续有效；不把本次公开 Release 描述为历史 E10/E11 全矩阵通过。

## 最终制品检查

| 项目 | 结果 |
| --- | --- |
| Windows EXE | 0.1.0，12,660,736 B；复用普通应用身份构建，归档内 SHA-256 与原 EXE 一致 |
| Windows Authenticode | 未签名，下载说明已注明；本次不购买证书或追加启动测试 |
| Android 身份 | `com.epubstart.reader`；0.1.0 / versionCode 1000；minSdk 24 / targetSdk 36；只含 arm64-v8a |
| Android 配置 | 非 debuggable，usesCleartextTraffic=false，权限与原验收载荷一致 |
| Android 正式签名 | 专用 RSA 3072 密钥；apksigner v2/v3 验证通过 |
| APK 对齐 | zipalign 4-byte / 16 KiB native 检查通过 |
| APK 载荷 | 原验收 APK 的 921 个文件条目逐字节一致；只增加 4 个许可/来源文件和签名元数据 |
| APK 体积 | 11,990,734 B，较既定基线 +3.747%，低于 10% 增幅与 40 MiB 上限 |
| 前端与原生库 | 与原验收载荷逐字节一致；复用原候选 ELF、ABI 和资源审计，前端 654,755 B / +9.92% |
| 归档 | Windows、许可证、第三方源码 ZIP CRC 完整、无重名或路径穿越条目；项目源码 ZIP 由发布提交生成并在上传前核对 |

Android 正式签名证书 SHA-256：

`ecaffd7e88541dd62edd7bbe8828d8118d32e91c46cd6d181b11f7e1c2adc5ca`

最终 APK SHA-256：

`bbd8d3161d061ee74df61ad6005e7a238f793a5244fb8e7491ebcb6caf5fad62`

所有发布文件与最终发布提交号记录于 Release 附件 `build-manifest.json`、`SHA256SUMS.txt`。源码入口与打包说明见 [构建首版](../releases/BUILDING-v0.1.0.md)。

## 第三方来源

整理 328 个 Rust 包、43 项前端生产依赖和 79 项 Android 运行时依赖（保守包含相关构建依赖和可能未进入二进制的组件）。保留包内或对应上游的原始许可；元数据声明 MIT 但未附独立许可文件的少数包，附上其原始元数据和相应许可文本，不伪造上游版权年份。

Rust 源码 crate 与 Cargo.lock 校验值一致；提供前端安装包源码，并为已识别的预编译前端包补充上游准确提交的首选源码；Android 提供可获得的准确版本 sources JAR 和全部元数据/来源入口。第三方继续适用原许可；MPL 组件源码随对应源码归档提供。

## 证据复用与未覆盖范围

复用同阶段 Reader 65/65、前端构建、相关 Windows/Android 15 真实运行证据、原生配置与依赖未变的完整 Android lint（0 error）。正式签名与附带文本只改变分发层，原 Reader 和原生载荷未变化，因此不重新扩展功能矩阵。

本次未在手机上安装最终正式签名 APK、未新增 Windows 最终 ZIP 的启动 smoke；准确保留该未测边界。改字号/模式/方向的位置变化、Android 横屏重启回退及其他首版限制见 [首版说明](../releases/v0.1.0.md)。

维护者的早期自用安装使用旧本地签名。为其准备了不公开分发的签名迁移 APK，旧→新证书链及保留安装数据能力已静态校验；尚未安装验证。正式公开 APK 在所有支持版本上使用专用正式密钥，私钥、密码、旧签名材料、迁移 APK 与手机数据均不进入仓库或公开 Release。
