import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  build: {
    // Android 老设备（如 Android 9 出厂 WebView 79）不支持可选链等 ES2020 语法，
    // 统一降级到 ES2019 以保证移动端兼容（验收发现，见 BACKEND_AUDIT Android 实机验收节）。
    target: "es2019",
    rollupOptions: {
      output: {
        // epubjs 体积最大且长期稳定，独立成 chunk 以降低主包体积并改善缓存。
        manualChunks: {
          epubjs: ['epubjs'],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    // Windows may resolve the implicit localhost listener to ::1 while
    // Tauri's desktop devUrl probe connects through IPv4. Keep the explicit
    // TAURI_DEV_HOST override for Android/device development, but make the
    // desktop default deterministic.
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
