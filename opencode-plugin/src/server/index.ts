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
import { createSessionTranscriptLoader } from "./session-transcript.js";
import { PLUGIN_ID } from "../shared/plugin-meta.js";

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

const mem9Plugin: Plugin = async (input) => {
  const cfg = await resolveEffectiveConfig(input);
  const debugLogger = createDebugLogger({
    enabled: cfg.debug === true,
    logDir: cfg.paths?.logDir,
  });
  const identity = await resolvePluginIdentity(cfg);

  if (!identity) {
    await debugLogger("plugin.pending_setup", {
      profileId: cfg.profileId,
      debug: cfg.debug === true,
      defaultTimeoutMs: cfg.defaultTimeoutMs,
      searchTimeoutMs: cfg.searchTimeoutMs,
    });
    return buildPendingSetupHooks(input, cfg);
  }

  if (identity.source === "legacy_env") {
    console.info("[mem9] Using legacy MEM9_TENANT_ID as API key for compatibility.");
  }

  console.info(`[mem9] Server mode (mem9 REST API via ${identity.source})`);
  const backend = new ServerBackend(identity.baseUrl, identity.apiKey, "opencode", {
    defaultTimeoutMs: cfg.defaultTimeoutMs,
    searchTimeoutMs: cfg.searchTimeoutMs,
  });
  await debugLogger("plugin.ready", {
    identitySource: identity.source,
    profileId: cfg.profileId,
    debug: cfg.debug === true,
    defaultTimeoutMs: cfg.defaultTimeoutMs,
    searchTimeoutMs: cfg.searchTimeoutMs,
  });

  return buildPluginHooksAndTools(backend, {
    agentID: "opencode",
    debugLogger,
    loadSessionTranscript: createSessionTranscriptLoader(input.client),
  });
};

export default {
  id: PLUGIN_ID,
  server: mem9Plugin,
};
