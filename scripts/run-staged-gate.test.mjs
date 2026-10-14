// 提交前门禁的触发规则单测：只验证 planGateSteps 的影响面映射，不实际执行命令。
import { test } from "node:test";
import assert from "node:assert/strict";

import { planGateSteps } from "./run-staged-gate.mjs";

const argsOf = (files) => planGateSteps(files).map((s) => s.args.join(" "));

test("只改文档：不触发任何门禁", () => {
  assert.deepEqual(argsOf(["docs/VERIFICATION.md", "README.md"]), []);
});

test("只改 E2E 套件：触发单测与 harness，不触发 app 或前端回归", () => {
  const steps = argsOf(["epubstart-e2e/README.md"]);
  assert.ok(steps.includes("run test:e2e:unit"));
  assert.ok(steps.includes("run test:e2e:harness"));
  assert.ok(!steps.some((a) => a.includes("test:e2e:app")));
  assert.ok(!steps.includes("run test:frontend"));
});

test("改 reader 引擎：触发前端回归与架构检查，不触发 harness", () => {
  const steps = argsOf(["src/features/reader/engine/reflow.ts"]);
  assert.ok(steps.includes("run typecheck"));
  assert.ok(steps.includes("run check:arch"));
  assert.ok(steps.includes("run test:frontend"));
  assert.ok(!steps.some((a) => a.includes("test:e2e:harness")));
});

test("改依赖清单：触发 harness（EPUB.js 基线受版本影响）", () => {
  assert.ok(argsOf(["package-lock.json"]).includes("run test:e2e:harness"));
  assert.ok(argsOf(["package.json"]).includes("run test:e2e:harness"));
});

test("改 bookshelf 子集：只跑 library 子集", () => {
  const steps = argsOf(["src/features/bookshelf/BookshelfView.tsx"]);
  assert.ok(steps.includes("run test:frontend -- --library library"));
});

test("Windows 路径分隔符也能匹配", () => {
  assert.ok(argsOf(["epubstart-e2e\\e2e\\reader.spec.ts"]).includes("run test:e2e:harness"));
});
