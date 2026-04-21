import assert from "node:assert/strict";
import test from "node:test";
import type { Hooks } from "@opencode-ai/plugin";

import type {
  IngestInput,
  IngestResult,
  MemoryBackend,
} from "./backend.js";
import { redactDebugPayload } from "./debug.js";
import { buildHooks } from "./hooks.js";
import { selectMessagesForIngest } from "./ingest/select.js";
import type {
  CreateMemoryInput,
  Memory,
  SearchInput,
  SearchResult,
  StoreResult,
  UpdateMemoryInput,
} from "./types.js";

type ChatMessageHook = NonNullable<Hooks["chat.message"]>;
type ChatMessageInput = Parameters<ChatMessageHook>[0];
type ChatMessageOutput = Parameters<ChatMessageHook>[1];
type TextCompleteHook = NonNullable<Hooks["experimental.text.complete"]>;
type TextCompleteInput = Parameters<TextCompleteHook>[0];
type TextCompleteOutput = Parameters<TextCompleteHook>[1];
type ToolExecuteAfterHook = NonNullable<Hooks["tool.execute.after"]>;
type ToolExecuteAfterInput = Parameters<ToolExecuteAfterHook>[0];
type ToolExecuteAfterOutput = Parameters<ToolExecuteAfterHook>[1];
type SessionCompactingHook = NonNullable<Hooks["experimental.session.compacting"]>;
type SessionCompactingInput = Parameters<SessionCompactingHook>[0];
type SessionCompactingOutput = Parameters<SessionCompactingHook>[1];

function createBackend(options: {
  searchImpl?: (input: SearchInput) => Promise<SearchResult>;
  ingestImpl?: (input: IngestInput) => Promise<IngestResult>;
} = {}): MemoryBackend {
  return {
    async store(_input: CreateMemoryInput): Promise<StoreResult> {
      throw new Error("store should not be called in ingest tests");
    },
    async search(input: SearchInput): Promise<SearchResult> {
      if (options.searchImpl) {
        return options.searchImpl(input);
      }

      return {
        memories: [],
        total: 0,
        limit: input.limit ?? 0,
        offset: input.offset ?? 0,
      };
    },
    async get(_id: string): Promise<Memory | null> {
      throw new Error("get should not be called in ingest tests");
    },
    async update(_id: string, _input: UpdateMemoryInput): Promise<Memory | null> {
      throw new Error("update should not be called in ingest tests");
    },
    async remove(_id: string): Promise<boolean> {
      throw new Error("remove should not be called in ingest tests");
    },
    async listRecent(_limit: number): Promise<Memory[]> {
      throw new Error("listRecent should not be called in ingest tests");
    },
    async ingest(input: IngestInput): Promise<IngestResult> {
      if (options.ingestImpl) {
        return options.ingestImpl(input);
      }

      return {
        status: "ok",
        memories_changed: input.messages.length,
      };
    },
  };
}

function createChatMessageInput(
  sessionID: string,
  overrides: Partial<ChatMessageInput> = {},
): ChatMessageInput {
  return {
    sessionID,
    ...overrides,
  };
}

function createChatMessageOutput(parts: ChatMessageOutput["parts"]): ChatMessageOutput {
  return {
    message: {
      role: "user",
      content: "ignored message content",
    } as unknown as ChatMessageOutput["message"],
    parts,
  };
}

function textPart(text: string): ChatMessageOutput["parts"][number] {
  return {
    type: "text",
    text,
  } as unknown as ChatMessageOutput["parts"][number];
}

function createTextCompleteInput(sessionID: string): TextCompleteInput {
  return {
    sessionID,
    messageID: "message-1",
    partID: "part-1",
  };
}

function createTextCompleteOutput(text: string): TextCompleteOutput {
  return { text };
}

function createToolExecuteAfterInput(sessionID: string): ToolExecuteAfterInput {
  return {
    tool: "memory_search",
    sessionID,
    callID: "call-1",
    args: {
      query: "find relevant memories",
    },
  };
}

function createToolExecuteAfterOutput(): ToolExecuteAfterOutput {
  return {
    title: "Memory search",
    output: "Search completed successfully.",
    metadata: {
      resultCount: 1,
    },
  };
}

function createSessionCompactingInput(sessionID: string): SessionCompactingInput {
  return { sessionID };
}

function createSessionCompactingOutput(): SessionCompactingOutput {
  return { context: [] };
}

test("selectMessagesForIngest strips injected memory blocks and keeps the latest 12 messages", () => {
  const selected = selectMessagesForIngest([
    { role: "user", content: "Old message 1" },
    { role: "assistant", content: "Old message 2" },
    {
      role: "user",
      content: `
<relevant-memories>
1. Stale memory
</relevant-memories>

Keep this request.
`,
    },
    {
      role: "assistant",
      content: `
<relevant-memories>
1. Drop this entire message
</relevant-memories>
`,
    },
    { role: "assistant", content: "Message 1" },
    { role: "user", content: "Message 2" },
    { role: "assistant", content: "Message 3" },
    { role: "user", content: "Message 4" },
    { role: "assistant", content: "Message 5" },
    { role: "user", content: "Message 6" },
    { role: "assistant", content: "Message 7" },
    { role: "user", content: "Message 8" },
    { role: "assistant", content: "Message 9" },
    { role: "user", content: "Message 10" },
    { role: "assistant", content: "Message 11" },
  ]);

  assert.deepEqual(selected, [
    { role: "user", content: "Keep this request." },
    { role: "assistant", content: "Message 1" },
    { role: "user", content: "Message 2" },
    { role: "assistant", content: "Message 3" },
    { role: "user", content: "Message 4" },
    { role: "assistant", content: "Message 5" },
    { role: "user", content: "Message 6" },
    { role: "assistant", content: "Message 7" },
    { role: "user", content: "Message 8" },
    { role: "assistant", content: "Message 9" },
    { role: "user", content: "Message 10" },
    { role: "assistant", content: "Message 11" },
  ]);
});

test("redactDebugPayload masks API keys and shortens prompt-like fields", () => {
  const longPrompt = "p".repeat(200);
  const longContent = "c".repeat(200);
  const redacted = redactDebugPayload({
    apiKey: "mk_secret_value",
    prompt: longPrompt,
    headers: {
      "X-API-Key": "mk_nested_secret",
    },
    messages: [{ content: longContent }],
  });

  assert.equal(redacted.apiKey, "mk_***");
  assert.equal(redacted.prompt, `${"p".repeat(160)}...`);

  const headers = redacted.headers as Record<string, unknown>;
  assert.equal(headers["X-API-Key"], "mk_***");

  const messages = redacted.messages as Array<Record<string, unknown>>;
  assert.equal(messages[0]?.content, `${"c".repeat(160)}...`);
});

test("buildHooks auto-ingests cleaned transcript messages in smart mode", async () => {
  const ingestCalls: IngestInput[] = [];
  const hooks = buildHooks(
    createBackend({
      async ingestImpl(input) {
        ingestCalls.push(input);
        return {
          status: "ok",
          memories_changed: 1,
        };
      },
    }),
  );

  const onChatMessage = hooks["chat.message"];
  const onTextComplete = hooks["experimental.text.complete"];
  assert.ok(onChatMessage);
  assert.ok(onTextComplete);

  await onChatMessage(
    createChatMessageInput("session-1", { agent: "agent-42" }),
    createChatMessageOutput([
      textPart(`
<relevant-memories>
1. Old memory
</relevant-memories>

Remember that I prefer focused patches.
`),
    ]),
  );

  await onTextComplete(
    createTextCompleteInput("session-1"),
    createTextCompleteOutput("I will keep the patch focused."),
  );

  assert.deepEqual(ingestCalls, [
    {
      session_id: "session-1",
      agent_id: "agent-42",
      mode: "smart",
      messages: [
        {
          role: "user",
          content: "Remember that I prefer focused patches.",
        },
        {
          role: "assistant",
          content: "I will keep the patch focused.",
        },
      ],
    },
  ]);
});

test("buildHooks appends a compaction hint and emits debug events", async () => {
  const debugEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const hooks = buildHooks(createBackend(), {
    debugLogger: async (event, payload = {}) => {
      debugEvents.push({ event, payload });
    },
  });

  const onSessionCompacting = hooks["experimental.session.compacting"];
  const onToolExecuteAfter = hooks["tool.execute.after"];
  assert.ok(onSessionCompacting);
  assert.ok(onToolExecuteAfter);

  const compactionOutput = createSessionCompactingOutput();
  await onSessionCompacting(createSessionCompactingInput("session-compact"), compactionOutput);
  await onToolExecuteAfter(
    createToolExecuteAfterInput("session-compact"),
    createToolExecuteAfterOutput(),
  );

  assert.deepEqual(compactionOutput.context, [
    "Preserve durable user preferences, project decisions, and unfinished work that should survive compaction.",
  ]);
  assert.deepEqual(debugEvents, [
    {
      event: "session.compacting",
      payload: {
        sessionID: "session-compact",
        hint: "Preserve durable user preferences, project decisions, and unfinished work that should survive compaction.",
      },
    },
    {
      event: "tool.execute.after",
      payload: {
        sessionID: "session-compact",
        tool: "memory_search",
        callID: "call-1",
        args: {
          query: "find relevant memories",
        },
        title: "Memory search",
        output: "Search completed successfully.",
        metadata: {
          resultCount: 1,
        },
      },
    },
  ]);
});
