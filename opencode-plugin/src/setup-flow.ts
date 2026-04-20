import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import type { EffectiveConfig } from "./config.js";

export function buildPendingSetupHooks(
  _input: PluginInput,
  config: EffectiveConfig,
): Hooks {
  const target = config.profileId
    ? `profile "${config.profileId}"`
    : "a mem9 profile";

  console.warn(
    `[mem9] Setup pending. Configure MEM9_API_KEY or add credentials for ${target} to enable mem9.`,
  );

  return {};
}
