import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecallUrl,
  extractMemories,
  runUserPromptSubmit,
} from "../runtime/user-prompt-submit.mjs";

test("buildRecallUrl encodes q, agent id, and limit", () => {
  const url = new URL(
    buildRecallUrl("https://api.mem9.ai/", "hello world", "codex"),
  );

  assert.equal(url.origin + url.pathname, "https://api.mem9.ai/v1alpha2/mem9s/memories");
  assert.equal(url.searchParams.get("q"), "hello world");
  assert.equal(url.searchParams.get("agent_id"), "codex");
  assert.equal(url.searchParams.get("limit"), "10");
});

test("extractMemories accepts both server response shapes", () => {
  assert.deepEqual(extractMemories({ memories: [{ content: "a" }] }), [{ content: "a" }]);
  assert.deepEqual(extractMemories({ data: [{ content: "b" }] }), [{ content: "b" }]);
  assert.deepEqual(extractMemories(null), []);
});

test("user prompt submit recalls memories with the search timeout bucket", async () => {
  /** @type {string | null} */
  let requestedUrl = null;
  /** @type {number | null} */
  let timeoutMs = null;
  /** @type {Array<{stage: string, fields: Record<string, unknown> | undefined}>} */
  const debugEvents = [];

  const output = await runUserPromptSubmit({
    prompt: "remember my preference",
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "key-1",
      agentId: "codex",
      searchTimeoutMs: 15_000,
    },
    async search(url, options) {
      requestedUrl = url;
      timeoutMs = options.timeoutMs;
      return {
        memories: [
          { content: "User prefers concise answers." },
        ],
      };
    },
    debug(stage, fields) {
      debugEvents.push({ stage, fields });
    },
  });

  assert.equal(timeoutMs, 15_000);
  assert.ok(requestedUrl);
  assert.match(requestedUrl, /agent_id=codex/);
  assert.match(requestedUrl, /limit=10/);

  const parsed = JSON.parse(output);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(parsed.hookSpecificOutput.additionalContext, /relevant-memories/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /concise answers/);
  assert.deepEqual(
    debugEvents.map((event) => event.stage),
    ["recall_request", "recall_response", "context_injected"],
  );
});

test("user prompt submit skips empty queries after stripping injected memories", async () => {
  let called = false;
  /** @type {Array<{stage: string, fields: Record<string, unknown> | undefined}>} */
  const debugEvents = [];

  const output = await runUserPromptSubmit({
    prompt: "<relevant-memories>\n1. old\n</relevant-memories>",
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "key-1",
      agentId: "codex",
      searchTimeoutMs: 15_000,
    },
    async search() {
      called = true;
      return { memories: [] };
    },
    debug(stage, fields) {
      debugEvents.push({ stage, fields });
    },
  });

  assert.equal(called, false);
  assert.equal(output, "");
  assert.equal(debugEvents[0]?.stage, "prompt_empty");
});
