import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig, DEFAULT_API_URL } from "./types.js";
import { ServerBackend } from "./server-backend.js";
import { buildTools } from "./tools.js";
import { buildHooks } from "./hooks.js";

/**
 * mem9-opencode — AI agent memory plugin for OpenCode.
 *
 * Connects to mem9 API (default: https://api.mem9.ai).
 * Requires MEM9_TENANT_ID.
 */
const mem9Plugin: Plugin = async (_input) => {
  const cfg = loadConfig();

  const effectiveApiUrl = cfg.apiUrl ?? DEFAULT_API_URL;
  if (!cfg.apiUrl) {
    console.info(
      `[mem9] No MEM9_API_URL configured, using default ${DEFAULT_API_URL}`
    );
  }

  if (!cfg.tenantID) {
    console.warn(
      "[mem9] No MEM9_TENANT_ID configured. Plugin disabled. Set MEM9_TENANT_ID to enable."
    );
    return {};
  }

  console.info("[mem9] Server mode (mem9 REST API)");
  const backend = new ServerBackend(effectiveApiUrl, cfg.tenantID);

  const tools = buildTools(backend);
  const hooks = buildHooks(backend);

  return {
    tool: tools,
    ...hooks,
  };
};

export default mem9Plugin;
