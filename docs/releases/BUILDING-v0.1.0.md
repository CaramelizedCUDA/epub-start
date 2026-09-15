# 从源码构建 EpubStart v0.1.0

## 获取对应源码

首版源码位于本仓库 `v0.1.0` 标签，Release 同时提供 `EpubStart-0.1.0-source.zip`。源码归档含前端、Rust 后端、Android 工程、构建脚本、依赖锁定文件及项目许可。

第三方源代码按其原有许可证提供。`EpubStart-0.1.0-third-party-sources.zip` 包含选定 Windows/Android 依赖图中的准确版本 Rust crate 源码、前端生产依赖的已安装源码，以及可获得的 Android 运行时 sources JAR。完整版本、上游来源和许可见第三方归档中的清单；npm/Cargo/Gradle 会按项目声明解析构建所需依赖。开发工具和平台 SDK 需自行准备。

## 已使用的工具链

Node.js 22.22.2、npm 10.9.7、Rust 1.97.1；Windows 使用 MSVC 和 WebView2。Android 使用 JDK 17.0.20、SDK 36、NDK 27.3.13750724、Gradle 8.14.3、AGP 8.11.0。Tauri Rust 版本 2.11.5，具体包版本以锁定文件为准。

## 构建

在源码根目录：

```powershell
npm ci
npm run tauri -- build --no-bundle --ci -- --locked
```

Android 配好 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`，安装 Rust `aarch64-linux-android` 目标后：

```powershell
npm ci
npm run tauri -- android build --target aarch64 --ci -- --locked
```

使用项目中已有的 Android Gradle 工程，不覆盖自定义 Kotlin 插件和配置。Tauri 会生成本机路径相关的 Gradle 接线和构建资源。离线构建仅在既有依赖缓存完整时可用；首次构建不要跳过 Rust hook 或复制旧原生库。

命令会构建 unsigned APK/AAB。自行构建的 APK 可使用自己的签名密钥签名，但通常不能直接覆盖官方安装；私钥不属于对应源码，也不随发行包提供。签名过程和对首版载荷的核对见 [发布记录](../verification/release-v0.1.0-2026-09-16.md)。

## 附上许可并签名 Android APK

将 Release 的许可证 ZIP 解压，把其中 `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.txt`、`DEPENDENCY_SOURCES.json` 放到一个暂存目录的 `META-INF/epubstart/` 下。复制 unsigned APK 为待签名副本，然后使用 JDK 和 Android Build Tools：

```powershell
jar --update --file app-with-notices.apk -C license-stage META-INF/epubstart
zipalign -P 16 -f 4 app-with-notices.apk app-aligned.apk
apksigner sign --ks your-release.p12 --ks-key-alias your-alias --ks-pass file:your-private-password-file --v4-signing-enabled false --debuggable-apk-permitted false --out EpubStart.apk app-aligned.apk
apksigner verify --verbose --print-certs EpubStart.apk
zipalign -c -P 16 -v 4 EpubStart.apk
```

命令中的文件名和私密凭据位置应替换为自己的值。不要把密钥、密码文件或旧设备数据库放进源码/发行归档。Windows 发行 ZIP 则在 EXE 旁附上相同的许可证与声明文件。

完整平台环境、检查命令和开发运行方法见 [开发指南](../DEVELOPMENT.md)。

## 本次制品的可复现边界

首版业务代码来自验收候选 `20260916-dual-fix-2`，业务源码提交 `1a9175728c1b478e831ddebf3bca0a0ea3098bc7`；后续发布提交只补许可、声明、文档和打包工具，没有改变阅读代码。

Windows EXE 使用普通应用身份从该业务源码构建。Android 使用同一候选生成的 arm64 release 载荷，追加 `META-INF/epubstart/` 下的许可文本并对齐、正式签名；原有每个 ZIP 文件条目均逐字节核对相同。构建时间戳、压缩器和签名会影响制品字节，源码与命令可重建相同功能，不宣称不同环境逐字节复现 EXE/APK。
