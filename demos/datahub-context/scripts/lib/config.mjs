export const DEFAULT_BASE_URL = "http://127.0.0.1:8080";
export const DEFAULT_AGENT_ID = "slack-datahub-demo";
export const DEFAULT_APP_ID = "datahub-townhall-slack";
export const DEFAULT_DEMO_TAG = "datahub-townhall-demo";
export const DEFAULT_PROMPT = "Why is the Executive Revenue dashboard wrong today?";

export function parseArgs(args = process.argv.slice(2)) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[toCamelCase(key)] = true;
      continue;
    }
    parsed[toCamelCase(key)] = next;
    index += 1;
  }
  return parsed;
}

export function readDemoConfig(overrides = {}) {
  const baseURL = normalizeBaseURL(
    overrides.baseUrl ??
      overrides.baseURL ??
      process.env.MEM9_DEMO_BASE_URL ??
      DEFAULT_BASE_URL,
  );
  const apiKey =
    overrides.apiKey ?? process.env.MEM9_DEMO_API_KEY ?? process.env.MEM9_API_KEY ?? "";
  const agentID =
    overrides.agentId ?? process.env.MEM9_DEMO_AGENT_ID ?? DEFAULT_AGENT_ID;
  const appID = overrides.appId ?? process.env.MEM9_DEMO_APP_ID ?? DEFAULT_APP_ID;
  const demoTag =
    overrides.demoTag ?? process.env.MEM9_DEMO_TAG ?? DEFAULT_DEMO_TAG;
  const prompt =
    overrides.prompt ?? process.env.MEM9_DEMO_PROMPT ?? DEFAULT_PROMPT;
  return {
    baseURL,
    apiKey,
    agentID,
    appID,
    demoTag,
    prompt,
  };
}

export function hasServerConfig(config) {
  return Boolean(config?.apiKey && config.apiKey.trim());
}

export function normalizeBaseURL(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
