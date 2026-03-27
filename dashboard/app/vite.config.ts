/// <reference types="vitest/config" />

import { writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildPixelFarmGeneratedMaskSource } from "./src/lib/pixel-farm/generated-mask-source";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIXEL_FARM_EXPORT_PATH = "/your-memory/__pixel-farm/export-generated-mask-data";
const PIXEL_FARM_GENERATED_MASK_FILE = resolve(
  __dirname,
  "src/lib/pixel-farm/generated-mask-data.ts",
);

function pixelFarmExportPlugin(): Plugin {
  return {
    name: "pixel-farm-export-plugin",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((
        req: IncomingMessage,
        res: ServerResponse<IncomingMessage>,
        next: () => void,
      ) => {
        const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";
        if (req.method !== "POST" || pathname !== PIXEL_FARM_EXPORT_PATH) {
          next();
          return;
        }

        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Parameters<
              typeof buildPixelFarmGeneratedMaskSource
            >[0];
            const source = buildPixelFarmGeneratedMaskSource(payload);

            await writeFile(PIXEL_FARM_GENERATED_MASK_FILE, `${source}\n`, "utf8");
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "https://api.mem9.ai";
  const analysisProxyTarget =
    env.VITE_ANALYSIS_PROXY_TARGET || "https://napi.mem9.ai";

  return {
    base: "/your-memory/",
    plugins: [react(), tailwindcss(), pixelFarmExportPlugin()],
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
