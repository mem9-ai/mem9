import type { Hooks } from "@opencode-ai/plugin";
import type { IngestMessage, MemoryBackend } from "./backend.ts";
import type { DebugLogger } from "./debug.ts";
import { selectMessagesForIngest } from "./ingest/select.ts";
import { submitMessagesForIngest } from "./ingest/submit.ts";
import { formatRuntimeQuotaNotice, parseRuntimeQuotaDenied } from "./quota-error.ts";
import { formatRecallBlock } from "./recall/format.ts";
import { buildRecallQuery } from "./recall/query.ts";
import { normalizeNoticeMessage, responseMessage } from "./response-message.ts";
import { formatRuntimeStateNotice } from "./runtime-state.ts";
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
type MessagesTransformHook = NonNullable<Hooks["experimental.chat.messages.transform"]>;
type MessagesTransformOutput = Parameters<MessagesTransformHook>[1];
type EventHook = NonNullable<Hooks["event"]>;
type EventInput = Parameters<EventHook>[0];

interface SessionState {
  latestPrompt: string | null;
  lastIngestFingerprint: string | null;
  pendingIngestFingerprint: string | null;
  agentID: string;
  runtimeStateNoticeShown: boolean;
  pendingRuntimeStateNotice: string | null;
  seenNoticeMessages: Set<string>;
  updatedAt: number;
}

export interface BuildHooksOptions {
  agentID?: string;
  debugLogger?: DebugLogger;
  loadSessionTranscript?: SessionTranscriptLoader;
  noticeLogger?: (notice: string) => void;
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

function findLatestUserMessage(
  messages: MessagesTransformOutput["messages"],
): MessagesTransformOutput["messages"][number] | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.info.role === "user") {
      return message;
    }
  }
  return null;
}

function escapeForPrompt(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function runtimeStateNoticeText(notice: string): string {
  const message = normalizeNoticeMessage(notice);
  if (!message) {
    return "";
  }

  return [
    "<mem9-status-warning>",
    `Mem9 notice for the user: ${escapeForPrompt(message)}`,
    `Start the next response with: Mem9 notice: ${escapeForPrompt(message)}`,
    "</mem9-status-warning>",
  ].join("\n");
}

function consumeNoticeMessage(state: SessionState, message: string): string {
  const notice = normalizeNoticeMessage(message);
  if (!notice || state.seenNoticeMessages.has(notice)) {
    return "";
  }

  state.seenNoticeMessages.add(notice);
  return notice;
}

async function consumeRuntimeStateNotice(
  state: SessionState,
  backend: MemoryBackend,
): Promise<string> {
  if (state.runtimeStateNoticeShown) {
    return "";
  }
  state.runtimeStateNoticeShown = true;

  try {
    return consumeNoticeMessage(state, formatRuntimeStateNotice(await backend.runtimeState()));
  } catch {
    // Runtime-state warmup is advisory and must stay fail-soft.
    return "";
  }
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
    runtimeStateNoticeShown: false,
    pendingRuntimeStateNotice: null,
    seenNoticeMessages: new Set<string>(),
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
        const result = await submitMessagesForIngest({
          backend,
          messages: transcript,
          sessionID,
          agentID: state.agentID,
          debugLogger: options.debugLogger,
        });
        if (result) {
          state.lastIngestFingerprint = fingerprint;
        }
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
  | "experimental.chat.messages.transform"
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
    "experimental.chat.messages.transform": async (_input, output) => {
      const latestUserMessage = findLatestUserMessage(output.messages);
      if (!latestUserMessage) {
        return;
      }

      const now = Date.now();
      pruneSessionState(sessionStateByID, now);
      const state = ensureSessionState(
        sessionStateByID,
        latestUserMessage.info.sessionID,
        now,
        fallbackAgentID,
      );
      if (latestUserMessage.info.role === "user") {
        state.agentID = resolveAgentID(latestUserMessage.info.agent, state.agentID);
      }

      const prompt = extractLatestUserPrompt(latestUserMessage.parts);
      if (prompt) {
        state.latestPrompt = prompt;
      }

      const notice = await consumeRuntimeStateNotice(state, backend);
      if (!notice) {
        return;
      }
      state.pendingRuntimeStateNotice = notice;
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

      const state = ensureSessionState(
        sessionStateByID,
        input.sessionID,
        Date.now(),
        fallbackAgentID,
      );

      if (!state.latestPrompt) {
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
        const responseNotice = consumeNoticeMessage(state, responseMessage(result));
        const pendingNotice = state.pendingRuntimeStateNotice;
        state.pendingRuntimeStateNotice = null;
        const notice = responseNotice || pendingNotice || "";
        if (notice) {
          options.noticeLogger?.(notice);
        }
        const block = formatRecallBlock(result.memories);
        const statusBlock = runtimeStateNoticeText(notice);
        const context = [statusBlock, block].filter(Boolean).join("\n\n");
        await options.debugLogger?.("recall.result", {
          sessionID: input.sessionID,
          memoryCount: result.memories.length,
          injected: Boolean(context),
          hasMessage: Boolean(notice),
          messageLength: notice.length,
        });
        if (context) {
          output.system.push(context);
        }
      } catch (error) {
        const quotaDenied = parseRuntimeQuotaDenied(error);
        if (quotaDenied) {
          await options.debugLogger?.("recall.quota_denied", {
            sessionID: input.sessionID,
            code: quotaDenied.code,
            actionType: quotaDenied.recommendedAction?.type,
            hasActionUrl: Boolean(quotaDenied.recommendedAction?.url),
          });
          output.system.push(formatRuntimeQuotaNotice(error, "recall paused"));
          return;
        }

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
