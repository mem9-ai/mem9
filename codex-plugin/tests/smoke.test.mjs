import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AGENT_ID,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SEARCH_TIMEOUT_MS,
} from "../lib/config.mjs";

test("shared config scaffold exports expected defaults", () => {
  assert.equal(DEFAULT_AGENT_ID, "codex");
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 8_000);
  assert.equal(DEFAULT_SEARCH_TIMEOUT_MS, 15_000);
});
