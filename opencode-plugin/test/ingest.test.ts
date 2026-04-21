import assert from "node:assert/strict";
import test from "node:test";
import type { Hooks } from "@opencode-ai/plugin";

import type {
  IngestInput,
  IngestResult,
  MemoryBackend,
} from "../src/server/backend.js";
import { redactDebugPayload } from "../src/server/debug.js";
import { buildHooks } from "../src/server/hooks.js";
import { selectMessagesForIngest } from "../src/server/ingest/select.js";
import type {
  CreateMemoryInput,
  Memory,
  SearchInput,
  SearchResult,
  StoreResult,
  UpdateMemoryInput,
} from "../src/shared/types.js";

type ChatMessageHook = NonNullable<Hooks["chat.message"]>;
type ChatMessageInput = Parameters<ChatMessageHook>[0];
type ChatMessageOutput = Parameters<ChatMessageHook>[1];
type EventHook = NonNullable<Hooks["event"]>;
type EventInput = Parameters<EventHook>[0];
type SessionCompactingHook = NonNullable<Hooks["experimental.session.compacting"]>;
type SessionCompactingInput = Parameters<SessionCompactingHook>[0];
type SessionCompactingOutput = Parameters<SessionCompactingHook>[1];

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error?: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function waitForBackgroundTasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

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

function createSessionIdleEventInput(sessionID: string): EventInput {
  return {
    event: {
      type: "session.idle",
      properties: { sessionID },
    } as EventInput["event"],
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

test("redactDebugPayload masks mem9 secrets inside free-form strings", () => {
  const redacted = redactDebugPayload({
    error: "mem9 request failed with mk_secret_value during retry",
  });

  assert.equal(redacted.error, "mem9 request failed with mk_*** during retry");
});

test("redactDebugPayload masks bearer and provider secrets inside free-form strings", () => {
  const redacted = redactDebugPayload({
    error:
      "Authorization: Bearer sk-live-abc1234567890 leaked sk_proj_projectsecret123456 and xoxb-1234567890-1234567890-secretvalue",
  });

  assert.equal(
    redacted.error,
    "Authorization: Bearer sk-live-*** leaked sk_proj_*** and xoxb-***",
  );
});

test("buildHooks auto-ingests transcript messages when the session becomes idle", async () => {
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
    {
      loadSessionTranscript: async () => [
        {
          role: "user",
          content: `
<relevant-memories>
1. Old memory
</relevant-memories>

Remember that I prefer focused patches.
`,
        },
        {
          role: "assistant",
          content: "I will keep the patch focused.",
        },
      ],
    },
  );

  const onChatMessage = hooks["chat.message"];
  const onEvent = hooks.event;
  assert.ok(onChatMessage);
  assert.ok(onEvent);

  await onChatMessage(
    createChatMessageInput("session-1", { agent: "agent-42" }),
    createChatMessageOutput([textPart("Remember that I prefer focused patches.")]),
  );
  await onEvent(createSessionIdleEventInput("session-1"));
  await waitForBackgroundTasks();

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

test("buildHooks suppresses duplicate session.idle ingests for unchanged transcript", async () => {
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
    {
      loadSessionTranscript: async () => [
        { role: "user", content: "Remember concise updates." },
        { role: "assistant", content: "I will keep updates concise." },
      ],
    },
  );

  const onEvent = hooks.event;
  assert.ok(onEvent);

  await onEvent(createSessionIdleEventInput("session-dedupe"));
  await waitForBackgroundTasks();
  await onEvent(createSessionIdleEventInput("session-dedupe"));
  await waitForBackgroundTasks();

  assert.equal(ingestCalls.length, 1);
});

test("buildHooks retries session.idle ingest after a previous failure", async () => {
  let attempt = 0;
  const ingestCalls: IngestInput[] = [];
  const hooks = buildHooks(
    createBackend({
      async ingestImpl(input) {
        attempt += 1;
        ingestCalls.push(input);
        if (attempt === 1) {
          throw new Error("temporary ingest failure");
        }
        return {
          status: "ok",
          memories_changed: 1,
        };
      },
    }),
    {
      loadSessionTranscript: async () => [
        { role: "user", content: "Remember the retry behavior." },
        { role: "assistant", content: "I retried after the failure." },
      ],
    },
  );

  const onEvent = hooks.event;
  assert.ok(onEvent);

  await onEvent(createSessionIdleEventInput("session-retry"));
  await waitForBackgroundTasks();
  await onEvent(createSessionIdleEventInput("session-retry"));
  await waitForBackgroundTasks();

  assert.equal(ingestCalls.length, 2);
});

test("buildHooks skips session.idle ingest when the transcript has no assistant message", async () => {
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
    {
      loadSessionTranscript: async () => [
        { role: "user", content: "Only a user message is present." },
      ],
    },
  );

  const onEvent = hooks.event;
  assert.ok(onEvent);

  await onEvent(createSessionIdleEventInput("session-user-only"));
  await waitForBackgroundTasks();

  assert.deepEqual(ingestCalls, []);
});

test("event hook resolves before background ingest completes", async () => {
  const ingestDeferred = createDeferred<IngestResult>();
  let ingestStarted = false;
  const hooks = buildHooks(
    createBackend({
      async ingestImpl() {
        ingestStarted = true;
        return ingestDeferred.promise;
      },
    }),
    {
      loadSessionTranscript: async () => [
        { role: "user", content: "Remember the background ingest behavior." },
        { role: "assistant", content: "I captured the latest assistant reply." },
      ],
    },
  );

  const onEvent = hooks.event;
  assert.ok(onEvent);

  const hookPromise = onEvent(createSessionIdleEventInput("session-detached"));
  const raceWinner = await Promise.race([
    hookPromise.then(() => "hook"),
    new Promise<string>((resolve) => {
      setTimeout(() => resolve("timer"), 0);
    }),
  ]);

  assert.equal(raceWinner, "hook");
  await waitForBackgroundTasks();
  assert.equal(ingestStarted, true);

  ingestDeferred.resolve({
    status: "ok",
    memories_changed: 1,
  });
  await waitForBackgroundTasks();
});

test("buildHooks appends a compaction hint and emits debug events", async () => {
  const debugEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const hooks = buildHooks(createBackend(), {
    debugLogger: async (event, payload = {}) => {
      debugEvents.push({ event, payload });
    },
  });

  const onSessionCompacting = hooks["experimental.session.compacting"];
  assert.ok(onSessionCompacting);

  const compactionOutput = createSessionCompactingOutput();
  await onSessionCompacting(createSessionCompactingInput("session-compact"), compactionOutput);
  await waitForBackgroundTasks();

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
  ]);
});

test("buildHooks ingests the current transcript before compaction", async () => {
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
    {
      loadSessionTranscript: async () => [
        { role: "user", content: "Remember the decisions before compaction." },
        { role: "assistant", content: "I captured the latest project decision." },
      ],
    },
  );

  const onSessionCompacting = hooks["experimental.session.compacting"];
  assert.ok(onSessionCompacting);

  await onSessionCompacting(
    createSessionCompactingInput("session-precompact"),
    createSessionCompactingOutput(),
  );
  await waitForBackgroundTasks();

  assert.deepEqual(ingestCalls, [
    {
      session_id: "session-precompact",
      agent_id: "opencode",
      mode: "smart",
      messages: [
        {
          role: "user",
          content: "Remember the decisions before compaction.",
        },
        {
          role: "assistant",
          content: "I captured the latest project decision.",
        },
      ],
    },
  ]);
});

test("buildHooks suppresses duplicate idle ingest after a matching pre-compaction ingest", async () => {
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
    {
      loadSessionTranscript: async () => [
        { role: "user", content: "Remember the duplicated transcript." },
        { role: "assistant", content: "I only need one ingest for this turn." },
      ],
    },
  );

  const onSessionCompacting = hooks["experimental.session.compacting"];
  const onEvent = hooks.event;
  assert.ok(onSessionCompacting);
  assert.ok(onEvent);

  await onSessionCompacting(
    createSessionCompactingInput("session-compaction-dedupe"),
    createSessionCompactingOutput(),
  );
  await waitForBackgroundTasks();

  await onEvent(createSessionIdleEventInput("session-compaction-dedupe"));
  await waitForBackgroundTasks();

  assert.equal(ingestCalls.length, 1);
});

test("debug hooks resolve before background logging completes", async () => {
  const logDeferred = createDeferred<void>();
  const logEvents: string[] = [];
  const hooks = buildHooks(createBackend(), {
    debugLogger: async (event) => {
      logEvents.push(event);
      await logDeferred.promise;
    },
  });

  const onSessionCompacting = hooks["experimental.session.compacting"];
  assert.ok(onSessionCompacting);

  const compactionOutput = createSessionCompactingOutput();
  const raceWinner = await Promise.race([
    onSessionCompacting(createSessionCompactingInput("session-debug"), compactionOutput).then(
      () => "hook",
    ),
    new Promise<string>((resolve) => {
      setTimeout(() => resolve("timer"), 0);
    }),
  ]);

  assert.equal(raceWinner, "hook");
  assert.deepEqual(compactionOutput.context, [
    "Preserve durable user preferences, project decisions, and unfinished work that should survive compaction.",
  ]);
  await waitForBackgroundTasks();
  assert.deepEqual(logEvents, ["session.compacting"]);

  logDeferred.resolve();
  await waitForBackgroundTasks();
});
