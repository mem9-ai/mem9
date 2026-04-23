// @ts-nocheck

import { loadRuntimeStateFromDisk } from "./config.mjs";

function legacyPausedSource(state) {
  if (state.effectiveLegacyPausedSource === "project") {
    return "project";
  }

  if (state.effectiveLegacyPausedSource === "global") {
    return "global";
  }

  return state.configSource === "project" ? "project" : "global";
}

export function buildRuntimeIssueMessage(state) {
  if (state.issueCode === "plugin_missing") {
    return "mem9 hooks remain installed, but the mem9 hook runtime needs repair. If `mem9` is missing from `/plugins`, reinstall the plugin first. Then run `$mem9:cleanup`, followed by `$mem9:setup`.";
  }

  if (state.issueCode === "plugin_disabled") {
    return "mem9 is disabled in the Codex plugin settings. Re-enable the mem9 plugin there, then rerun this command.";
  }

  if (
    state.issueCode === "legacy_paused"
    || state.issueCode === "disabled"
  ) {
    if (legacyPausedSource(state) === "project") {
      return "mem9 is paused for this repository by a legacy `enabled = false` override. Run `$mem9:setup` in this repository to migrate that paused state.";
    }

    return "mem9 is paused globally by a legacy `enabled = false` config. Run `$mem9:setup` to migrate the global paused state.";
  }

  if (state.issueCode === "missing_config") {
    return "mem9 is not set up for this Codex user yet. Run `$mem9:setup` first.";
  }

  if (state.issueCode === "invalid_config") {
    if (state.projectConfigMatched) {
      return "mem9 cannot read this repository's saved config in `.codex/mem9/config.json`. Repair or remove that file, then run `$mem9:setup` to restore a working configuration.";
    }

    return "mem9 cannot read the global config in `$CODEX_HOME/mem9/config.json`. Run `$mem9:setup` to rewrite it.";
  }

  if (state.issueCode === "invalid_credentials") {
    return "mem9 cannot read the saved profiles in `$MEM9_HOME/.credentials.json`. Run `$mem9:setup` to repair the global profile set.";
  }

  if (state.issueCode === "missing_profile") {
    return "mem9 cannot use the selected profile. Run `$mem9:setup` to select an existing profile or create a new profile.";
  }

  if (
    state.issueCode === "missing_api_key"
  ) {
    return "mem9 is missing an `apiKey` for the selected profile. Run `$mem9:setup` to update the global profile, edit `$MEM9_HOME/.credentials.json`, or set `MEM9_API_KEY`.";
  }

  return `mem9 runtime is not ready: ${state.issueCode}`;
}

export function loadReadyRuntimeState(options = {}) {
  const state = loadRuntimeStateFromDisk(options);

  if (state.issueCode !== "ready") {
    throw new Error(buildRuntimeIssueMessage(state));
  }

  return state;
}
