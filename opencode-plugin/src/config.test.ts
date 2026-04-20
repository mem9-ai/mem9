import assert from "node:assert/strict";
import test from "node:test";

import { mergeConfigLayers } from "./config.js";

test("project config overrides global config", () => {
  const result = mergeConfigLayers(
    {
      schemaVersion: 1,
      profileId: "default",
      debug: false,
      defaultTimeoutMs: 8000,
      searchTimeoutMs: 15000,
    },
    {
      schemaVersion: 1,
      profileId: "projectA",
    },
  );

  assert.equal(result.profileId, "projectA");
  assert.equal(result.debug, false);
  assert.equal(result.defaultTimeoutMs, 8000);
});
