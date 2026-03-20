import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "https://api.mem9.ai";
  const analysisProxyTarget =
    env.VITE_ANALYSIS_PROXY_TARGET || "https://napi.mem9.ai";

  return {
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
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: (path) =>
            path.replace(/^\/your-memory\/api/, "/v1alpha2/mem9s"),
        },
        "/your-memory/analysis-api": {
          target: analysisProxyTarget,
          changeOrigin: true,
          rewrite: (path) =>
            path.replace(/^\/your-memory\/analysis-api/, ""),
        },
      },
    },
  };
});
