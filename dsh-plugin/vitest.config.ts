import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.e2e.ts"],
    exclude: ["tests/live-api.e2e.ts"],
  },
});
