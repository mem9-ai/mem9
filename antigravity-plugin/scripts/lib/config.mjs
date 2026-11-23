// @ts-check

import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { provisionMem9Space } from "./http.mjs";

export const DEFAULT_API_URL = "https://api.mem9.ai";
export const DEFAULT_AGENT_ID = "antigravity";
export const MEM9_WRITER_ID = "antigravity";
export const MAX_AGENT_ID_LENGTH = 100;
export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
export const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;
export const DEFAULT_RECALL_MIN_PROMPT_LENGTH = 5;

/**
 * @typedef {"ready" | "disabled" | "missing_config" | "invalid_config" | "invalid_credentials" | "missing_profile" | "missing_api_key"} RuntimeIssueCode
 */

/**
 * @typedef {"project" | "user" | "shared_default" | "plugin_data" | "env" | "none"} ConfigSource
 */

/**
 * @typedef {"env" | "credentials" | "plugin_data" | "none"} AuthSource
 */

/**
 * @typedef {"invalid_user_config_ignored" | "invalid_project_config_ignored" | "invalid_credentials_ignored" | "invalid_plugin_auth_ignored"} RuntimeWarningCode
 */

/**
 * @typedef {Record<string, string | undefined>} EnvMap
 */

/**
 * @typedef {{
 *   label: string,
 *   baseUrl: string,
 *   apiKey: string,
 * }} Mem9Profile
 */

/**
 * @typedef {{
 *   schemaVersion?: number,
 *   enabled?: boolean,
 *   profileId?: string,
 *   agentId?: string,
 *   defaultTimeoutMs?: number,
 *   searchTimeoutMs?: number,
 *   recallMinPromptLength?: number,
 * }} ScopeConfig
 */

/**
 * @typedef {{
 *   mem9Home: string,
 *   stateDir: string,
 *   credentialsPath: string,
 *   userConfigPath: string,
 *   projectRoot: string | null,
 *   projectConfigPath: string,
 *   pluginAuthFallbackPath: string,
 *   hookStatePath: string,
 *   noticeStatePath: string,
 *   debugLogPath: string,
 * }} RuntimePaths
 */

/**
 * @typedef {{
 *   enabled: boolean,
 *   profileId: string,
 *   baseUrl: string,
 *   apiKey: string,
 *   agentId: string,
 *   defaultTimeoutMs: number,
 *   searchTimeoutMs: number,
 *   recallMinPromptLength: number,
 * }} RuntimeConfig
 */

/**
 * @typedef {{
 *   issueCode: RuntimeIssueCode,
 *   configSource: ConfigSource,
 *   authSource: AuthSource,
 *   paths: RuntimePaths,
 *   projectRoot: string | null,
 *   warnings: RuntimeWarningCode[],
 *   profiles: Record<string, Mem9Profile>,
 *   runtime: RuntimeConfig,
 * }} RuntimeState
 */

/**
 * @typedef {{
 *   cwd?: string,
 *   mem9Home?: string,
 *   pluginDataDir?: string,
 *   env?: EnvMap,
 *   homeDir?: string,
 * }} RuntimeOptions
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeBaseUrl(value) {
  const text = normalizeString(value);
  return text ? text.replace(/\/+$/, "") : "";
}

/**
 * @param {EnvMap | undefined} env
 * @param {string} key
 * @returns {string}
 */
function envOverride(env, key) {
  return normalizeString(env?.[key]);
}

/**
 * @param {unknown} projectValue
 * @param {unknown} userValue
 * @param {number} fallback
 * @returns {number}
 */
function resolveScopedTimeout(projectValue, userValue, fallback) {
  if (typeof projectValue === "number" && Number.isFinite(projectValue) && projectValue > 0) {
    return Math.floor(projectValue);
  }
  if (typeof userValue === "number" && Number.isFinite(userValue) && userValue > 0) {
    return Math.floor(userValue);
  }
  return fallback;
}

/**
 * @param {unknown} projectValue
 * @param {unknown} userValue
 * @param {number} fallback
 * @returns {number}
 */
function resolveScopedNonNegativeInteger(projectValue, userValue, fallback) {
  if (typeof projectValue === "number" && Number.isFinite(projectValue) && projectValue >= 0) {
    return Math.floor(projectValue);
  }
  if (typeof userValue === "number" && Number.isFinite(userValue) && userValue >= 0) {
    return Math.floor(userValue);
  }
  return fallback;
}

/**
 * Resolves the shared mem9 home directory (`~/.mem9` by default).
 *
 * @param {string} [inputMem9Home]
 * @param {EnvMap} [env]
 * @param {string} [homeDir]
 * @returns {string}
 */
export function resolveMem9Home(
  inputMem9Home,
  env = process.env,
  homeDir = os.homedir(),
) {
  const input = normalizeString(inputMem9Home);
  if (input) {
    return path.resolve(input);
  }

  const fromEnv = normalizeString(env?.MEM9_HOME);
  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  const resolvedHome = normalizeString(homeDir) || os.homedir();
  return path.resolve(path.join(resolvedHome, ".mem9"));
}

/**
 * Walks up from `cwd` looking for `.git` or `.agents`; falls back to `path.resolve(cwd)`
 * when `cwd` exists on disk, or `null` otherwise.
 *
 * @param {string | null | undefined} cwd
 * @returns {string | null}
 */
export function resolveProjectRoot(cwd) {
  const trimmed = normalizeString(cwd);
  if (!trimmed) {
    return null;
  }

  const resolvedCwd = path.resolve(trimmed);
  let current = resolvedCwd;

  while (true) {
    if (
      existsSync(path.join(current, ".git"))
      || existsSync(path.join(current, ".agents"))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  if (!existsSync(resolvedCwd)) {
    return null;
  }

  try {
    return statSync(resolvedCwd).isDirectory()
      ? resolvedCwd
      : path.dirname(resolvedCwd);
  } catch {
    return null;
  }
}

/**
 * Resolves all filesystem paths used by the Antigravity mem9 runtime.
 *
 * @param {RuntimeOptions} [options]
 * @returns {RuntimePaths}
 */
export function resolveRuntimePaths({
  cwd,
  mem9Home,
  pluginDataDir,
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  const resolvedMem9Home = resolveMem9Home(mem9Home, env, homeDir);
  const stateDir = path.join(resolvedMem9Home, "antigravity");
  const effectiveCwd = cwd === undefined ? process.cwd() : cwd;
  const projectRoot = resolveProjectRoot(effectiveCwd);
  const rawPluginDataDir =
    normalizeString(pluginDataDir) || normalizeString(env?.PLUGIN_DATA);
  const resolvedPluginDataDir = rawPluginDataDir ? path.resolve(rawPluginDataDir) : "";
  const envDebugLogFile = normalizeString(env?.MEM9_DEBUG_LOG_FILE);

  return {
    mem9Home: resolvedMem9Home,
    stateDir,
    credentialsPath: path.join(resolvedMem9Home, ".credentials.json"),
    userConfigPath: path.join(stateDir, "config.json"),
    projectRoot,
    projectConfigPath: projectRoot
      ? path.join(projectRoot, ".agents", "mem9", "config.json")
      : "",
    pluginAuthFallbackPath: resolvedPluginDataDir
      ? path.join(resolvedPluginDataDir, "auth.json")
      : "",
    hookStatePath: path.join(stateDir, "hook-state.json"),
    noticeStatePath: path.join(stateDir, "runtime-notices.json"),
    debugLogPath: envDebugLogFile
      ? path.resolve(envDebugLogFile)
      : path.join(stateDir, "logs", "hooks.jsonl"),
  };
}

/**
 * Normalizes an agent identifier to 1..100 Unicode code points without control chars.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAgentId(value) {
  const agentId = normalizeString(value);
  if (
    !agentId
    || [...agentId].length > MAX_AGENT_ID_LENGTH
    || /\p{Cc}/u.test(agentId)
  ) {
    return "";
  }

  return agentId;
}

/**
 * Returns a redacted preview of an API key, never exposing the full key.
 *
 * @param {unknown} apiKey
 * @returns {string}
 */
export function redactApiKeyPreview(apiKey) {
  const key = normalizeString(apiKey);
  if (!key) {
    return "";
  }
  if (key.length >= 12) {
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }
  return "saved";
}

/**
 * Atomically writes JSON to `filePath` via a unique temp file in the same directory.
 *
 * @param {string} filePath
 * @param {unknown} data
 * @param {{ mode?: number }} [options]
 */
export function writeJsonAtomic(filePath, data, { mode = 0o600 } = {}) {
  const resolvedPath = path.resolve(filePath);
  const dir = path.dirname(resolvedPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const tempPath = path.join(
    dir,
    `.${path.basename(resolvedPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const serialized = `${JSON.stringify(data, null, 2)}\n`;

  try {
    writeFileSync(tempPath, serialized, { encoding: "utf8", mode });
    try {
      chmodSync(tempPath, mode);
    } catch {
      // Best-effort on filesystems without POSIX chmod support.
    }
    renameSync(tempPath, resolvedPath);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore temp cleanup failures.
    }
    throw error;
  }
}

/**
 * @param {string} filePath
 * @returns {{ status: "missing" | "valid" | "invalid", config: ScopeConfig | null }}
 */
function loadScopeConfigFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { status: "missing", config: null };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!isRecord(parsed)) {
      return { status: "invalid", config: null };
    }
    return { status: "valid", config: /** @type {ScopeConfig} */ (parsed) };
  } catch {
    return { status: "invalid", config: null };
  }
}

/**
 * @param {string} filePath
 * @returns {{ status: "missing" | "valid" | "invalid", profiles: Record<string, Mem9Profile> }}
 */
function loadCredentialsFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { status: "missing", profiles: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!isRecord(parsed) || (parsed.profiles !== undefined && !isRecord(parsed.profiles))) {
      return { status: "invalid", profiles: {} };
    }

    /** @type {Record<string, Mem9Profile>} */
    const profiles = {};
    const rawProfiles = isRecord(parsed.profiles) ? parsed.profiles : {};
    for (const [id, rawProfile] of Object.entries(rawProfiles)) {
      if (!isRecord(rawProfile)) {
        return { status: "invalid", profiles: {} };
      }
      profiles[id] = {
        label: normalizeString(rawProfile.label),
        baseUrl: normalizeBaseUrl(rawProfile.baseUrl),
        apiKey: normalizeString(rawProfile.apiKey),
      };
    }

    return { status: "valid", profiles };
  } catch {
    return { status: "invalid", profiles: {} };
  }
}

/**
 * @param {string} filePath
 * @returns {{ status: "missing" | "valid" | "invalid", baseUrl: string, apiKey: string }}
 */
function loadPluginAuthFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { status: "missing", baseUrl: "", apiKey: "" };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!isRecord(parsed)) {
      return { status: "invalid", baseUrl: "", apiKey: "" };
    }

    return {
      status: "valid",
      baseUrl: normalizeBaseUrl(parsed.base_url ?? parsed.baseUrl),
      apiKey: normalizeString(parsed.api_key ?? parsed.apiKey),
    };
  } catch {
    return { status: "invalid", baseUrl: "", apiKey: "" };
  }
}

/**
 * Loads the effective Antigravity mem9 runtime state from env, project/user scopes,
 * shared credentials, and optional `PLUGIN_DATA/auth.json`.
 *
 * @param {RuntimeOptions} [options]
 * @returns {RuntimeState}
 */
export function loadRuntimeState(options = {}) {
  const env = options.env ?? process.env;
  const paths = resolveRuntimePaths(options);
  const userLoad = loadScopeConfigFile(paths.userConfigPath);
  const projectLoad = loadScopeConfigFile(paths.projectConfigPath);
  const credentialsLoad = loadCredentialsFile(paths.credentialsPath);
  const pluginAuthLoad = loadPluginAuthFile(paths.pluginAuthFallbackPath);

  const userConfig = userLoad.status === "valid" ? userLoad.config : null;
  const projectConfig = projectLoad.status === "valid" ? projectLoad.config : null;
  const profiles = credentialsLoad.profiles;

  const envApiKey = envOverride(env, "MEM9_API_KEY");
  const envBaseUrl = normalizeBaseUrl(envOverride(env, "MEM9_API_URL"));
  const projectProfileId = normalizeString(projectConfig?.profileId);
  const userProfileId = normalizeString(userConfig?.profileId);
  const scopedProfileId = projectProfileId || userProfileId;

  /** @type {RuntimeWarningCode[]} */
  const warnings = [];
  if (projectLoad.status === "invalid" && (userConfig != null || Boolean(envApiKey))) {
    warnings.push("invalid_project_config_ignored");
  }
  if (
    userLoad.status === "invalid"
    && ((projectConfig != null && Boolean(projectProfileId)) || Boolean(envApiKey))
  ) {
    warnings.push("invalid_user_config_ignored");
  }
  if (credentialsLoad.status === "invalid" && Boolean(envApiKey)) {
    warnings.push("invalid_credentials_ignored");
  }
  if (pluginAuthLoad.status === "invalid") {
    warnings.push("invalid_plugin_auth_ignored");
  }

  const enabled =
    typeof projectConfig?.enabled === "boolean"
      ? projectConfig.enabled
      : typeof userConfig?.enabled === "boolean"
        ? userConfig.enabled
        : true;
  const agentId =
    normalizeAgentId(env?.MEM9_AGENT_ID)
    || normalizeAgentId(projectConfig?.agentId)
    || normalizeAgentId(userConfig?.agentId)
    || DEFAULT_AGENT_ID;
  const defaultTimeoutMs = resolveScopedTimeout(
    projectConfig?.defaultTimeoutMs,
    userConfig?.defaultTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const searchTimeoutMs = resolveScopedTimeout(
    projectConfig?.searchTimeoutMs,
    userConfig?.searchTimeoutMs,
    DEFAULT_SEARCH_TIMEOUT_MS,
  );
  const recallMinPromptLength = resolveScopedNonNegativeInteger(
    projectConfig?.recallMinPromptLength,
    userConfig?.recallMinPromptLength,
    DEFAULT_RECALL_MIN_PROMPT_LENGTH,
  );

  /** @type {"project" | "user" | null} */
  const scopedConfigSource = projectConfig != null
    ? "project"
    : userConfig != null
      ? "user"
      : null;

  const hasInvalidConfigIssue =
    (userLoad.status === "invalid" && !(projectConfig != null && Boolean(projectProfileId)))
    || (projectLoad.status === "invalid" && userConfig == null);

  /** @type {RuntimeIssueCode} */
  let issueCode = "missing_config";
  /** @type {ConfigSource} */
  let configSource = "none";
  /** @type {AuthSource} */
  let authSource = "none";
  let profileId = scopedProfileId;
  let apiKey = "";
  let baseUrl = envBaseUrl || DEFAULT_API_URL;

  if (envApiKey) {
    const matchedProfileId =
      scopedProfileId || (Object.hasOwn(profiles, "default") ? "default" : "");
    const matchedProfile = matchedProfileId ? profiles[matchedProfileId] : undefined;
    profileId = scopedProfileId || matchedProfileId;
    apiKey = envApiKey;
    baseUrl = envBaseUrl || matchedProfile?.baseUrl || DEFAULT_API_URL;
    authSource = "env";
    configSource = scopedConfigSource ?? (matchedProfile ? "shared_default" : "env");
    issueCode = enabled ? "ready" : "disabled";
  } else if (!enabled) {
    issueCode = "disabled";
    configSource = scopedConfigSource ?? "user";
    authSource = "none";
  } else if (hasInvalidConfigIssue) {
    issueCode = "invalid_config";
    configSource = projectLoad.status === "invalid" ? "project" : "user";
    authSource = "none";
  } else if (credentialsLoad.status === "invalid") {
    issueCode = "invalid_credentials";
    configSource = scopedConfigSource ?? "shared_default";
    authSource = "none";
  } else if (scopedConfigSource != null) {
    configSource = scopedConfigSource;
    const selectedProfile = profileId ? profiles[profileId] : undefined;
    if (!profileId || !selectedProfile) {
      issueCode = "missing_profile";
      authSource = "none";
    } else if (!selectedProfile.apiKey) {
      issueCode = "missing_api_key";
      authSource = "none";
      baseUrl = envBaseUrl || selectedProfile.baseUrl || DEFAULT_API_URL;
    } else {
      issueCode = "ready";
      authSource = "credentials";
      apiKey = selectedProfile.apiKey;
      baseUrl = envBaseUrl || selectedProfile.baseUrl || DEFAULT_API_URL;
    }
  } else if (profiles.default?.apiKey) {
    configSource = "shared_default";
    authSource = "credentials";
    issueCode = "ready";
    profileId = "default";
    apiKey = profiles.default.apiKey;
    baseUrl = envBaseUrl || profiles.default.baseUrl || DEFAULT_API_URL;
  } else if (pluginAuthLoad.status === "valid" && pluginAuthLoad.apiKey) {
    configSource = "plugin_data";
    authSource = "plugin_data";
    issueCode = "ready";
    profileId = "";
    apiKey = pluginAuthLoad.apiKey;
    baseUrl = envBaseUrl || pluginAuthLoad.baseUrl || DEFAULT_API_URL;
  } else if (pluginAuthLoad.status === "valid") {
    configSource = "plugin_data";
    authSource = "none";
    issueCode = "missing_api_key";
    profileId = "";
    baseUrl = envBaseUrl || pluginAuthLoad.baseUrl || DEFAULT_API_URL;
  }

  return {
    issueCode,
    configSource,
    authSource,
    paths,
    projectRoot: paths.projectRoot,
    warnings,
    profiles,
    runtime: {
      enabled,
      profileId,
      baseUrl,
      apiKey,
      agentId,
      defaultTimeoutMs,
      searchTimeoutMs,
      recallMinPromptLength,
    },
  };
}

/**
 * Provisions a default mem9 profile and writes user config if missing.
 * Returns `null` when `MEM9_AUTO_PROVISION` disables automatic provisioning.
 *
 * @param {RuntimeOptions & {
 *   provisionFn?: (baseUrl: string) => Promise<{ apiKey?: string, api_key?: string, id?: string, baseUrl?: string, base_url?: string } | string>,
 * }} [options]
 * @returns {Promise<RuntimeState | null>}
 */
export async function autoProvisionDefaultProfile({
  cwd,
  mem9Home,
  pluginDataDir,
  env = process.env,
  homeDir = os.homedir(),
  provisionFn,
} = {}) {
  if (/^(0|false|no|off)$/i.test(String(env?.MEM9_AUTO_PROVISION ?? "").trim())) {
    return null;
  }

  const initialState = loadRuntimeState({
    cwd,
    mem9Home,
    pluginDataDir,
    env,
    homeDir,
  });
  if (initialState.issueCode === "ready") {
    return initialState;
  }
  if (initialState.issueCode !== "missing_config") {
    return null;
  }

  const targetBaseUrl =
    normalizeBaseUrl(envOverride(env, "MEM9_API_URL"))
    || normalizeBaseUrl(initialState.runtime.baseUrl)
    || DEFAULT_API_URL;

  const provisioned = provisionFn
    ? await provisionFn(targetBaseUrl)
    : await provisionMem9Space(targetBaseUrl);

  let apiKey = "";
  let finalBaseUrl = targetBaseUrl;
  if (typeof provisioned === "string") {
    apiKey = provisioned.trim();
  } else if (isRecord(provisioned)) {
    apiKey =
      normalizeString(provisioned.apiKey)
      || normalizeString(provisioned.api_key)
      || normalizeString(provisioned.id);
    finalBaseUrl =
      normalizeBaseUrl(provisioned.baseUrl ?? provisioned.base_url) || targetBaseUrl;
  }

  if (!apiKey) {
    throw new Error("mem9 auto-provisioning did not return an API key");
  }

  const { credentialsPath, userConfigPath } = initialState.paths;
  /** @type {{ schemaVersion: number, profiles: Record<string, Mem9Profile>, [key: string]: unknown }} */
  let credentialsData = {
    schemaVersion: 1,
    profiles: {},
  };

  if (existsSync(credentialsPath)) {
    const parsed = JSON.parse(readFileSync(credentialsPath, "utf8"));
    if (!isRecord(parsed) || (parsed.profiles !== undefined && !isRecord(parsed.profiles))) {
      throw new Error("Refusing to overwrite invalid credentials file during auto-provision");
    }
    credentialsData = {
      ...parsed,
      schemaVersion: 1,
      profiles: isRecord(parsed.profiles)
        ? /** @type {Record<string, Mem9Profile>} */ ({ ...parsed.profiles })
        : {},
    };
  }

  const existingDefault = isRecord(credentialsData.profiles.default)
    ? credentialsData.profiles.default
    : null;
  if (!normalizeString(existingDefault?.apiKey)) {
    credentialsData.profiles.default = {
      label: normalizeString(existingDefault?.label) || "Default",
      baseUrl: finalBaseUrl,
      apiKey,
    };
    writeJsonAtomic(credentialsPath, credentialsData, { mode: 0o600 });
  }

  if (!existsSync(userConfigPath)) {
    writeJsonAtomic(
      userConfigPath,
      {
        schemaVersion: 1,
        profileId: "default",
        defaultTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
        searchTimeoutMs: DEFAULT_SEARCH_TIMEOUT_MS,
        recallMinPromptLength: DEFAULT_RECALL_MIN_PROMPT_LENGTH,
      },
      { mode: 0o600 },
    );
  }

  return loadRuntimeState({
    cwd,
    mem9Home,
    pluginDataDir,
    env,
    homeDir,
  });
}
