#!/usr/bin/env node
// @ts-check

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { loadRuntimeState, writeJsonAtomic } from "./lib/config.mjs";
import { appendDebugError, appendDebugLog } from "./lib/debug.mjs";
import {
  antigravityInjectSystemMessage,
  formatMemoriesBlock,
  formatStatusWarningBlock,
  isInternalSystemPrompt,
  stripInjectedContext,
} from "./lib/format.mjs";
import { buildMem9Url, mem9FetchJson, mem9Headers } from "./lib/http.mjs";
import {
  claimRuntimeNotice,
  formatRuntimeQuotaNotice,
  formatRuntimeStateNotice,
  parseRuntimeQuotaDenied,
} from "./lib/quota-error.mjs";
import { latestUserStepKey } from "./lib/transcript.mjs";

const RECALL_LIMIT = 10;
const MAX_HOOK_STATE_CONVERSATIONS = 50;

/**
 * @typedef {Record<string, string | undefined>} EnvMap
 * @typedef {Record<string, string | number | boolean | null | undefined>} DebugFields
 * @typedef {{
 *   lastRecalledStepKey?: string,
 *   lastRecalledPromptHash?: string,
 *   lastIngestedHash?: string,
 *   updatedAt?: string,
 * }} ConversationHookState
 * @typedef {{
 *   schemaVersion: number,
 *   conversations: Record<string, ConversationHookState>,
 * }} HookStateFile
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} stdin
 * @returns {string}
 */
export function resolveWorkspaceCwd(stdin) {
  const directCwd = normalizeString(stdin.cwd);
  if (directCwd) {
    return directCwd;
  }

  if (Array.isArray(stdin.workspacePaths)) {
    for (const candidate of stdin.workspacePaths) {
      const normalized = normalizeString(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  return process.cwd();
}

/**
 * @returns {Record<string, unknown>}
 */
function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8").trim();
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * @param {string} baseUrl
 * @param {string} query
 * @param {number} [limit]
 * @returns {string}
 */
export function buildRecallUrl(baseUrl, query, limit = RECALL_LIMIT) {
  const url = new URL(
    String(buildMem9Url(baseUrl, "v1alpha2/mem9s/memories")),
  );
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

/**
 * @param {unknown} payload
 * @returns {Array<{ content?: string, tags?: string[], relative_age?: string }>}
 */
export function extractMemories(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (isRecord(payload)) {
    if (Array.isArray(payload.memories)) {
      return payload.memories;
    }
    if (Array.isArray(payload.data)) {
      return payload.data;
    }
  }

  return [];
}

/**
 * @param {unknown} payload
 * @returns {{ message: string, source: "success-response" | "runtime-state" } | null}
 */
export function extractResponseNotice(payload) {
  if (!isRecord(payload)) {
    return null;
  }

  const responseMessage = normalizeString(payload.message);
  if (responseMessage) {
    return { message: responseMessage, source: "success-response" };
  }

  const runtimeStateNotice = normalizeString(
    formatRuntimeStateNotice(payload.runtimeState),
  );
  return runtimeStateNotice
    ? { message: runtimeStateNotice, source: "runtime-state" }
    : null;
}

/**
 * @param {string} filePath
 * @returns {HookStateFile}
 */
function readHookState(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { schemaVersion: 1, conversations: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const rawConversations = isRecord(parsed?.conversations)
      ? parsed.conversations
      : {};
    /** @type {Record<string, ConversationHookState>} */
    const conversations = {};
    for (const [id, entry] of Object.entries(rawConversations)) {
      if (isRecord(entry)) {
        conversations[id] = {
          ...(typeof entry.lastRecalledStepKey === "string"
            ? { lastRecalledStepKey: entry.lastRecalledStepKey }
            : {}),
          ...(typeof entry.lastRecalledPromptHash === "string"
            ? { lastRecalledPromptHash: entry.lastRecalledPromptHash }
            : {}),
          ...(typeof entry.lastIngestedHash === "string"
            ? { lastIngestedHash: entry.lastIngestedHash }
            : {}),
          ...(typeof entry.updatedAt === "string"
            ? { updatedAt: entry.updatedAt }
            : {}),
        };
      }
    }
    return { schemaVersion: 1, conversations };
  } catch {
    return { schemaVersion: 1, conversations: {} };
  }
}

/**
 * @param {Record<string, ConversationHookState>} conversations
 */
function pruneConversations(conversations) {
  const entries = Object.entries(conversations)
    .map(([id, entry], order) => ({
      id,
      ts: Date.parse(entry.updatedAt ?? "") || 0,
      order,
    }))
    .sort((left, right) => {
      if (right.ts !== left.ts) {
        return right.ts - left.ts;
      }
      return right.order - left.order;
    });

  for (const { id } of entries.slice(MAX_HOOK_STATE_CONVERSATIONS)) {
    delete conversations[id];
  }
}

/**
 * @param {string} filePath
 * @param {string} conversationId
 * @param {{ stepKey: string, promptHash: string }} update
 * @param {Date} now
 */
function recordRecallState(filePath, conversationId, update, now) {
  if (!filePath || !conversationId) {
    return;
  }

  try {
    const state = readHookState(filePath);
    const existing = state.conversations[conversationId] ?? {};
    delete state.conversations[conversationId];
    state.conversations[conversationId] = {
      ...existing,
      ...(update.stepKey ? { lastRecalledStepKey: update.stepKey } : {}),
      lastRecalledPromptHash: update.promptHash,
      updatedAt: now.toISOString(),
    };
    pruneConversations(state.conversations);
    writeJsonAtomic(filePath, state, { mode: 0o600 });
  } catch {
    // Hook state persistence is best-effort.
  }
}

/**
 * @param {string} transcriptPath
 * @param {(filePath: string, encoding: BufferEncoding) => string} readText
 * @returns {string}
 */
function readTranscriptSafe(transcriptPath, readText) {
  if (!transcriptPath) {
    return "";
  }
  try {
    return readText(transcriptPath, "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {{
 *   stdin?: Record<string, unknown>,
 *   cwd?: string,
 *   mem9Home?: string,
 *   pluginDataDir?: string,
 *   env?: EnvMap,
 *   homeDir?: string,
 *   loadState?: typeof loadRuntimeState,
 *   readText?: (filePath: string, encoding: BufferEncoding) => string,
 *   search?: (url: string, options: { timeoutMs: number }) => Promise<unknown>,
 *   claimNotice?: typeof claimRuntimeNotice,
 *   now?: () => Date,
 *   debug?: (stage: string, fields?: DebugFields) => void,
 * }} [input]
 * @returns {Promise<string>}
 */
export async function runPreInvocation(input = {}) {
  const env = input.env ?? process.env;
  const stdin = isRecord(input.stdin) ? input.stdin : {};
  const cwd = normalizeString(input.cwd) || resolveWorkspaceCwd(stdin);
  const pluginDataDir = input.pluginDataDir ?? normalizeString(env.PLUGIN_DATA);
  const conversationId = normalizeString(stdin.conversationId);
  const transcriptPath = normalizeString(stdin.transcriptPath);
  const rawPrompt = typeof stdin.lastUserInput === "string" ? stdin.lastUserInput : "";
  const invocationNum = typeof stdin.invocationNum === "number" && Number.isFinite(stdin.invocationNum)
    ? stdin.invocationNum
    : 1;
  const loadStateFn = input.loadState ?? loadRuntimeState;
  const readTextFn = input.readText ?? readFileSync;
  const claimNoticeFn = input.claimNotice ?? claimRuntimeNotice;
  const nowFn = input.now ?? (() => new Date());

  const state = loadStateFn({
    cwd,
    mem9Home: input.mem9Home,
    pluginDataDir,
    env,
    homeDir: input.homeDir,
  });

  /**
   * @param {string} stage
   * @param {DebugFields} [fields]
   */
  const debug = input.debug ?? ((stage, fields) => {
    appendDebugLog({
      logPath: state.paths.debugLogPath,
      hook: "PreInvocation",
      stage,
      fields,
      env,
    });
  });

  debug("state_loaded", {
    issueCode: state.issueCode,
    configSource: state.configSource,
    authSource: state.authSource,
    profileId: state.runtime.profileId,
  });

  if (state.issueCode !== "ready" || !state.runtime.apiKey) {
    debug("skipped_issue", { issueCode: state.issueCode });
    return "{}";
  }

  if (isInternalSystemPrompt(rawPrompt)) {
    debug("skipped_internal_prompt");
    return "{}";
  }

  const query = stripInjectedContext(rawPrompt).trim();
  if (!query) {
    debug("prompt_empty");
    return "{}";
  }

  if (query.length < state.runtime.recallMinPromptLength) {
    debug("prompt_too_short", {
      queryChars: query.length,
      recallMinPromptLength: state.runtime.recallMinPromptLength,
    });
    return "{}";
  }

  const transcriptRaw = readTranscriptSafe(transcriptPath, readTextFn);
  const stepKey = transcriptRaw ? latestUserStepKey(transcriptRaw) : "";
  const promptHash = sha256Hex(rawPrompt);

  if (conversationId) {
    const hookState = readHookState(state.paths.hookStatePath);
    const existing = hookState.conversations[conversationId];
    if (existing) {
      if (stepKey) {
        if (existing.lastRecalledStepKey === stepKey) {
          debug("skipped_duplicate_turn", { stepKey });
          return "{}";
        }
      } else if (
        invocationNum > 1
        && existing.lastRecalledPromptHash === promptHash
      ) {
        debug("skipped_duplicate_invocation", { invocationNum });
        return "{}";
      }
    }
  }

  const searchFn = input.search ?? ((url, options) =>
    mem9FetchJson(url, {
      method: "GET",
      headers: mem9Headers(state.runtime.apiKey),
      timeoutMs: options.timeoutMs,
    }));

  debug("recall_request", {
    queryChars: query.length,
    timeoutMs: state.runtime.searchTimeoutMs,
  });

  let result;
  try {
    result = await searchFn(
      buildRecallUrl(state.runtime.baseUrl, query),
      { timeoutMs: state.runtime.searchTimeoutMs },
    );
  } catch (error) {
    const quotaDenied = parseRuntimeQuotaDenied(error);
    if (quotaDenied) {
      debug("recall_quota_denied", {
        code: quotaDenied.code,
        actionType: quotaDenied.recommendedAction?.type,
        hasActionUrl: Boolean(quotaDenied.recommendedAction?.url),
      });
      recordRecallState(
        state.paths.hookStatePath,
        conversationId,
        { stepKey, promptHash },
        nowFn(),
      );
      return antigravityInjectSystemMessage(
        formatRuntimeQuotaNotice(error, "recall paused"),
      );
    }

    appendDebugError({
      logPath: state.paths.debugLogPath,
      hook: "PreInvocation",
      stage: "recall_failed",
      error,
      env,
    });
    return "{}";
  }

  recordRecallState(
    state.paths.hookStatePath,
    conversationId,
    { stepKey, promptHash },
    nowFn(),
  );

  const memories = extractMemories(result).slice(0, RECALL_LIMIT);
  const notice = extractResponseNotice(result);
  const shouldShowNotice = notice
    ? claimNoticeFn({
      stateFile: state.paths.noticeStatePath,
      sessionId: conversationId,
      message: notice.message,
    })
    : false;

  debug("recall_response", {
    memoryCount: memories.length,
    hasMessage: Boolean(notice),
    messageSource: notice?.source ?? "",
    noticeClaimed: shouldShowNotice,
  });

  const statusBlock = shouldShowNotice && notice
    ? formatStatusWarningBlock(notice.message)
    : "";
  const memoriesBlock = formatMemoriesBlock(memories);
  const combined = [statusBlock, memoriesBlock].filter(Boolean).join("\n\n");

  if (!combined) {
    debug("recall_no_context");
    return "{}";
  }

  debug("context_injected", {
    memoryCount: memories.length,
    blockChars: combined.length,
  });

  return antigravityInjectSystemMessage(combined);
}

/**
 * @returns {Promise<string>}
 */
export async function main() {
  const stdin = readStdinJson();
  return runPreInvocation({ stdin });
}

/**
 * @returns {boolean}
 */
function isMainModule() {
  if (!process.argv[1]) {
    return false;
  }
  if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    return true;
  }
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main()
    .then((output) => {
      process.stdout.write(output || "{}");
    })
    .catch((error) => {
      try {
        const state = loadRuntimeState({
          cwd: process.cwd(),
          pluginDataDir: normalizeString(process.env.PLUGIN_DATA),
        });
        appendDebugError({
          logPath: state.paths.debugLogPath,
          hook: "PreInvocation",
          stage: "hook_failed",
          error,
        });
      } catch {
        // Hook failure must stay fail-soft and always emit valid JSON.
      }
      process.stdout.write("{}");
    });
}
