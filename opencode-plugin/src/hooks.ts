import type { Hooks } from "@opencode-ai/plugin";
import type { IngestMessage, MemoryBackend } from "./backend.js";
import type { DebugLogger } from "./debug.js";
import { submitMessagesForIngest } from "./ingest/submit.js";
import { formatRecallBlock } from "./recall/format.js";
import { buildRecallQuery } from "./recall/query.js";

const MAX_RECALL_RESULTS = 8;
const MIN_RECALL_QUERY_LEN = 5;
const SESSION_CACHE_MAX_ENTRIES = 100;
const SESSION_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_TRANSCRIPT_MESSAGES = 24;
const DEFAULT_AGENT_ID = "opencode";
const COMPACTION_HINT =
  "Preserve durable user preferences, project decisions, and unfinished work that should survive compaction.";

type ChatMessageHook = NonNullable<Hooks["chat.message"]>;
type ChatMessageOutput = Parameters<ChatMessageHook>[1];

interface SessionState {
  latestPrompt: string | null;
  transcript: IngestMessage[];
  agentID: string;
  updatedAt: number;
}

export interface BuildHooksOptions {
  agentID?: string;
  debugLogger?: DebugLogger;
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
    transcript: [],
    agentID: fallbackAgentID,
    updatedAt: now,
  };
  cache.set(sessionID, state);
  return state;
}

function appendTranscriptMessage(state: SessionState, message: IngestMessage): void {
  const content = message.content.trim();
  if (!content) {
    return;
  }

  state.transcript.push({
    role: message.role,
    content,
  });

  if (state.transcript.length > MAX_TRANSCRIPT_MESSAGES) {
    state.transcript.splice(0, state.transcript.length - MAX_TRANSCRIPT_MESSAGES);
  }
}

export function buildHooks(
  backend: MemoryBackend,
  options: BuildHooksOptions = {},
): Pick<
  Hooks,
  | "chat.message"
  | "experimental.chat.system.transform"
  | "experimental.text.complete"
  | "tool.execute.after"
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
      if (!prompt) {
        state.latestPrompt = null;
        return;
      }

      state.latestPrompt = prompt;
      appendTranscriptMessage(state, {
        role: "user",
        content: prompt,
      });
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) {
        return;
      }

      pruneSessionState(sessionStateByID, Date.now());

      const state = sessionStateByID.get(input.sessionID);
      if (!state || !state.latestPrompt) {
        return;
      }

      const query = buildRecallQuery(state.latestPrompt);
      if (query.length < MIN_RECALL_QUERY_LEN) {
        return;
      }

      try {
        const result = await backend.search({ q: query, limit: MAX_RECALL_RESULTS });
        const block = formatRecallBlock(result.memories);
        if (block) {
          output.system.push(block);
        }
      } catch {
        // Recall failures must not block chat.
      }
    },
    "experimental.text.complete": async (input, output) => {
      const content = output.text.trim();
      if (!content) {
        return;
      }

      const now = Date.now();
      pruneSessionState(sessionStateByID, now);

      const state = ensureSessionState(sessionStateByID, input.sessionID, now, fallbackAgentID);
      appendTranscriptMessage(state, {
        role: "assistant",
        content,
      });

      runInBackground(
        submitMessagesForIngest({
          backend,
          messages: state.transcript,
          sessionID: input.sessionID,
          agentID: state.agentID,
          debugLogger: options.debugLogger,
        }),
      );
    },
    "tool.execute.after": async (input, output) => {
      if (!options.debugLogger) {
        return;
      }

      runInBackground(
        options.debugLogger("tool.execute.after", {
          sessionID: input.sessionID,
          tool: input.tool,
          callID: input.callID,
          args: input.args,
          title: output.title,
          output: output.output,
          metadata: output.metadata,
        }),
      );
    },
    "experimental.session.compacting": async (input, output) => {
      output.context.push(COMPACTION_HINT);
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
