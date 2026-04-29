import type { Hooks } from "@opencode-ai/plugin";
import type { IngestMessage, MemoryBackend } from "./backend.ts";
import type { DebugLogger } from "./debug.ts";
import { selectMessagesForIngest } from "./ingest/select.ts";
import { submitMessagesForIngest } from "./ingest/submit.ts";
import { formatRecallBlock } from "./recall/format.ts";
import { buildRecallQuery } from "./recall/query.ts";
import type { SessionTranscriptLoader } from "./session-transcript.ts";

const MAX_RECALL_RESULTS = 10;
const MIN_RECALL_QUERY_LEN = 5;
const SESSION_CACHE_MAX_ENTRIES = 100;
const SESSION_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_AGENT_ID = "opencode";
const COMPACTION_HINT =
  "Preserve durable user preferences, project decisions, and unfinished work that should survive compaction.";

type ChatMessageHook = NonNullable<Hooks["chat.message"]>;
type ChatMessageOutput = Parameters<ChatMessageHook>[1];
type EventHook = NonNullable<Hooks["event"]>;
type EventInput = Parameters<EventHook>[0];

interface SessionState {
  latestPrompt: string | null;
  lastIngestFingerprint: string | null;
  pendingIngestFingerprint: string | null;
  agentID: string;
  updatedAt: number;
}

export interface BuildHooksOptions {
  agentID?: string;
  debugLogger?: DebugLogger;
  loadSessionTranscript?: SessionTranscriptLoader;
}

function runInBackground(task: Promise<unknown>): void {
  void task.catch(() => {
    // Background ingest and debug work stays fail-soft.
  });
}

function extractLatestUserPrompt(parts: ChatMessageOutput["parts"]): string | null {
  const chunks: string[] = [];

  for (const part of parts) {
    if (part.type !== "text" || typeof part.text !== "string") {
      continue;
    }

    const synthetic = "synthetic" in part && part.synthetic === true;
    const ignored = "ignored" in part && part.ignored === true;
    if (synthetic || ignored) {
      continue;
    }

    const text = part.text.trim();
    if (text) {
      chunks.push(text);
    }
  }

  return chunks.length > 0 ? chunks.join("\n\n") : null;
}

function pruneSessionState(cache: Map<string, SessionState>, now: number): void {
  for (const [sessionID, state] of cache.entries()) {
    if (now - state.updatedAt > SESSION_CACHE_TTL_MS) {
      cache.delete(sessionID);
    }
  }

  while (cache.size > SESSION_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) {
      break;
    }
    cache.delete(oldest);
  }
}

function resolveAgentID(candidate: string | undefined, fallback: string): string {
  if (typeof candidate !== "string") {
    return fallback;
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function ensureSessionState(
  cache: Map<string, SessionState>,
  sessionID: string,
  now: number,
  fallbackAgentID: string,
): SessionState {
  const existing = cache.get(sessionID);
  if (existing) {
    existing.updatedAt = now;
    cache.delete(sessionID);
    cache.set(sessionID, existing);
    return existing;
  }

  const state: SessionState = {
    latestPrompt: null,
    lastIngestFingerprint: null,
    pendingIngestFingerprint: null,
    agentID: fallbackAgentID,
    updatedAt: now,
  };
  cache.set(sessionID, state);
  return state;
}

function buildIngestFingerprint(messages: IngestMessage[]): string {
  return JSON.stringify(messages);
}

function hasAssistantMessage(messages: IngestMessage[]): boolean {
  return messages.some((message) => message.role === "assistant");
}

async function ingestSessionTranscript(
  sessionID: string,
  reason: "session.idle" | "session.compacting",
  sessionStateByID: Map<string, SessionState>,
  backend: MemoryBackend,
  options: BuildHooksOptions,
  fallbackAgentID: string,
): Promise<void> {
  if (!options.loadSessionTranscript) {
    return;
  }

  const now = Date.now();
  pruneSessionState(sessionStateByID, now);
  const state = ensureSessionState(sessionStateByID, sessionID, now, fallbackAgentID);

  let transcript: IngestMessage[];
  try {
    transcript = await options.loadSessionTranscript(sessionID);
  } catch (error) {
    await options.debugLogger?.(`${reason}.error`, {
      sessionID,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const selectedMessages = selectMessagesForIngest(transcript);
  if (selectedMessages.length === 0) {
    await options.debugLogger?.(`${reason}.skip`, {
      sessionID,
      reason: "empty_selection",
    });
    return;
  }

  if (!hasAssistantMessage(selectedMessages)) {
    await options.debugLogger?.(`${reason}.skip`, {
      sessionID,
      reason: "no_assistant_message",
    });
    return;
  }

  const fingerprint = buildIngestFingerprint(selectedMessages);
  if (
    state.pendingIngestFingerprint === fingerprint ||
    state.lastIngestFingerprint === fingerprint
  ) {
    await options.debugLogger?.(`${reason}.skip`, {
      sessionID,
      reason: "duplicate_transcript",
    });
    return;
  }

  state.pendingIngestFingerprint = fingerprint;
  runInBackground(
    (async () => {
      try {
        await options.debugLogger?.(reason, {
          sessionID,
          messageCount: selectedMessages.length,
        });
        await submitMessagesForIngest({
          backend,
          messages: transcript,
          sessionID,
          agentID: state.agentID,
          debugLogger: options.debugLogger,
        });
        state.lastIngestFingerprint = fingerprint;
      } finally {
        if (state.pendingIngestFingerprint === fingerprint) {
          state.pendingIngestFingerprint = null;
        }
      }
    })(),
  );
}

export function buildHooks(
  backend: MemoryBackend,
  options: BuildHooksOptions = {},
): Pick<
  Hooks,
  | "chat.message"
  | "event"
  | "experimental.chat.system.transform"
  | "experimental.session.compacting"
> {
  const sessionStateByID = new Map<string, SessionState>();
  const fallbackAgentID = resolveAgentID(options.agentID, DEFAULT_AGENT_ID);

  return {
    "chat.message": async (input, output) => {
      const now = Date.now();
      pruneSessionState(sessionStateByID, now);

      const state = ensureSessionState(sessionStateByID, input.sessionID, now, fallbackAgentID);
      state.agentID = resolveAgentID(input.agent, state.agentID);

      const prompt = extractLatestUserPrompt(output.parts);
      state.latestPrompt = prompt;

      if (!options.debugLogger) {
        return;
      }

      if (!prompt) {
        await options.debugLogger("recall.capture.skip", {
          sessionID: input.sessionID,
          agentID: state.agentID,
          reason: "no_user_text",
        });
        return;
      }

      await options.debugLogger("recall.capture", {
        sessionID: input.sessionID,
        agentID: state.agentID,
        prompt,
        promptLength: prompt.length,
      });
    },
    event: async (input) => {
      if (input.event.type !== "session.idle") {
        return;
      }

      await ingestSessionTranscript(
        input.event.properties.sessionID,
        "session.idle",
        sessionStateByID,
        backend,
        options,
        fallbackAgentID,
      );
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) {
        await options.debugLogger?.("recall.skip", {
          reason: "missing_session_id",
        });
        return;
      }

      pruneSessionState(sessionStateByID, Date.now());

      const state = sessionStateByID.get(input.sessionID);
      if (!state || !state.latestPrompt) {
        await options.debugLogger?.("recall.skip", {
          sessionID: input.sessionID,
          reason: "no_captured_prompt",
        });
        return;
      }

      const query = buildRecallQuery(state.latestPrompt);
      if (query.length < MIN_RECALL_QUERY_LEN) {
        await options.debugLogger?.("recall.skip", {
          sessionID: input.sessionID,
          reason: "query_too_short",
          queryText: query,
          queryLength: query.length,
        });
        return;
      }

      try {
        await options.debugLogger?.("recall.request", {
          sessionID: input.sessionID,
          queryText: query,
          queryLength: query.length,
          limit: MAX_RECALL_RESULTS,
        });
        const result = await backend.search({ q: query, limit: MAX_RECALL_RESULTS });
        const block = formatRecallBlock(result.memories);
        await options.debugLogger?.("recall.result", {
          sessionID: input.sessionID,
          memoryCount: result.memories.length,
          injected: Boolean(block),
        });
        if (block) {
          output.system.push(block);
        }
      } catch (error) {
        await options.debugLogger?.("recall.error", {
          sessionID: input.sessionID,
          error: error instanceof Error ? error.message : String(error),
        });
        // Recall failures must not block chat.
      }
    },
    "experimental.session.compacting": async (input, output) => {
      output.context.push(COMPACTION_HINT);

      const state = sessionStateByID.get(input.sessionID);
      if (state) {
        state.updatedAt = Date.now();
      }

      runInBackground(
        ingestSessionTranscript(
          input.sessionID,
          "session.compacting",
          sessionStateByID,
          backend,
          options,
          fallbackAgentID,
        ),
      );

      if (!options.debugLogger) {
        return;
      }

      runInBackground(
        options.debugLogger("session.compacting", {
          sessionID: input.sessionID,
          hint: COMPACTION_HINT,
        }),
      );
    },
  };
}
