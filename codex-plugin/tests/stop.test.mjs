import assert from "node:assert/strict";
import test from "node:test";

import { runStop } from "../runtime/stop.mjs";
import {
  parseTranscriptText,
  selectStopWindow,
} from "../runtime/shared/transcript.mjs";

test("transcript parser keeps only message items with user and assistant roles", () => {
  const transcript = [
    JSON.stringify({ item: { type: "response_item", type2: "ignored" } }),
    JSON.stringify({
      item: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "## Skills" }],
      },
    }),
    JSON.stringify({ item: { type: "function_call", name: "shell_command" } }),
    JSON.stringify({
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    }),
    JSON.stringify({
      item: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "<relevant-memories>\n1. old\n</relevant-memories>\nreply",
          },
        ],
      },
    }),
  ].join("\n");

  const messages = parseTranscriptText(transcript);
  assert.deepEqual(messages, [
    { role: "user", content: "hello" },
    { role: "assistant", content: "reply" },
  ]);
});

test("selectStopWindow keeps the newest budget-fitting slice", () => {
  /** @type {import("../runtime/shared/transcript.mjs").IngestMessage[]} */
  const messages = [
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
    { role: "assistant", content: "a2" },
  ];

  assert.deepEqual(
    selectStopWindow(messages, 2, 200_000),
    [
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ],
  );
});

test("selectStopWindow drops an oversized newest message instead of exceeding the byte cap", () => {
  const oversized = "x".repeat(210_000);

  assert.deepEqual(
    selectStopWindow(
      [{ role: "assistant", content: oversized }],
      20,
      200_000,
    ),
    [],
  );
});

test("selectStopWindow skips an oversized newest message and keeps the next recent fitting window", () => {
  const oversized = "x".repeat(210_000);

  assert.deepEqual(
    selectStopWindow(
      [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "assistant", content: oversized },
      ],
      20,
      200_000,
    ),
    [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ],
  );
});

test("selectStopWindow falls back to the newest window that still includes a user message", () => {
  const oversized = "x".repeat(210_000);

  assert.deepEqual(
    selectStopWindow(
      [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: oversized },
        { role: "assistant", content: "a2" },
      ],
      20,
      200_000,
    ),
    [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ],
  );
});

test("stop posts smart ingest with a recent message window", async () => {
  /** @type {unknown} */
  let requestBody = null;
  /** @type {number | null} */
  let timeoutMs = null;
  /** @type {Array<{stage: string, fields: Record<string, unknown> | undefined}>} */
  const debugEvents = [];

  const result = await runStop({
    sessionId: "session-1",
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "key-1",
      agentId: "codex",
      defaultTimeoutMs: 8_000,
    },
    transcriptMessages: [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ],
    async post(_url, body, options) {
      requestBody = body;
      timeoutMs = options.timeoutMs;
      return { status: "complete" };
    },
    debug(stage, fields) {
      debugEvents.push({ stage, fields });
    },
  });

  assert.equal(timeoutMs, 8_000);
  assert.deepEqual(requestBody, {
    session_id: "session-1",
    agent_id: "codex",
    mode: "smart",
    messages: [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ],
  });
  assert.deepEqual(result, requestBody);
  assert.deepEqual(
    debugEvents.map((event) => event.stage),
    ["ingest_window_selected", "ingest_sent"],
  );
});
