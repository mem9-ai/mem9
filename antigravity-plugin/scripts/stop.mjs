#!/usr/bin/env node
// @ts-check

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { loadRuntimeState, writeJsonAtomic } from "./lib/config.mjs";
import { appendDebugError, appendDebugLog } from "./lib/debug.mjs";
import { buildMem9Url, mem9FetchJson, mem9Headers } from "./lib/http.mjs";
import { parseRuntimeQuotaDenied } from "./lib/quota-error.mjs";
import { parseTranscriptText, selectStopWindow } from "./lib/transcript.mjs";

export const STOP_MAX_MESSAGES = 20;
export const STOP_MAX_BYTES = 200_000;
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
 * @returns {string}
 */
export function buildIngestUrl(baseUrl) {
  return String(buildMem9Url(baseUrl, "v1alpha2/mem9s/memories"));
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
 * @param {string} ingestHash
 * @param {Date} now
 */
function recordIngestState(filePath, conversationId, ingestHash, now) {
  if (!filePath || !conversationId) {
    return;
  }

  try {
    const state = readHookState(filePath);
    const existing = state.conversations[conversationId] ?? {};
    delete state.conversations[conversationId];
    state.conversations[conversationId] = {
      ...existing,
      lastIngestedHash: ingestHash,
      updatedAt: now.toISOString(),
    };
    pruneConversations(state.conversations);
    writeJsonAtomic(filePath, state, { mode: 0o600 });
  } catch {
    // Hook state persistence is best-effort.
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
 *   post?: (url: string, body: unknown, options: { timeoutMs: number }) => Promise<unknown>,
 *   now?: () => Date,
 *   debug?: (stage: string, fields?: DebugFields) => void,
 * }} [input]
 * @returns {Promise<string>}
 */
export async function runStop(input = {}) {
  const env = input.env ?? process.env;
  const stdin = isRecord(input.stdin) ? input.stdin : {};
  const cwd = normalizeString(input.cwd) || resolveWorkspaceCwd(stdin);
  const pluginDataDir = input.pluginDataDir ?? normalizeString(env.PLUGIN_DATA);
  const conversationId = normalizeString(stdin.conversationId);
  const transcriptPath = normalizeString(stdin.transcriptPath);
  const loadStateFn = input.loadState ?? loadRuntimeState;
  const readTextFn = input.readText ?? readFileSync;
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
      hook: "Stop",
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
    terminationReason: normalizeString(stdin.terminationReason),
    continuationActive: typeof stdin.continuationActive === "boolean"
      ? stdin.continuationActive
      : undefined,
  });

  if (state.issueCode !== "ready" || !state.runtime.apiKey) {
    debug("skipped_issue", { issueCode: state.issueCode });
    return "{}";
  }

  if (!conversationId) {
    debug("ingest_skipped_missing_session_id");
    return "{}";
  }

  if (!transcriptPath) {
    debug("ingest_skipped_missing_transcript_path");
    return "{}";
  }

  let transcriptRaw = "";
  try {
    transcriptRaw = readTextFn(transcriptPath, "utf8");
  } catch (error) {
    appendDebugError({
      logPath: state.paths.debugLogPath,
      hook: "Stop",
      stage: "transcript_read_failed",
      error,
      env,
    });
    return "{}";
  }

  const parsed = parseTranscriptText(transcriptRaw);
  const messages = selectStopWindow(parsed, STOP_MAX_MESSAGES, STOP_MAX_BYTES);
  const selectedBytes = messages.reduce(
    (total, msg) => total + Buffer.byteLength(msg.content, "utf8"),
    0,
  );

  debug("ingest_window_selected", {
    transcriptMessageCount: parsed.length,
    selectedMessageCount: messages.length,
    selectedBytes,
  });

  if (messages.length === 0) {
    debug("ingest_empty");
    return "{}";
  }

  const ingestHash = sha256Hex(JSON.stringify(messages));
  const hookState = readHookState(state.paths.hookStatePath);
  if (hookState.conversations[conversationId]?.lastIngestedHash === ingestHash) {
    debug("ingest_skipped_duplicate");
    return "{}";
  }

  const body = {
    session_id: conversationId,
    agent_id: state.runtime.agentId,
    mode: "smart",
    messages,
  };

  const postFn = input.post ?? ((url, payload, options) =>
    mem9FetchJson(url, {
      method: "POST",
      headers: mem9Headers(state.runtime.apiKey),
      body: JSON.stringify(payload),
      timeoutMs: options.timeoutMs,
    }));

  try {
    await postFn(
      buildIngestUrl(state.runtime.baseUrl),
      body,
      { timeoutMs: state.runtime.defaultTimeoutMs },
    );
  } catch (error) {
    const quotaDenied = parseRuntimeQuotaDenied(error);
    if (quotaDenied) {
      debug("ingest_quota_denied", {
        code: quotaDenied.code,
        actionType: quotaDenied.recommendedAction?.type,
        hasActionUrl: Boolean(quotaDenied.recommendedAction?.url),
      });
      return "{}";
    }

    appendDebugError({
      logPath: state.paths.debugLogPath,
      hook: "Stop",
      stage: "ingest_failed",
      error,
      env,
    });
    return "{}";
  }

  recordIngestState(state.paths.hookStatePath, conversationId, ingestHash, nowFn());
  debug("ingest_sent", {
    selectedMessageCount: messages.length,
    selectedBytes,
    timeoutMs: state.runtime.defaultTimeoutMs,
  });

  return "{}";
}

/**
 * @returns {Promise<string>}
 */
export async function main() {
  const stdin = readStdinJson();
  return runStop({ stdin });
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
          hook: "Stop",
          stage: "hook_failed",
          error,
        });
      } catch {
        // Hook failure must stay fail-soft and always emit valid JSON.
      }
      process.stdout.write("{}");
    });
}
