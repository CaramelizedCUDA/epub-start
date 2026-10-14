import { defineConfig } from "@playwright/test";

const target = process.env.E2E_TARGET ?? "harness";

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  // 排版测试要稳定可复现：串行、不重试（重试会把间歇性问题藏起来）
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"], ["html", { open: "never" }]],
  snapshotPathTemplate: "{testDir}/__snapshots__/{arg}{ext}",
  use: {
    browserName: "chromium",
    // 关动画，固定语言/时区，减少与环境相关的差异
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
  },
  // harness / mock 目标自带静态服务；app 目标启动项目的 Vite 开发服务器（DEV 钩子只在开发构建挂出）。
  // 允许复用已在运行的服务。书资源由 adapter 的 page.route 提供，不需要额外服务。
  webServer:
    target === "app"
      ? { command: "npm --prefix .. run dev", url: "http://127.0.0.1:1420", reuseExistingServer: true }
      : { command: "node scripts/serve.mjs 4173", url: "http://127.0.0.1:4173/package.json", reuseExistingServer: true },
});
