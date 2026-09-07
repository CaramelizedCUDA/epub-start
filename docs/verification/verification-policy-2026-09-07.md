# 验证节奏与前端自动入口（2026-09-07）

任务：按用户授权调整验证规范，并建立 Astra 规划、Luna max 执行的可重复入口。起点为 `codex/e1-shelf-closeout` 的 `c230945`；本轮不改生产前端、Rust、IPC、Schema、依赖或安全/预算阈值，不改变已有功能完成标记。

## 结果与职责

- `docs/VERIFICATION.md` 成为验证范围唯一来源：影响面决定必跑项，建议不算门禁；明确升级原因、停止条件、已有证据复用与固定设备场景。
- `AGENTS.md`、`CONVENTIONS.md`、`ROADMAP.md`、`TODO.md` 和开发指南/索引同步；实现状态与阶段验收拆分，E1/E2/E5 相关集成检查可集中安排，E10 全矩阵，E11 最终签名制品检查与 smoke。
- `scripts/test-frontend.mjs`、`scripts/frontend-tests/libraryStore.test.cjs` 与 package 命令由 Luna max 实现，Astra 审阅边界及失败判定。使用已有 TypeScript/Zustand 与 Node 内置能力，无新依赖。

## 覆盖与证据复用

自动测试覆盖实际 libraryStore 的最新列表胜出、删除刷新与旧列表竞争、并发加载计数和失败恢复；IPC 返回由测试控制。它不证明 React 交互、真实数据库删除、CFI 或 SAF。

复用 [E1 记录](e1-shelf-closeout-2026-09-07.md) 中 `070acd1` 的前端构建和 Windows/双机限定范围运行态：本轮未改变其生产实现或依赖。该记录未测的 Android 错误重试、SAF 失效和完整恢复仍未测，由 E2/E10 承接。未改变 Rust/source/cache，无本轮重做后端压力、Rust 编译或 APK 预算的传播机制。

本轮无产品构建、真机安装或运行态复测；没有新增平台覆盖结论。后续 E2/E5 按影响面增加真正有价值的自动回归，CFI DOM 和 SAF 的设备路径仍按固定场景执行。

## 本轮检查

Luna 最终执行，Astra 审阅脚本与结果，不重复相同测试：

- `npm.cmd run test:frontend`：4 cases，exit 0。
- `npm.cmd run test:frontend -- --library library --red-green`：4 个定点缺陷均触发对应目标测试的 ERR_ASSERTION；恢复干净源码后 4 cases，exit 0。使用明确 TAP reporter，不能把编译失败、导入错误或超时当作目标变红。
- 参数检查：`--list` 输出 library；未知 library 返回非零。常规子集入口为 `npm.cmd run test:frontend -- --library library`。
- Astra：本轮 Markdown 本地链接目标检查通过；`git diff --check` 通过；生产目录及锁文件无差异。当前统计数字未变，未重复运行后端审计。

| 定点缺陷（仅隔离副本） | 目标断言 |
| --- | --- |
| 移除列表最新请求保护 | `newer list request wins when an older response arrives later`：旧请求到达后仍为 new |
| 同一保护缺失下的删除竞争 | `delete refresh cannot reintroduce a book from a stale in-flight list`：最终只剩 survivor |
| finishOperation 强制清除 loading | `loading count remains active until all concurrent requests settle`：尚有请求时仍为 true |
| 错误映射改为 injected failure | `loading failure clears its slot and the next load recovers the shelf`：目标错误应为 temporary list failure |

自证后的临时缺陷目录在 finally 清理；删除只允许仓库 target 下两个固定测试目录。干净编译副本留在已忽略目录，生产源未注入缺陷。
