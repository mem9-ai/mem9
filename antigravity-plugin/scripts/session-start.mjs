#!/usr/bin/env node
// @ts-check

import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  autoProvisionDefaultProfile,
  loadRuntimeState,
} from "./lib/config.mjs";
import { appendDebugError, appendDebugLog } from "./lib/debug.mjs";
import {
  antigravityInjectSystemMessage,
  formatStatusWarningBlock,
} from "./lib/format.mjs";
import {
  claimRuntimeNotice,
  resolveRuntimeStateNotice,
} from "./lib/quota-error.mjs";

/**
 * @typedef {Record<string, string | undefined>} EnvMap
 * @typedef {Record<string, string | number | boolean | null | undefined>} DebugFields
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
 * @param {{
 *   issueCode: string,
 *   configSource?: string,
 *   projectRoot?: string | null,
 *   runtime?: { profileId?: string },
 * }} state
 * @param {{ autoProvisionFailed?: boolean, autoProvisionDisabled?: boolean }} [meta]
 * @returns {string}
 */
function buildIssueHint(state, meta = {}) {
  const profileId = normalizeString(state.runtime?.profileId);

  switch (state.issueCode) {
    case "invalid_config":
      if (state.configSource === "project" || state.projectRoot) {
        return "mem9 config is invalid JSON (check ~/.mem9/antigravity/config.json or .agents/mem9/config.json). Run /mem9-setup to inspect or repair.";
      }
      return "mem9 config is invalid JSON at ~/.mem9/antigravity/config.json. Run /mem9-setup to inspect or repair.";
    case "invalid_credentials":
      return "mem9 credentials file (~/.mem9/.credentials.json) is invalid JSON or unreadable. Run /mem9-setup to inspect or repair.";
    case "missing_profile":
      return profileId
        ? `mem9 profile "${profileId}" was not found in ~/.mem9/.credentials.json. Run /mem9-setup to select or create a profile.`
        : "mem9 active profile was not found in ~/.mem9/.credentials.json. Run /mem9-setup to configure a profile.";
    case "missing_api_key":
      return profileId
        ? `mem9 profile "${profileId}" is missing an API key. Run /mem9-setup or set MEM9_API_KEY.`
        : "mem9 is missing an API key. Run /mem9-setup or set MEM9_API_KEY.";
    case "missing_config":
      if (meta.autoProvisionFailed) {
        return "mem9 automatic setup failed; recall and saving are paused for now. Run /mem9-setup to configure or inspect status.";
      }
      if (meta.autoProvisionDisabled) {
        return "mem9 is not configured yet (auto-provisioning is disabled). Run /mem9-setup or set MEM9_API_KEY.";
      }
      return "mem9 is not configured yet. Run /mem9-setup or set MEM9_API_KEY.";
    default:
      return "mem9 is unavailable due to a configuration issue. Run /mem9-setup to inspect status.";
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
 *   autoProvision?: typeof autoProvisionDefaultProfile,
 *   provisionFn?: (baseUrl: string) => Promise<{ apiKey: string, baseUrl: string }>,
 *   fetchState?: (url: string, options: { timeoutMs: number }) => Promise<unknown>,
 *   claimNotice?: typeof claimRuntimeNotice,
 *   debug?: (stage: string, fields?: DebugFields) => void,
 * }} [input]
 * @returns {Promise<string>}
 */
export async function runSessionStart(input = {}) {
  const env = input.env ?? process.env;
  const stdin = isRecord(input.stdin) ? input.stdin : {};
  const cwd = normalizeString(input.cwd) || resolveWorkspaceCwd(stdin);
  const pluginDataDir = input.pluginDataDir ?? normalizeString(env.PLUGIN_DATA);
  const conversationId = normalizeString(stdin.conversationId);
  const loadStateFn = input.loadState ?? loadRuntimeState;
  const autoProvisionFn = input.autoProvision ?? autoProvisionDefaultProfile;
  const claimNoticeFn = input.claimNotice ?? claimRuntimeNotice;

  let state = loadStateFn({
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
      hook: "SessionStart",
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
    warnings: state.warnings.join(","),
  });

  let autoProvisionFailed = false;
  let autoProvisionDisabled = false;

  if (state.issueCode === "missing_config") {
    try {
      const provisioned = await autoProvisionFn({
        cwd,
        mem9Home: input.mem9Home,
        pluginDataDir,
        env,
        ...(input.homeDir !== undefined ? { homeDir: input.homeDir } : {}),
        ...(input.provisionFn ? { provisionFn: input.provisionFn } : {}),
      });
      if (provisioned === null) {
        if (/^(0|false|no|off)$/i.test(normalizeString(env?.MEM9_AUTO_PROVISION))) {
          autoProvisionDisabled = true;
          debug("auto_provision_disabled");
        } else {
          debug("auto_provision_skipped");
        }
      } else {
        state = provisioned;
        debug("auto_provisioned", {
          issueCode: state.issueCode,
          authSource: state.authSource,
          profileId: state.runtime.profileId,
        });
      }
    } catch (error) {
      autoProvisionFailed = true;
      appendDebugError({
        logPath: state.paths.debugLogPath,
        hook: "SessionStart",
        stage: "auto_provision_failed",
        error,
        env,
      });
    }
  }

  if (state.issueCode === "disabled") {
    debug("skipped_disabled");
    return "{}";
  }

  if (state.issueCode !== "ready") {
    const hint = buildIssueHint(state, {
      autoProvisionFailed,
      autoProvisionDisabled,
    });
    debug("issue_hint_injected", {
      issueCode: state.issueCode,
    });
    return antigravityInjectSystemMessage(hint);
  }

  const notice = await resolveRuntimeStateNotice({
    runtime: state.runtime,
    fetchState: input.fetchState,
    debug,
  });

  if (notice) {
    const shouldShow = claimNoticeFn({
      stateFile: state.paths.noticeStatePath,
      sessionId: conversationId,
      message: notice,
    });
    if (shouldShow) {
      const warningBlock = formatStatusWarningBlock(notice);
      debug("runtime_notice_injected", {
        hasConversationId: Boolean(conversationId),
      });
      return antigravityInjectSystemMessage(warningBlock || notice);
    }
    debug("runtime_notice_already_claimed", {
      hasConversationId: Boolean(conversationId),
    });
  }

  return "{}";
}

/**
 * @returns {Promise<string>}
 */
export async function main() {
  const stdin = readStdinJson();
  return runSessionStart({ stdin });
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
          hook: "SessionStart",
          stage: "hook_failed",
          error,
        });
      } catch {
        // Hook failure must stay fail-soft and always emit valid JSON.
      }
      process.stdout.write("{}");
    });
}
