// @ts-check

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { loadRuntimeStateFromDisk } from "../lib/config.mjs";
import { appendDebugError, appendDebugLog } from "./shared/debug.mjs";
import { hookAdditionalContext } from "./shared/format.mjs";

/** @type {{cwd?: string, codexHome?: string, mem9Home?: string}} */
let debugContext = {};

/**
 * @typedef {{
 *   configSource: "global" | "project",
 *   projectConfigMatched?: boolean,
 *   profileId?: string,
 *   warnings?: ("invalid_global_config_ignored" | "invalid_project_config_ignored")[],
 *   legacyPausedSources?: ("global" | "project")[],
 *   effectiveLegacyPausedSource?: "global" | "project" | null,
 *   issueCode: "ready" | "plugin_disabled" | "plugin_missing" | "legacy_paused" | "missing_config" | "invalid_config" | "missing_profile" | "invalid_credentials" | "missing_api_key",
 * }} SessionStartState
 */

/**
 * @param {SessionStartState} state
 * @param {string} [setupCommand]
 * @param {string} [projectConfigCommand]
 * @returns {string}
 */
export function buildSessionStartMessage(
  state,
  setupCommand = "$mem9:setup",
  projectConfigCommand = "$mem9:project-config",
) {
  const profileText = state.profileId
    ? `profile \`${state.profileId}\``
    : "the current profile";

  if (state.issueCode === "ready") {
    const warningMessages = [];

    if (state.warnings?.includes("invalid_project_config_ignored")) {
      warningMessages.push("The project override could not be read, so this session fell back to the global default.");
    }

    if (state.warnings?.includes("invalid_global_config_ignored")) {
      warningMessages.push("The global default could not be read, so this session is running from the project override only.");
    }

    if (state.configSource === "project") {
      return `mem9 is ready. This session uses the local override in \`.codex/mem9/config.json\` with ${profileText}. It will recall on user prompt submit and save a recent conversation window on stop.${warningMessages.length > 0 ? ` ${warningMessages.join(" ")}` : ""}`;
    }

    return `mem9 is ready. This session uses the global default config with ${profileText}. It will recall on user prompt submit and save a recent conversation window on stop.${warningMessages.length > 0 ? ` ${warningMessages.join(" ")}` : ""}`;
  }

  if (state.issueCode === "plugin_missing") {
    return `mem9 hooks remain installed, but the active mem9 plugin files are unavailable. Run \`$mem9:cleanup\`, reinstall the mem9 plugin, then run \`${setupCommand}\`.`;
  }

  if (state.issueCode === "plugin_disabled") {
    return "mem9 is disabled in the Codex plugin settings. This session will not recall or save. Re-enable the mem9 plugin to resume immediately.";
  }

  if (state.issueCode === "legacy_paused") {
    if (state.effectiveLegacyPausedSource === "project") {
      return `mem9 is paused for this repository by a legacy \`enabled = false\` override. Run \`${setupCommand}\` in this repository to migrate that paused state.`;
    }

    return `mem9 is paused globally by a legacy \`enabled = false\` config. Run \`${setupCommand}\` to migrate the global paused state.`;
  }

  if (state.issueCode === "invalid_config" && state.projectConfigMatched) {
    return `mem9 cannot read this project's override file \`.codex/mem9/config.json\`. Run \`${projectConfigCommand}\` to repair the local override, then run \`${setupCommand}\` if the global default in \`$CODEX_HOME/mem9/config.json\` also needs repair.`;
  }

  if (
    state.issueCode === "missing_config"
    || state.issueCode === "invalid_config"
  ) {
    return `mem9 is not configured yet. Run \`${setupCommand}\`. The global default needs a valid \`$CODEX_HOME/mem9/config.json\`.`;
  }

  if (
    state.issueCode === "missing_profile"
    || state.issueCode === "invalid_credentials"
  ) {
    if (state.configSource === "project") {
      return `mem9 cannot use the selected profile. Run \`${setupCommand}\` to repair the global profile set, or run \`${projectConfigCommand}\` to switch this project to another existing profile.`;
    }

    return `mem9 cannot use the selected profile. Run \`${setupCommand}\` and select an existing profile or create a new profile.`;
  }

  return `mem9 is missing an \`apiKey\` for the selected profile. Run \`${setupCommand}\` to update the global profile, edit \`$MEM9_HOME/.credentials.json\`, or set \`MEM9_API_KEY\`.`;
}

/**
 * @param {{state?: SessionStartState, setupCommand?: string}} [input]
 * @returns {Promise<string>}
 */
export async function runSessionStart(input = {}) {
  const message = buildSessionStartMessage(
    input.state ?? { configSource: "global", issueCode: "missing_config" },
    input.setupCommand,
  );
  return hookAdditionalContext("SessionStart", message);
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
  const state = loadRuntimeStateFromDisk({ cwd });
  debugContext = {
    cwd,
    codexHome: state.codexHome,
    mem9Home: state.mem9Home,
  };
  appendDebugLog({
    hook: "SessionStart",
    stage: "state_loaded",
    cwd,
    codexHome: state.codexHome,
    mem9Home: state.mem9Home,
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

  return runSessionStart({
    state: {
      configSource: /** @type {"global" | "project"} */ (state.configSource),
      projectConfigMatched: state.projectConfigMatched,
      profileId: state.runtime.profileId,
      warnings: state.warnings,
      legacyPausedSources: /** @type {("global" | "project")[]} */ (state.legacyPausedSources),
      effectiveLegacyPausedSource: state.effectiveLegacyPausedSource,
      issueCode: state.issueCode,
    },
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
        hook: "SessionStart",
        stage: "hook_failed",
        error,
        ...debugContext,
      });
    });
}
