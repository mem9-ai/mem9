// @ts-nocheck

import { loadRuntimeStateFromDisk } from "./config.mjs";

export function buildRuntimeIssueMessage(state) {
  if (state.issueCode === "disabled") {
    if (state.configSource === "project") {
      return "mem9 is disabled for this project. Run `$mem9:project-config --reset` to inherit the global default again, or set a project profile with `$mem9:project-config --profile <profile-id>`.";
    }

    return "mem9 is disabled globally. Run `$mem9:setup` to select a working default profile and enable mem9 again.";
  }

  if (state.issueCode === "invalid_config" && state.configSource === "project") {
    return "This project mem9 override needs repair. Run `$mem9:project-config --reset` to inherit the global default again, or rewrite it with `$mem9:project-config --profile <profile-id>`.";
  }

  if (
    state.issueCode === "missing_config"
    || state.issueCode === "invalid_config"
  ) {
    return "mem9 is not set up for this Codex user yet. Run `$mem9:setup` first.";
  }

  if (
    state.issueCode === "missing_profile"
    || state.issueCode === "invalid_credentials"
    || state.issueCode === "missing_api_key"
  ) {
    return "mem9 needs a working profile with an API key. Run `$mem9:setup` first.";
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
