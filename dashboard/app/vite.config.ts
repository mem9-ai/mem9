import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "/your-memory/",
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/your-memory/api": {
        target: "https://api.mem9.ai",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/your-memory\/api/, "/v1alpha1/mem9s"),
      },
      "/your-memory/analysis-api": {
        target: "https://napi.mem9.ai",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/your-memory\/analysis-api/, ""),
      },
    },
  },
});
