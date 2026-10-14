Written for: 接手提交前门禁的工程师（未来的 agent 或维护者），假设已读过 `docs/VERIFICATION.md` 与 `epubstart-e2e/HANDOVER.md`。

# 交接：把 Chromium E2E 接入 gate:staged（方案 A 已接入）

日期：2026-10-14

## 0. 已完成（方案 A）

- `harness` 进提交前门禁：`epubstart-e2e/` 或 `package.json`/`package-lock.json` 变化时运行 `npm run test:e2e:harness`。
- `app` 不进提交前门禁，手动运行。
- 规划器拆出 `main()` 并加 `import.meta.url` 守卫，便于测试。新增 `scripts/run-staged-gate.test.mjs`（6 条触发规则用例），接入 `npm run check:fast`（脚本名 `test:gate`）。
- 红绿自证：在隔离副本中删掉 harness 触发条件，3 条用例变红；恢复后绿（副本已清理）。
- 真实运行 `node scripts/run-staged-gate.mjs --files epubstart-e2e/README.md`：`test:e2e:unit` 通过，`test:e2e:harness` 8 通过 / 16 跳过，退出码 0。

以下 §1–§6 是接入前的背景与决策依据，仍然有效。

## 1. 现状

- 字体固定与快照基线已提交推送：`9e64fa2`（在 `8c12282` 之后，已推 `origin/main`）。
- 快速确定性门禁已在 `8c12282` 落地：`scripts/run-staged-gate.mjs`、`scripts/git-hooks/pre-commit`、`npm run hooks:install`。它只跑 typecheck、check:arch、test:frontend、test:e2e:unit、audit:check 和 cargo，**不跑 Chromium**。
- 根 `.gitignore` 已加入 `test-results/`，忽略 Playwright 的运行产物。
- 推送前的证据（压缩前跑的，之后没有重跑）：`harness` 8 通过 / 16 跳过，`app` 24/24 通过，`npm run check:fast` 全绿。

本交接只做记录，**没有改 gate 脚本，也没有接 E2E**。

## 2. 目标

让提交前门禁在影响面命中时自动跑对应的 Chromium E2E 目标（`harness` / `app`），失败则阻止提交。

## 3. 需要先定的决策（开工前问用户）

1. **是否进 pre-commit**。`app` 目标单次跑超过 120 秒，还要启动 Vite dev server。建议：
   - 方案 A：`harness` 进 pre-commit（较快），`app` 只在 `gate:staged` 手动调用或阶段验收时跑。
   - 方案 B：两个目标都进 pre-commit，接受慢提交。
   - 倾向 A，但需用户确认。
2. **触发范围以 `docs/VERIFICATION.md` 为准**。本文档没有逐条核对该文件的影响面表，实现前必须先读它，不得凭本文档自定触发矩阵。

## 4. 实现要点（按已确认的事实）

- **触发矩阵的候选依据**（待按 VERIFICATION 核对）：
  - `harness`：`epubstart-e2e/**`、根 `package.json`（epubjs 版本）、`package-lock.json`。harness 不走 `src/` 的 reflow，所以 `src/` 变更不应触发它。
  - `app`：`src/**`、`epubstart-e2e/**`、`package.json`、`vite.config.ts`、`tsconfig.json`。
- **前置步骤**：`npm run test:e2e:app` 等根脚本已经先跑 `npm --prefix epubstart-e2e run fixtures`。gate 调用 e2e 时需要同样的前置，否则 fixture 与字体嵌入可能不一致。
- **不要在门禁里带 `--update-snapshots`**。快照缺失或不一致应当失败，不能被静默写入。
- **Chromium 缺失要报错**，不要静默跳过。错误信息应提示 `npx playwright install chromium`（见 `epubstart-e2e/README.md`）。
- **`epubstart-e2e/scripts/e2e.mjs` 已带 `cwd: SUITE_ROOT`**。从仓库根直接调用 Playwright 会误扫 `scripts/frontend-tests/`，不要绕开这个启动器。
- `run-staged-gate.mjs` 已支持 `--files` 与 `--dry-run`，可用于演练触发逻辑，不必真的提交。

## 5. 实现的验证要求（不能只跑一次就算）

- 为 `planGateSteps` 的新分支补单测，正反例都要有：只改 `epubstart-e2e/` 应只选 harness；只改 `src/features/reader/` 应选 app；只改文档应不选任何目标。
- 红绿自证：在暂存区注入一个会让 E2E 变红的改动（参考 `check:arch` 的 `target/arch-redgreen/bad.ts` 做法），确认 gate 退出码非 0；撤销后确认变绿。证明方式用 `--files` 或真实暂存都可以，但要留证据。
- 用 `node scripts/run-staged-gate.mjs --dry-run --files <列表>` 核对每种组合输出的命令。
- `npm run check:fast` 必须仍然全绿。

## 6. 风险与未覆盖

- **本机依赖**：Chromium 由 `npx playwright install chromium` 下载，来源是 npmmirror CDN（见 `epubstart-e2e/HANDOVER.md` 第 8 节第 9 点）。换机器需要重新装。
- **快照平台差异**：快照依赖字体和浏览器渲染。目前只在本机（Windows）验证过，其它平台（Linux CI 等）未验证。
- **没有 CI**：仓库目前没有 CI，pre-commit 只在本机执行，且需要用户先运行 `npm run hooks:install`，不会自动生效。
- **耗时未测**：没有测过在 pre-commit 中跑 harness 的实际耗时，接入前需要先测。
- **未在 gate 中运行过 E2E**：本文件之后的所有结论都还没有在 gate 路径上验证。
