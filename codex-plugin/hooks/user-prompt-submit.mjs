// @ts-check

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { loadRuntimeStateFromDisk } from "../lib/config.mjs";
import { appendDebugError, appendDebugLog } from "./shared/debug.mjs";
import { formatMemoriesBlock, hookAdditionalContext, stripInjectedMemories } from "./shared/format.mjs";
import { buildMem9Url, mem9FetchJson, mem9Headers } from "../lib/http.mjs";

const RECALL_LIMIT = 10;

/** @type {{cwd?: string, codexHome?: string, mem9Home?: string}} */
let debugContext = {};

/**
 * @typedef {{
 *   baseUrl: string,
 *   apiKey: string,
 *   agentId: string,
 *   searchTimeoutMs: number,
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
 * @param {string} agentId
 * @param {number} [limit]
 * @returns {string}
 */
export function buildRecallUrl(baseUrl, prompt, agentId, limit = RECALL_LIMIT) {
  const url = buildMem9Url(baseUrl, "v1alpha2/mem9s/memories");
  url.searchParams.set("q", prompt);
  url.searchParams.set("agent_id", agentId);
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
 * @param {{
 *   prompt?: string,
 *   runtime: RecallRuntime,
 *   search: (url: string, options: {timeoutMs: number}) => Promise<unknown>,
 *   debug?: (stage: string, fields?: Record<string, string | number | boolean | null | undefined>) => void,
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

  if (!input.runtime.apiKey) {
    debug("recall_skipped_missing_api_key");
    return "";
  }

  debug("recall_request", {
    queryChars: query.length,
    timeoutMs: input.runtime.searchTimeoutMs,
  });
  const result = await input.search(
    buildRecallUrl(input.runtime.baseUrl, query, input.runtime.agentId),
    { timeoutMs: input.runtime.searchTimeoutMs },
  );
  const memories = extractMemories(result).slice(0, RECALL_LIMIT);
  debug("recall_response", {
    memoryCount: memories.length,
  });
  const block = formatMemoriesBlock(memories);

  if (!block) {
    debug("recall_no_context");
    return "";
  }

  debug("context_injected", {
    memoryCount: memories.length,
    blockChars: block.length,
  });
  return hookAdditionalContext("UserPromptSubmit", block);
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
