# EpubStart

一个本地 EPUB 阅读器，支持书架管理、正文阅读和进度保存。

首版 **v0.1.0** 面向 **Windows x64** 与 **Android arm64**，采用 **GPL-3.0** 开源协议。下载文件与已知限制见 [首版说明](docs/releases/v0.1.0.md)。

## 当前功能

- 导入本地 EPUB、查看封面书架、打开正文和继续阅读。
- 目录、书内搜索、字号与排版设置。
- 文本高亮和批注、系列与标签管理。
- 本地阅读时长、足迹和基于书架的离线推荐。

首版验收重点是正常导入 EPUB，以及在选定排版下连续阅读。附加功能和各类 EPUB 的验证覆盖不完全相同，具体范围见 [验收记录](docs/verification/e5-e11-epub-closeout-2026-09-14.md)。

## 已知限制

- 修改字号、阅读模式或屏幕方向后，原句在页面中的位置可能改变；Android 横屏重启也可能回退到较早的阅读位置。
- Android 暂不支持将书内图片导出到外部文件。
- 尚未逐页验证所有书籍、所有固定或混合版式，以及所有 Android 机型。
- 本次不发布 Linux 或 iOS 版本；TXT、PDF、漫画压缩包等格式尚不支持。
- 不提供外部网盘接入或跨设备进度、批注同步。

## 下载与使用

从 [v0.1.0 Release](https://github.com/CaramelizedCUDA/epub-start/releases/tag/v0.1.0) 下载：

- **Windows x64**：解压 `EpubStart-0.1.0-windows-x64.zip`，运行其中的 `EpubStart.exe`。需要 WebView2 Runtime；应用数据保存在系统应用数据目录。EXE 未做 Authenticode 签名，Windows 可能显示发布者未知。
- **Android arm64**：下载 `EpubStart-0.1.0-android-arm64.apk` 安装。使用专用正式签名；与早期 debug/profile 测试包的签名不同，安装冲突时请保留旧数据并联系维护者。

下载页附有 SHA-256 校验值、完整许可证、第三方声明及对应源码。

安装后导入自己的 EPUB，选择舒服的字号与阅读模式即可开始阅读。问题反馈请附版本、系统、操作步骤和预期结果；不要公开上传私有书籍、来源路径或阅读历史。

## 从源码运行

准备 Node.js/npm、Rust 和对应平台的 Tauri 构建环境，在仓库根目录执行：

```powershell
npm ci
npm run tauri dev
```

仅运行 `npm run dev` 是前端开发服务器，不提供完整的本地阅读能力。详细环境、构建命令与样本说明见 [开发指南](docs/DEVELOPMENT.md)。

## 参与与许可

普通问题通过 [Issues](https://github.com/CaramelizedCUDA/epub-start/issues) 反馈；安全问题按 [安全策略](SECURITY.md) 私下报告。参与开发前请阅读 [文档索引](docs/README.md) 和 [实现规范](CONVENTIONS.md)。

EpubStart 采用 **GNU General Public License v3.0 only**（`GPL-3.0-only`）。完整条款见 [LICENSE](LICENSE)，项目声明见 [NOTICE](NOTICE)。允许按协议商用、修改和再分发；分发衍生版本时须履行 GPL 的源码与许可义务。

第三方组件仍适用各自许可，见 [第三方声明](THIRD_PARTY_NOTICES.md)。构建与源码获取说明见 [从源码构建首版](docs/releases/BUILDING-v0.1.0.md)。
