import type { Hooks, Plugin } from "@opencode-ai/plugin";
import type { MemoryBackend } from "./backend.js";
import {
  resolveEffectiveConfig,
  resolvePluginIdentity,
} from "./config.js";
import { createDebugLogger } from "./debug.js";
import { ServerBackend } from "./server-backend.js";
import { buildPendingSetupHooks } from "./setup-flow.js";
import { buildTools } from "./tools.js";
import { buildHooks } from "./hooks.js";

function buildPluginHooksAndTools(
  backend: MemoryBackend,
  options: Parameters<typeof buildHooks>[1],
): Hooks {
  const tools = buildTools(backend);
  const hooks = buildHooks(backend, options);

  return {
    tool: tools,
    ...hooks,
  };
}

/**
 * mem9-opencode — AI agent memory plugin for OpenCode.
 */
const mem9Plugin: Plugin = async (input) => {
  const cfg = await resolveEffectiveConfig(input);
  const identity = await resolvePluginIdentity(cfg);

  if (!identity) {
    return buildPendingSetupHooks(input, cfg);
  }

  if (identity.source === "legacy_env") {
    console.info("[mem9] Using legacy MEM9_TENANT_ID as API key for compatibility.");
  }

  console.info(`[mem9] Server mode (mem9 REST API via ${identity.source})`);
  const backend = new ServerBackend(identity.baseUrl, identity.apiKey, "opencode");
  const debugLogger = createDebugLogger({
    enabled: cfg.debug === true,
    logDir: cfg.paths?.logDir,
  });

  return buildPluginHooksAndTools(backend, {
    agentID: "opencode",
    debugLogger,
  });
};

export default mem9Plugin;
