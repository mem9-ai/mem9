import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePluginSpecForMatch,
  resolveServerPluginSpec,
} from "../src/shared/plugin-spec.js";

test("normalizePluginSpecForMatch strips package versions but keeps file paths", () => {
  assert.equal(
    normalizePluginSpecForMatch("@mem9/opencode@latest"),
    "@mem9/opencode",
  );
  assert.equal(
    normalizePluginSpecForMatch("opencode-rules@0.6.3"),
    "opencode-rules",
  );
  assert.equal(
    normalizePluginSpecForMatch("./plugins/mem9/tui/index.ts"),
    "./plugins/mem9/tui/index.ts",
  );
});

test("resolveServerPluginSpec maps common tui specs back to the server entry", () => {
  assert.equal(resolveServerPluginSpec("@mem9/opencode"), "@mem9/opencode");
  assert.equal(resolveServerPluginSpec("@mem9/opencode/tui"), "@mem9/opencode");
  assert.equal(
    resolveServerPluginSpec("./plugins/mem9/tui/index.ts"),
    "./plugins/mem9/src/index.ts",
  );
  assert.equal(
    resolveServerPluginSpec("C:\\plugins\\mem9\\tui\\index.ts"),
    "C:\\plugins\\mem9\\src\\index.ts",
  );
});
