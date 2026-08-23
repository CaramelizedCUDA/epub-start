# B3 Windows 桌面运行态回归记录

日期：2026-08-23  
分支：`codex/b3-contract-freeze`  
范围：本地 Tauri 开发运行与当前代码生成的 Windows x64 release 可执行文件。调试入口只绑定 `127.0.0.1`，所有操作均通过应用页面按钮触发；没有直接写数据库。

## 已执行

### 开发运行态

- `npm.cmd run tauri dev` 成功启动 Vite、Rust debug 进程和 `EpubStart` 窗口；进程保持响应。
- 书架从现有应用数据加载 8 本书；封面通过 `asset.localhost` 成功请求，未把本地路径直接暴露给页面。
- 打开首本书成功，页面内容来自真实 `epub.localhost` 资源链：`META-INF/container.xml`、OPF、NAV 和 XHTML 均收到请求；iframe 正常取得正文，没有 `Failed to fetch` 或不支持 scheme 错误。
- 翻页按钮完成前进/后退；目录面板显示封面、短篇和奥付条目，点击奥付后跳转到对应 2 页内容。
- 搜索面板输入“终末”返回 19 条结果，点击结果后跳转到第 1/20 页。
- 这次回归发现并修复了 `src/stores/readerStore.ts` 的异步缺陷：EPUB.js `section.load()` 返回 Promise，旧代码误当作回调 API，导致搜索结果总为空；现实现等待各 spine section 加载、读取 `textContent`、隔离单章失败并限制最多 50 条结果。
- 通过正文选区打开批注菜单，新增 `B3桌面回归批注`，再编辑为 `B3桌面回归批注-已编辑`，最后删除；页面最终回到无批注状态。实际调用了 `create_note`、`update_note`、`delete_note`。
- 阅读设置面板读取全局/单书设置；在单书范围将主题从暖色切到浅色再恢复暖色，观察到 `save_book_reading_settings` 和“已自动保存”。
- 全屏按钮完成进入/退出；窗口外框从约 `1040x807` 变为 `1920x1080` 后恢复，观察到 `is_fullscreen`/`set_fullscreen` IPC。
- 页面移动和关闭过程中观察到 `save_reading_progress`，书籍打开时观察到 `get_reading_progress`、`list_notes`。

### release 运行态

- `npm.cmd run tauri build` 成功，产出：
  - `src-tauri/target/release/epub-start.exe`：12,488,704 B；
  - `src-tauri/target/release/bundle/msi/EpubStart_0.1.0_x64_en-US.msi`：5,537,792 B；
  - `src-tauri/target/release/bundle/nsis/EpubStart_0.1.0_x64-setup.exe`：3,215,124 B。
- 直接启动 release 可执行文件后，`tauri.localhost` 书架再次加载 8 本书和封面；打开首本书后正文、`epub.localhost` 资源链和 iframe 内容正常。
- release 包内重新执行“终末”搜索，得到 19 条结果，证明修复已进入生产前端包。
- 开发进程结束后再启动 release 进程，书架数据、封面引用和可打开书籍仍在；这是本轮的基础重启恢复证据，不等同于完整导入/失效来源恢复矩阵。

## 覆盖边界

| 场景 | 本轮状态 | 说明 |
| --- | --- | --- |
| 打开、封面、资源链、翻页、目录 | 已覆盖 | 开发与 release 均有真实页面/资源证据 |
| 搜索 | 已覆盖 | 修复前曾稳定复现空结果；修复后开发与 release 均返回 19 条并可跳转 |
| 批注、设置、进度、全屏、基础重启 | 已覆盖 | 批注测试数据已删除；设置恢复为原暖色值 |
| 导入 | 未覆盖 | 当前书架已有持久数据；本轮未打开原生文件选择器，避免重复导入和改变用户数据 |
| 删除 | 未覆盖 | 只确认书卡删除入口存在，没有点击不可逆的用户书籍删除按钮 |
| 重新定位 | 未覆盖 | 当前 8 本书来源均有效，UI 不显示失效来源的重新定位入口 |
| 系列、标签 | 未覆盖 | 当前 legacy shell 没有对应管理/消费 UI；Rust/IPC 自动化仍是辅助逻辑证据 |
| Android/OEM/Linux | 未覆盖 | 见 `ANDROID_STORAGE_ACCEPTANCE.md` 与 B3/F2 后续门禁；不能由桌面运行代替 |

本记录不把“按钮存在”、静态构建或后端单元测试升级为未执行的桌面场景通过。没有新增前端自动化测试；本轮验证是应用运行态回归，未改变 Rust 测试统计。
