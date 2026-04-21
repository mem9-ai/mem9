// @ts-check

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { loadRuntimeStateFromDisk } from "../lib/config.mjs";
import { appendDebugError, appendDebugLog } from "./shared/debug.mjs";
import { mem9FetchJson, mem9Headers } from "../lib/http.mjs";
import { parseTranscriptText, selectStopWindow } from "./shared/transcript.mjs";

export const STOP_MAX_MESSAGES = 20;
export const STOP_MAX_BYTES = 200_000;

/** @type {{cwd?: string, codexHome?: string, mem9Home?: string}} */
let debugContext = {};

/**
 * @typedef {{
 *   role: "user" | "assistant",
 *   content: string,
 * }} IngestMessage
 */

/**
 * @typedef {{
 *   baseUrl: string,
 *   apiKey: string,
 *   agentId: string,
 *   defaultTimeoutMs: number,
 * }} StopRuntime
 */

/**
 * @param {string} baseUrl
 * @returns {string}
 */
export function buildIngestUrl(baseUrl) {
  return `${baseUrl.replace(/\/+$/, "")}/v1alpha2/mem9s/memories`;
}

/**
 * @param {{
 *   sessionId?: string,
 *   runtime: StopRuntime,
 *   transcriptMessages: IngestMessage[],
 *   post: (url: string, body: unknown, options: {timeoutMs: number}) => Promise<unknown>,
 *   debug?: (stage: string, fields?: Record<string, string | number | boolean | null | undefined>) => void,
 * }} input
 * @returns {Promise<unknown>}
 */
export async function runStop(input) {
  const debug = input.debug ?? (() => {});

  if (!input.runtime.apiKey) {
    debug("ingest_skipped_missing_api_key");
    return undefined;
  }

  if (!input.sessionId) {
    debug("ingest_skipped_missing_session_id");
    return undefined;
  }

  const messages = selectStopWindow(
    input.transcriptMessages,
    STOP_MAX_MESSAGES,
    STOP_MAX_BYTES,
  );
  const selectedBytes = messages.reduce(
    (total, message) => total + new TextEncoder().encode(message.content).byteLength,
    0,
  );
  debug("ingest_window_selected", {
    transcriptMessageCount: input.transcriptMessages.length,
    selectedMessageCount: messages.length,
    selectedBytes,
  });
  if (messages.length === 0) {
    debug("ingest_empty");
    return undefined;
  }

  const body = {
    session_id: input.sessionId,
    agent_id: input.runtime.agentId,
    mode: "smart",
    messages,
  };

  await input.post(
    buildIngestUrl(input.runtime.baseUrl),
    body,
    { timeoutMs: input.runtime.defaultTimeoutMs },
  );
  debug("ingest_sent", {
    selectedMessageCount: messages.length,
    selectedBytes,
    timeoutMs: input.runtime.defaultTimeoutMs,
  });

  return body;
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
  const transcriptPath =
    stdin && typeof stdin === "object" && typeof stdin.transcript_path === "string"
      ? stdin.transcript_path
      : "";
  const sessionId =
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
    hook: "Stop",
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
      hook: "Stop",
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
    return;
  }

  if (!transcriptPath) {
    appendDebugLog({
      hook: "Stop",
      stage: "ingest_input_missing",
      ...debugContext,
      fields: {
        configSource: state.configSource,
        profileId: state.runtime.profileId,
        projectConfigMatched: state.projectConfigMatched,
        transcriptPathPresent: false,
        sessionIdPresent: Boolean(sessionId),
      },
    });
    return;
  }

  const transcriptMessages = parseTranscriptText(readFileSync(transcriptPath, "utf8"));
  appendDebugLog({
    hook: "Stop",
    stage: "transcript_loaded",
    ...debugContext,
    fields: {
      configSource: state.configSource,
      profileId: state.runtime.profileId,
      projectConfigMatched: state.projectConfigMatched,
      transcriptPathPresent: true,
      sessionIdPresent: Boolean(sessionId),
      transcriptMessageCount: transcriptMessages.length,
    },
  });

  await runStop({
    sessionId,
    runtime: state.runtime,
    transcriptMessages,
    debug(stage, fields) {
      appendDebugLog({
        hook: "Stop",
        stage,
        ...debugContext,
        fields,
      });
    },
    post: (url, body, options) =>
      mem9FetchJson(url, {
        method: "POST",
        headers: mem9Headers(state.runtime.apiKey, state.runtime.agentId),
        body: JSON.stringify(body),
        timeoutMs: options.timeoutMs,
      }),
  });
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    appendDebugError({
      hook: "Stop",
      stage: "hook_failed",
      error,
      ...debugContext,
    });
  });
}
