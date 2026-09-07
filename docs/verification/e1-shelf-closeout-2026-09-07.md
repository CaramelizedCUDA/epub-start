# E1 / F1 书架与壳层收尾记录（2026-09-07）

本轮只处理 E1/F1 的壳层状态与书架可用性，不启动 P3 多格式实现，也没有修改 Rust、SQLite Schema、IPC 契约或依赖白名单。

## 改动范围

- `src/App.tsx`：阅读器视图保存进入前的书架版块，关闭阅读器后返回原版块。
- `src/features/library/BookShelf.tsx`：解析失败卡片增加“重新导入”入口，并沿用已有导入流程；可用、缺失、解析失败仍保持不同状态呈现。
- `src/stores/libraryStore.ts`：为异步操作增加活动计数；列表刷新用请求序号抑制过期响应；导入、重新定位、删除完成后再刷新，避免并发操作提前清除加载状态或把删除项重新放回书架。

## 验证结果

### 辅助逻辑（静态/自动）

- `npm.cmd run build`：通过，TypeScript 检查与 Vite 构建完成。
- `npm.cmd run audit:unwrap`：672 行 / 687 次，与登记一致。
- `npm.cmd run audit:check`：通过，`BACKEND_AUDIT.md` 与 `TODO.md` 统计一致。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`：通过。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：195 passed，0 failed。
- Luna 的临时 store 并发 harness 完成过一次变红→变绿自证：将 `libraryStore.ts` 最新列表响应门控改为无条件写入后，`testLatestListWins` 以 `actual ['older'] / expected ['newer']` 失败；恢复请求序号门控后输出 `E1 store checks passed`。同一轮覆盖外层导入加载计数、失败后重试、解析失败同源恢复和删除/旧列表竞争；临时 harness 已删除，未作为项目依赖提交。

### Windows 桌面运行态（已覆盖）

使用隔离 Tauri 数据目录 `com.epubstart.e1acceptance` 和原创 EPUB 样本完成：

1. 空数据库显示真实空书架与导入入口；打开文件选择器期间显示加载状态。
2. 通过真实文件选择器导入 EPUB，重启/刷新后书架从 SQLite 读取可用书籍。
3. 从搜索版块打开正文，再通过 Reader 的“返回书架”返回搜索版块；证据截图保存在 `target/e1-20260907/windows-return-search.png`。
4. 移动来源文件后打开书籍，出现“文件已移动或不可读，请重新选择该书籍的来源文件”，书卡转为“文件缺失/重新选择”。恢复来源后回到可用状态。
5. 导入无效 EPUB 后出现“解析失败/重新导入”；将同一来源文件替换为有效 EPUB，再次选择该来源后书卡恢复为可用。

本轮没有把测试隔离库或测试 EPUB 纳入版本库；正式应用数据未修改。

### Android（黑鲨 SKW-A0，序列号 88477008，Android 9）

- arm64 Rust `release` 构建：通过；`libepub_start_lib.so` SHA-256 为 `799319E1C07FB0768BCD828C32063557F58E60C67F34AA84ACA38896710DCA09`。
- `:app:assembleArm64Profile -x rustBuildArm64Profile`：通过，生成 `app-arm64-profile.apk`，SHA-256 为 `BA05788BF40D31708E89A2390C0DD3D869FD55C952B602A797C3293906BAE264`。
- profile 包安装成功，确认同时存在正式包 `com.epubstart.reader` 与隔离包 `com.epubstart.reader.profile`。
- 设备在启动后进入安全图案锁屏；未取得解锁操作，因此没有执行 Android UI、WebView、SAF 导入或 E1 状态操作。`target/e1-20260907/android-profile-main.png` 是锁屏证据，不是应用通过证据。

因此 E1 保持未勾选：Windows 覆盖已完成，本轮 Android 运行态为“阻塞（设备锁屏，需用户解锁后重跑）”。未测范围包括 Android 空/错/重试/返回、SAF 来源恢复、黑鲨 WebView 书架消费，以及 Linux。

## 交接

本轮代码不改变 P3 冻结路线；后续应先在已解锁黑鲨上补做 Android E1 状态矩阵，再决定是否勾选 E1，随后进入 E2 导入/删除/来源重新定位的完整跨端验收。
