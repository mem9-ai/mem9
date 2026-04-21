import assert from "node:assert/strict";
import test from "node:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createSessionTranscriptLoader } from "../src/server/session-transcript.js";

function createClient(
  messagesImpl: (...args: unknown[]) => Promise<unknown>,
): PluginInput["client"] {
  return {
    session: {
      messages: messagesImpl as PluginInput["client"]["session"]["messages"],
    },
  } as PluginInput["client"];
}

test("createSessionTranscriptLoader requests recent session messages and keeps real text only", async () => {
  const calls: unknown[] = [];
  const loader = createSessionTranscriptLoader(
    createClient(async (options) => {
      calls.push(options);
      return {
        data: [
          {
            info: { role: "user" },
            parts: [
              { type: "text", text: "Remember the real user request." },
              { type: "text", text: "Ignore me.", synthetic: true },
              { type: "tool", tool: "memory_search" },
            ],
          },
          {
            info: { role: "assistant" },
            parts: [
              { type: "reasoning", text: "internal reasoning" },
              { type: "text", text: "I captured the useful assistant reply." },
              { type: "text", text: "Ignore me too.", ignored: true },
            ],
          },
          {
            info: { role: "assistant" },
            parts: [{ type: "tool", tool: "memory_search" }],
          },
        ],
        request: {} as Request,
        response: {} as Response,
      };
    }),
  );

  const transcript = await loader("session-1");

  assert.deepEqual(calls, [
    {
      path: { id: "session-1" },
      query: { limit: 24 },
      throwOnError: true,
    },
  ]);
  assert.deepEqual(transcript, [
    {
      role: "user",
      content: "Remember the real user request.",
    },
    {
      role: "assistant",
      content: "I captured the useful assistant reply.",
    },
  ]);
});
