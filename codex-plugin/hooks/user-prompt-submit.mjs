// @ts-check

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadRuntimeStateFromDisk } from "../lib/config.mjs";
import { appendDebugError, appendDebugLog } from "./shared/debug.mjs";
import {
  formatMemoriesBlock,
  formatStatusWarningBlock,
  hookAdditionalContext,
  normalizeNoticeMessage,
  stripInjectedMemories,
} from "./shared/format.mjs";
import { buildMem9Url, mem9FetchJson, mem9Headers } from "../lib/http.mjs";
import { formatRuntimeQuotaNotice, parseRuntimeQuotaDenied } from "../lib/quota-error.mjs";
import { formatRuntimeStateNotice } from "../lib/runtime-state.mjs";
import {
  claimRuntimeNotice,
  noticeHash,
} from "./shared/runtime-notice-state.mjs";

const RECALL_LIMIT = 10;

/** @type {{cwd?: string, codexHome?: string, mem9Home?: string}} */
let debugContext = {};

/**
 * @typedef {{
 *   baseUrl: string,
 *   apiKey: string,
 *   agentId: string,
 *   searchTimeoutMs: number,
 *   recallMinPromptLength: number,
 * }} RecallRuntime
 */

/**
 * @typedef {{
 *   content?: string,
 * }} RecallMemory
 */

/**
 * @param {string} baseUrl
 * @param {string} prompt
 * @param {number} [limit]
 * @returns {string}
 */
export function buildRecallUrl(baseUrl, prompt, limit = RECALL_LIMIT) {
  const url = buildMem9Url(baseUrl, "v1alpha2/mem9s/memories");
  url.searchParams.set("q", prompt);
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

/**
 * @param {unknown} payload
 * @returns {RecallMemory[]}
 */
export function extractMemories(payload) {
  if (Array.isArray(payload)) {
    return /** @type {RecallMemory[]} */ (payload);
  }

  if (payload && typeof payload === "object") {
    const typedPayload = /** @type {{memories?: unknown, data?: unknown}} */ (payload);
    if (Array.isArray(typedPayload.memories)) {
      return /** @type {RecallMemory[]} */ (typedPayload.memories);
    }
    if (Array.isArray(typedPayload.data)) {
      return /** @type {RecallMemory[]} */ (typedPayload.data);
    }
  }

  return [];
}

/**
 * @param {unknown} payload
 * @returns {{message: string, source: "success-response" | "runtime-state"} | null}
 */
export function extractResponseNotice(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const typedPayload = /** @type {{message?: unknown, runtimeState?: unknown}} */ (payload);
  const responseMessage = normalizeNoticeMessage(typedPayload.message);
  if (responseMessage) {
    return { message: responseMessage, source: "success-response" };
  }

  const runtimeStateNotice = normalizeNoticeMessage(
    formatRuntimeStateNotice(typedPayload.runtimeState),
  );
  return runtimeStateNotice
    ? { message: runtimeStateNotice, source: "runtime-state" }
    : null;
}

/**
 * @param {{
 *   prompt?: string,
 *   runtime: RecallRuntime,
 *   search: (url: string, options: {timeoutMs: number}) => Promise<unknown>,
 *   debug?: (stage: string, fields?: Record<string, string | number | boolean | null | undefined>) => void,
 *   sessionID?: string,
 *   noticeStateFile?: string,
 * }} input
 * @returns {Promise<string>}
 */
export async function runUserPromptSubmit(input) {
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const query = stripInjectedMemories(prompt).trim();
  const debug = input.debug ?? (() => {});

  if (!query) {
    debug("prompt_empty", {
      promptChars: prompt.length,
    });
    return "";
  }

  if (query.length < input.runtime.recallMinPromptLength) {
    debug("prompt_too_short", {
      promptChars: prompt.length,
      queryChars: query.length,
      recallMinPromptLength: input.runtime.recallMinPromptLength,
    });
    return "";
  }

  if (!input.runtime.apiKey) {
    debug("recall_skipped_missing_api_key");
    return "";
  }

  debug("recall_request", {
    queryChars: query.length,
    timeoutMs: input.runtime.searchTimeoutMs,
  });
  let result;
  try {
    result = await input.search(
      buildRecallUrl(input.runtime.baseUrl, query),
      { timeoutMs: input.runtime.searchTimeoutMs },
    );
  } catch (error) {
    const quotaDenied = parseRuntimeQuotaDenied(error);
    if (!quotaDenied) {
      throw error;
    }

    debug("recall_quota_denied", {
      code: quotaDenied.code,
      actionType: quotaDenied.recommendedAction?.type,
      hasActionUrl: Boolean(quotaDenied.recommendedAction?.url),
    });
    return hookAdditionalContext(
      "UserPromptSubmit",
      formatRuntimeQuotaNotice(error, "recall paused"),
    );
  }
  const memories = extractMemories(result).slice(0, RECALL_LIMIT);
  const notice = extractResponseNotice(result);
  const shouldShowNotice = notice
    ? claimRuntimeNotice({
      stateFile: input.noticeStateFile,
      sessionID: input.sessionID,
      message: notice.message,
    })
    : false;
  debug("recall_response", {
    memoryCount: memories.length,
    hasMessage: Boolean(notice),
    messageLength: notice ? notice.message.length : 0,
    messageHash: notice ? noticeHash(notice.message) : "",
    messageSource: notice?.source ?? "",
  });
  const block = formatMemoriesBlock(memories);
  const statusBlock = shouldShowNotice && notice
    ? formatStatusWarningBlock(notice.message)
    : "";
  const context = [statusBlock, block].filter(Boolean).join("\n\n");

  if (!context) {
    debug("recall_no_context");
    return "";
  }

  debug("context_injected", {
    memoryCount: memories.length,
    blockChars: context.length,
  });
  return hookAdditionalContext("UserPromptSubmit", context);
}

/**
 * @returns {string}
 */
function readStdinText() {
  return readFileSync(0, "utf8");
}

export async function main() {
  const stdin = JSON.parse(readStdinText() || "{}");
  const cwd =
    stdin && typeof stdin === "object" && typeof stdin.cwd === "string"
      ? stdin.cwd
      : process.cwd();
  const prompt =
    stdin && typeof stdin === "object" && typeof stdin.prompt === "string"
      ? stdin.prompt
      : "";
  const sessionID =
    stdin && typeof stdin === "object" && typeof stdin.session_id === "string"
      ? stdin.session_id
      : "";
  const state = loadRuntimeStateFromDisk({ cwd });
  debugContext = {
    cwd,
    codexHome: state.codexHome,
    mem9Home: state.mem9Home,
  };
  appendDebugLog({
    hook: "UserPromptSubmit",
    stage: "state_loaded",
    ...debugContext,
    fields: {
      configSource: state.configSource,
      profileId: state.runtime.profileId,
      projectConfigMatched: state.projectConfigMatched,
      warnings: state.warnings.join(","),
      pluginState: state.pluginState,
      pluginIssueDetail: state.pluginIssueDetail,
      effectiveLegacyPausedSource: state.effectiveLegacyPausedSource,
      issueCode: state.issueCode,
    },
  });
  if (state.issueCode !== "ready") {
    appendDebugLog({
      hook: "UserPromptSubmit",
      stage: "skipped_issue",
      ...debugContext,
      fields: {
        configSource: state.configSource,
        profileId: state.runtime.profileId,
        projectConfigMatched: state.projectConfigMatched,
        warnings: state.warnings.join(","),
        pluginState: state.pluginState,
        pluginIssueDetail: state.pluginIssueDetail,
        effectiveLegacyPausedSource: state.effectiveLegacyPausedSource,
        issueCode: state.issueCode,
      },
    });
    return "";
  }

  return runUserPromptSubmit({
    prompt,
    runtime: state.runtime,
    sessionID,
    noticeStateFile: path.join(state.codexHome, "mem9", "runtime-notices.json"),
    debug(stage, fields) {
      appendDebugLog({
        hook: "UserPromptSubmit",
        stage,
        ...debugContext,
        fields,
      });
    },
    search: (url, options) =>
      mem9FetchJson(url, {
        method: "GET",
        headers: mem9Headers(state.runtime.apiKey, state.runtime.agentId),
        timeoutMs: options.timeoutMs,
      }),
  });
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then((output) => {
      if (output) {
        process.stdout.write(output);
      }
    })
    .catch((error) => {
      appendDebugError({
        hook: "UserPromptSubmit",
        stage: "hook_failed",
        error,
        ...debugContext,
      });
    });
}
