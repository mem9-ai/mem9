import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/live-api.e2e.ts"],
    testTimeout: 30_000,
  },
});
