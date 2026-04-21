// @ts-check

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { loadRuntimeStateFromDisk } from "./shared/config.mjs";
import { appendDebugError, appendDebugLog } from "./shared/debug.mjs";
import { hookAdditionalContext } from "./shared/format.mjs";

/** @type {{cwd?: string, codexHome?: string, mem9Home?: string}} */
let debugContext = {};

/**
 * @typedef {{
 *   configSource: "global" | "project",
 *   projectConfigMatched?: boolean,
 *   profileId?: string,
 *   issueCode: "ready" | "disabled" | "missing_config" | "invalid_config" | "missing_profile" | "invalid_credentials" | "missing_api_key",
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
    if (state.configSource === "project") {
      return `mem9 is ready. This session uses the local override in \`.codex/mem9/config.json\` with ${profileText}. It will recall on user prompt submit and save a recent conversation window on stop.`;
    }

    return `mem9 is ready. This session uses the global default config with ${profileText}. It will recall on user prompt submit and save a recent conversation window on stop.`;
  }

  if (state.issueCode === "disabled") {
    if (state.configSource === "project") {
      return `mem9 is disabled for this project. This session will not recall or save. Run \`${projectConfigCommand} --reset\` to inherit the global default again.`;
    }

    return `mem9 is disabled globally. This session will not recall or save. Run \`${setupCommand}\` to select a working default profile and enable mem9 again.`;
  }

  if (state.issueCode === "invalid_config" && state.configSource === "project") {
    return `mem9 cannot read this project's override file \`.codex/mem9/config.json\`. Run \`${projectConfigCommand}\` to repair it, or \`${projectConfigCommand} --reset\` to return to the global default.`;
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
      issueCode: state.issueCode,
    },
  });

  return runSessionStart({
    state,
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
