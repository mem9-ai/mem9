// @ts-nocheck

import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveProjectRoot } from "./project-root.mjs";
import {
  normalizeUpdateCheckConfig,
  resolveUpdateStatePath,
} from "./update-check.mjs";

export const DEFAULT_AGENT_ID = "codex";
export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
export const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;

const DEFAULT_API_URL = "https://api.mem9.ai";
const DEFAULT_PLUGIN_ID = "mem9@mem9-ai";
const DEFAULT_PLUGIN_INSTALL_IDENTITY = {
  marketplaceName: "mem9-ai",
  pluginName: "mem9",
};
const DEFAULT_PLUGIN_VERSION = "local";
const PLUGINS_CACHE_DIR = path.join("plugins", "cache");

/**
 * @typedef {"global" | "project"} ConfigSource
 */

/**
 * @typedef {"project" | "user"} RuntimeScope
 */

/**
 * @typedef {"ready" | "plugin_disabled" | "plugin_missing" | "legacy_paused" | "missing_config" | "invalid_config" | "invalid_credentials" | "missing_profile" | "missing_api_key"} RuntimeIssueCode
 */

/**
 * @typedef {"invalid_global_config_ignored" | "invalid_project_config_ignored"} RuntimeWarningCode
 */

/**
 * @typedef {"global" | "project"} LegacyPausedSource
 */

/**
 * @typedef {"enabled" | "plugin_disabled" | "plugin_missing"} PluginState
 */

/**
 * @typedef {"missing_install_metadata" | "invalid_install_metadata" | "missing_active_plugin_root"} PluginIssueDetail
 */

/**
 * @typedef {Record<string, string | undefined>} EnvMap
 */

/**
 * @typedef {{
 *   label?: string,
 *   baseUrl?: string,
 *   apiKey?: string,
 * }} Mem9Profile
 */

/**
 * @typedef {{
 *   enabled?: boolean,
 *   intervalHours?: number,
 * }} UpdateCheckConfig
 */

/**
 * @typedef {{
 *   schemaVersion?: number,
 *   profiles?: Record<string, Mem9Profile>,
 * }} CredentialsFile
 */

/**
 * @typedef {{
 *   schemaVersion?: number,
 *   enabled?: boolean,
 *   profileId?: string,
 *   defaultTimeoutMs?: number,
 *   searchTimeoutMs?: number,
 *   updateCheck?: UpdateCheckConfig,
 * }} ScopeConfig
 */

/**
 * @typedef {{
 *   scope: RuntimeScope,
 *   enabled: boolean,
 *   profileId: string,
 *   baseUrl: string,
 *   apiKey: string,
 *   agentId: string,
 *   defaultTimeoutMs: number,
 *   searchTimeoutMs: number,
 *   updateCheck: { enabled: boolean, intervalHours: number },
 * }} RuntimeConfig
 */

/**
 * @typedef {{
 *   scope?: RuntimeScope,
 *   config: unknown,
 *   credentials: unknown,
 *   env?: EnvMap,
 * }} ResolveRuntimeConfigInput
 */

/**
 * @typedef {{
 *   cwd?: string,
 *   codexHome?: string,
 *   mem9Home?: string,
 *   homeDir?: string,
 *   env?: EnvMap,
 *   exists?: (filePath: string) => boolean,
 *   readJson?: (filePath: string) => unknown,
 *   readText?: (filePath: string) => string,
 *   readDirNames?: (dirPath: string) => string[],
 * }} RuntimeDiskInput
 */

/**
 * @typedef {{
 *   scope: RuntimeScope,
 *   cwd: string,
 *   codexHome: string,
 *   mem9Home: string,
 *   projectRoot: string | null,
 *   configSource: ConfigSource,
 *   projectConfigMatched: boolean,
 *   globalConfigPath: string,
 *   userConfigPath: string,
 *   projectConfigPath: string,
 *   credentialsPath: string,
 *   configTomlPath: string,
 *   installPath: string,
 *   statePath: string,
 *   configPath: string,
  *   globalConfigExists: boolean,
  *   userConfigExists: boolean,
  *   projectConfigExists: boolean,
  *   config: ScopeConfig | null,
 *   credentials: CredentialsFile | null,
  *   runtime: RuntimeConfig,
  *   pluginState: PluginState,
  *   pluginIssueDetail: PluginIssueDetail | null,
 *   pluginVersion: string,
  *   warnings: RuntimeWarningCode[],
  *   legacyPausedSources: LegacyPausedSource[],
  *   effectiveLegacyPausedSource: LegacyPausedSource | null,
  *   issueCode: RuntimeIssueCode,
 * }} RuntimeState
 */

/**
 * @typedef {{
 *   status: "missing" | "valid" | "invalid",
 *   exists: boolean,
 *   config: ScopeConfig | null,
 * }} ScopeConfigLoadResult
 */

/**
 * @typedef {{
 *   state: PluginState,
 *   issueDetail: PluginIssueDetail | null,
 *   pluginVersion: string,
 * }} PluginStateResult
 */

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readTextFile(filePath) {
  return readFileSync(filePath, "utf8");
}

function readDirNamesFromDisk(dirPath) {
  return readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function envOverride(env, key) {
  const value = env?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeTimeoutMs(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function resolveHomePath(inputPath, envPath, fallbackPath) {
  if (typeof inputPath === "string" && inputPath.trim()) {
    return path.resolve(inputPath.trim());
  }

  if (typeof envPath === "string" && envPath.trim()) {
    return path.resolve(envPath.trim());
  }

  return path.resolve(fallbackPath);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProfileId(value) {
  return normalizeString(value);
}

function isValidPluginVersionSegment(pluginVersion) {
  return pluginVersion.length > 0
    && pluginVersion !== "."
    && pluginVersion !== ".."
    && [...pluginVersion].every((ch) =>
      /[A-Za-z0-9._+-]/.test(ch),
    );
}

function runtimePaths(projectRoot, codexHome, mem9Home) {
  const globalConfigPath = path.join(codexHome, "mem9", "config.json");

  return {
    globalConfigPath,
    userConfigPath: globalConfigPath,
    projectConfigPath: projectRoot
      ? path.join(projectRoot, ".codex", "mem9", "config.json")
      : "",
    credentialsPath: path.join(mem9Home, ".credentials.json"),
    configTomlPath: path.join(codexHome, "config.toml"),
    installPath: path.join(codexHome, "mem9", "install.json"),
    statePath: resolveUpdateStatePath(codexHome),
  };
}

function asScopeConfig(value) {
  return isRecord(value) ? /** @type {ScopeConfig} */ (value) : {};
}

function asCredentialsFile(value) {
  return isRecord(value) ? /** @type {CredentialsFile} */ (value) : {};
}

function resolveScopedProfileId(globalConfig, projectConfig) {
  return normalizeProfileId(projectConfig?.profileId)
    || normalizeProfileId(globalConfig?.profileId);
}

function resolveScopedTimeout(projectValue, globalValue, fallback) {
  if (
    typeof projectValue === "number"
    && Number.isFinite(projectValue)
    && projectValue > 0
  ) {
    return Math.floor(projectValue);
  }

  if (
    typeof globalValue === "number"
    && Number.isFinite(globalValue)
    && globalValue > 0
  ) {
    return Math.floor(globalValue);
  }

  return fallback;
}

function resolveScopedEnabled(globalConfig, projectConfig) {
  if (projectConfig != null) {
    return projectConfig.enabled !== false;
  }

  return globalConfig?.enabled !== false;
}

function buildEffectiveScopeConfig(globalConfig, projectConfig) {
  if (globalConfig == null && projectConfig == null) {
    return null;
  }

  return {
    schemaVersion: 1,
    enabled: resolveScopedEnabled(globalConfig, projectConfig),
    profileId: resolveScopedProfileId(globalConfig, projectConfig),
    defaultTimeoutMs: resolveScopedTimeout(
      projectConfig?.defaultTimeoutMs,
      globalConfig?.defaultTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    searchTimeoutMs: resolveScopedTimeout(
      projectConfig?.searchTimeoutMs,
      globalConfig?.searchTimeoutMs,
      DEFAULT_SEARCH_TIMEOUT_MS,
    ),
    updateCheck: normalizeUpdateCheckConfig(globalConfig?.updateCheck),
  };
}

function resolveConfigSource(globalLoad, projectLoad) {
  if (projectLoad.status === "valid") {
    return "project";
  }

  return "global";
}

function resolveScopeFromConfigSource(configSource) {
  return configSource === "project" ? "project" : "user";
}

function loadScopeConfigFile(filePath, exists, readJson) {
  if (!filePath || !exists(filePath)) {
    return {
      status: "missing",
      exists: false,
      config: null,
    };
  }

  try {
    return {
      status: "valid",
      exists: true,
      config: asScopeConfig(readJson(filePath)),
    };
  } catch {
    return {
      status: "invalid",
      exists: true,
      config: null,
    };
  }
}

function stripTomlLineComment(line) {
  const text = String(line ?? "");
  let quotedBy = "";
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];

    if (quotedBy) {
      if (quotedBy === "\"" && ch === "\\" && !escaped) {
        escaped = true;
        continue;
      }

      if (ch === quotedBy && !escaped) {
        quotedBy = "";
      }

      escaped = false;
      continue;
    }

    if (ch === "\"" || ch === "'") {
      quotedBy = ch;
      escaped = false;
      continue;
    }

    if (ch === "#") {
      return text.slice(0, index);
    }
  }

  return text;
}

function parseTomlTableHeader(line) {
  const normalized = stripTomlLineComment(line).trim();
  return /^\[[^\]]+\]$/.test(normalized) ? normalized : "";
}

function parsePluginEnabledState(configTomlText, pluginId = DEFAULT_PLUGIN_ID) {
  const text = String(configTomlText ?? "");
  const lines = text.split(/\r?\n/);
  const pluginTableHeaders = new Set([
    `[plugins."${pluginId}"]`,
    `[plugins.'${pluginId}']`,
  ]);
  let inPluginSection = false;

  for (const line of lines) {
    const header = parseTomlTableHeader(line);
    if (header) {
      if (pluginTableHeaders.has(header)) {
        inPluginSection = true;
        continue;
      }

      if (inPluginSection) {
        break;
      }

      continue;
    }

    if (!inPluginSection) {
      continue;
    }

    const match = stripTomlLineComment(line).match(/^\s*enabled\s*=\s*(true|false)\s*$/i);
    if (match) {
      return match[1].toLowerCase() !== "false";
    }
  }

  return true;
}

function loadPluginState({
  codexHome,
  configTomlPath,
  installPath,
  exists,
  readJson,
  readText,
  readDirNames,
}) {
  let pluginEnabled = true;
  if (exists(configTomlPath)) {
    try {
      pluginEnabled = parsePluginEnabledState(readText(configTomlPath));
    } catch {
      pluginEnabled = true;
    }
  }

  let installIssue = /** @type {PluginIssueDetail | null} */ (null);
  let installIdentity = DEFAULT_PLUGIN_INSTALL_IDENTITY;

  if (!exists(installPath)) {
    installIssue = "missing_install_metadata";
  } else {
    try {
      const raw = readJson(installPath);
      const install = isRecord(raw) ? raw : {};
      const marketplaceName = normalizeString(install.marketplaceName);
      const pluginName = normalizeString(install.pluginName);

      if (!marketplaceName || !pluginName) {
        installIssue = "invalid_install_metadata";
      } else {
        installIdentity = {
          marketplaceName,
          pluginName,
        };
      }
    } catch {
      installIssue = "invalid_install_metadata";
    }
  }

  let pluginVersion = "";
  try {
    const discoveredVersions = readDirNames(
      path.join(
        codexHome,
        PLUGINS_CACHE_DIR,
        installIdentity.marketplaceName,
        installIdentity.pluginName,
      ),
    ).filter(isValidPluginVersionSegment);

    discoveredVersions.sort();
    if (discoveredVersions.includes(DEFAULT_PLUGIN_VERSION)) {
      pluginVersion = DEFAULT_PLUGIN_VERSION;
    } else {
      pluginVersion = discoveredVersions.at(-1) ?? "";
    }
  } catch {
    pluginVersion = "";
  }

  if (installIssue || !pluginVersion) {
    return {
      state: "plugin_missing",
      issueDetail: installIssue ?? "missing_active_plugin_root",
      pluginVersion,
    };
  }

  if (!pluginEnabled) {
    return {
      state: "plugin_disabled",
      issueDetail: null,
      pluginVersion,
    };
  }

  return {
    state: "enabled",
    issueDetail: null,
    pluginVersion,
  };
}

function resolveLegacyPausedState(globalConfig, projectConfig) {
  const globalPaused = globalConfig?.enabled === false;
  const projectPaused = projectConfig?.enabled === false;

  if (projectPaused) {
    return {
      legacyPausedSources: globalPaused ? ["global", "project"] : ["project"],
      effectiveLegacyPausedSource: /** @type {LegacyPausedSource} */ ("project"),
    };
  }

  if (globalPaused && projectConfig == null) {
    return {
      legacyPausedSources: ["global"],
      effectiveLegacyPausedSource: /** @type {LegacyPausedSource} */ ("global"),
    };
  }

  return {
    legacyPausedSources: [],
    effectiveLegacyPausedSource: /** @type {LegacyPausedSource | null} */ (null),
  };
}

function resolveConfigIssue(globalLoad, projectLoad) {
  const globalConfig = globalLoad.status === "valid" ? globalLoad.config : null;
  const projectConfig = projectLoad.status === "valid" ? projectLoad.config : null;
  const projectProfileId = normalizeProfileId(projectConfig?.profileId);

  if (globalLoad.status === "missing" && projectLoad.status === "missing") {
    return "missing_config";
  }

  if (
    globalLoad.status === "invalid"
    && !(projectConfig && projectProfileId)
  ) {
    return "invalid_config";
  }

  if (projectLoad.status === "invalid" && !globalConfig) {
    return "invalid_config";
  }

  if (!globalConfig && !projectConfig) {
    return globalLoad.status === "missing" && projectLoad.status === "missing"
      ? "missing_config"
      : "invalid_config";
  }

  return null;
}

function resolveWarnings(globalLoad, projectLoad) {
  /** @type {RuntimeWarningCode[]} */
  const warnings = [];
  const projectConfig = projectLoad.status === "valid" ? projectLoad.config : null;
  const projectProfileId = normalizeProfileId(projectConfig?.profileId);

  if (globalLoad.status === "invalid" && projectConfig && projectProfileId) {
    warnings.push("invalid_global_config_ignored");
  }

  if (projectLoad.status === "invalid" && globalLoad.status === "valid") {
    warnings.push("invalid_project_config_ignored");
  }

  return warnings;
}

export function resolveCodexHome(inputCodexHome, env, homeDir = os.homedir()) {
  return resolveHomePath(
    inputCodexHome,
    env?.CODEX_HOME,
    path.join(homeDir, ".codex"),
  );
}

export function resolveMem9Home(inputMem9Home, env, homeDir = os.homedir()) {
  return resolveHomePath(
    inputMem9Home,
    env?.MEM9_HOME,
    path.join(homeDir, ".mem9"),
  );
}

export function resolveRuntimeConfig(input) {
  const config = asScopeConfig(input.config);
  const credentials = asCredentialsFile(input.credentials);
  const profileId = normalizeProfileId(config.profileId);
  const profiles = isRecord(credentials.profiles)
    ? /** @type {Record<string, Mem9Profile>} */ (credentials.profiles)
    : {};
  const profile = isRecord(profiles[profileId])
    ? /** @type {Mem9Profile} */ (profiles[profileId])
    : {};
  const baseUrl =
    envOverride(input.env, "MEM9_API_URL")
    || (typeof profile.baseUrl === "string" && profile.baseUrl.trim()
      ? profile.baseUrl.trim()
      : DEFAULT_API_URL);
  const apiKey =
    envOverride(input.env, "MEM9_API_KEY")
    || (typeof profile.apiKey === "string" ? profile.apiKey : "");

  return {
    scope: input.scope === "project" ? "project" : "user",
    enabled: config.enabled !== false,
    profileId,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    agentId: DEFAULT_AGENT_ID,
    defaultTimeoutMs: normalizeTimeoutMs(
      config.defaultTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    searchTimeoutMs: normalizeTimeoutMs(
      config.searchTimeoutMs,
      DEFAULT_SEARCH_TIMEOUT_MS,
    ),
    updateCheck: normalizeUpdateCheckConfig(config.updateCheck),
  };
}

export function loadRuntimeStateFromDisk(input = {}) {
  const cwd =
    typeof input.cwd === "string" && input.cwd.trim()
      ? path.resolve(input.cwd.trim())
      : path.resolve(process.cwd());
  const env = input.env ?? process.env;
  const codexHome = resolveCodexHome(input.codexHome, env, input.homeDir);
  const mem9Home = resolveMem9Home(input.mem9Home, env, input.homeDir);
  const exists = input.exists ?? existsSync;
  const readJson = input.readJson ?? readJsonFile;
  const readText = input.readText ?? readTextFile;
  const readDirNames = input.readDirNames ?? readDirNamesFromDisk;
  const projectRoot = resolveProjectRoot({ cwd, exists });
  const {
    globalConfigPath,
    userConfigPath,
    projectConfigPath,
    credentialsPath,
    configTomlPath,
    installPath,
    statePath,
  } = runtimePaths(projectRoot, codexHome, mem9Home);
  const globalLoad = loadScopeConfigFile(globalConfigPath, exists, readJson);
  const projectLoad = loadScopeConfigFile(projectConfigPath, exists, readJson);
  const globalConfig = globalLoad.status === "valid" ? globalLoad.config : null;
  const projectConfig = projectLoad.status === "valid" ? projectLoad.config : null;
  const configSource = resolveConfigSource(globalLoad, projectLoad);
  const scope = resolveScopeFromConfigSource(configSource);
  const config = buildEffectiveScopeConfig(globalConfig, projectConfig);
  const runtime = resolveRuntimeConfig({
    scope,
    config,
    credentials: null,
    env,
  });
  const plugin = loadPluginState({
    codexHome,
    configTomlPath,
    installPath,
    exists,
    readJson,
    readText,
    readDirNames,
  });
  const warnings = resolveWarnings(globalLoad, projectLoad);
  const {
    legacyPausedSources,
    effectiveLegacyPausedSource,
  } = resolveLegacyPausedState(globalConfig, projectConfig);
  const configIssue = resolveConfigIssue(globalLoad, projectLoad);

  /** @type {CredentialsFile | null} */
  let credentials = null;
  /** @type {RuntimeIssueCode | null} */
  let credentialsIssue = null;

  try {
    credentials = asCredentialsFile(readJson(credentialsPath));
  } catch {
    credentialsIssue = "invalid_credentials";
  }

  const runtimeWithCredentials = resolveRuntimeConfig({
    scope,
    config,
    credentials,
    env,
  });
  const profiles =
    credentials && isRecord(credentials.profiles)
      ? /** @type {Record<string, Mem9Profile>} */ (credentials.profiles)
      : {};
  const selectedProfileExists = isRecord(profiles[runtimeWithCredentials.profileId]);

  /** @type {RuntimeIssueCode} */
  let issueCode = "ready";

  if (plugin.state === "plugin_missing") {
    issueCode = "plugin_missing";
  } else if (plugin.state === "plugin_disabled") {
    issueCode = "plugin_disabled";
  } else if (effectiveLegacyPausedSource) {
    issueCode = "legacy_paused";
  } else if (configIssue) {
    issueCode = configIssue;
  } else if (credentialsIssue) {
    issueCode = credentialsIssue;
  } else if (!runtimeWithCredentials.profileId || !selectedProfileExists) {
    issueCode = "missing_profile";
  } else if (!runtimeWithCredentials.apiKey) {
    issueCode = "missing_api_key";
  }

  return {
    scope,
    cwd,
    codexHome,
    mem9Home,
    projectRoot,
    configSource,
    projectConfigMatched: projectLoad.exists,
    globalConfigPath,
    userConfigPath,
    projectConfigPath,
    credentialsPath,
    configTomlPath,
    installPath,
    statePath,
    configPath: configSource === "project" ? projectConfigPath : globalConfigPath,
    globalConfigExists: globalLoad.exists,
    userConfigExists: globalLoad.exists,
    projectConfigExists: projectLoad.exists,
    config,
    credentials,
    runtime: runtimeWithCredentials,
    pluginState: plugin.state,
    pluginIssueDetail: plugin.issueDetail,
    pluginVersion: plugin.pluginVersion,
    warnings,
    legacyPausedSources,
    effectiveLegacyPausedSource,
    issueCode,
  };
}

export function loadRuntimeFromDisk(input = {}) {
  const state = loadRuntimeStateFromDisk(input);

  if (state.issueCode !== "ready") {
    throw new Error(`mem9 runtime is not ready: ${state.issueCode}`);
  }

  return state.runtime;
}
