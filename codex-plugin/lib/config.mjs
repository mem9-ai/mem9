// @ts-nocheck

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveProjectRoot } from "./project-root.mjs";

export const DEFAULT_AGENT_ID = "codex";
export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
export const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;

const DEFAULT_API_URL = "https://api.mem9.ai";

/**
 * @typedef {"global" | "project"} ConfigSource
 */

/**
 * @typedef {"project" | "user"} RuntimeScope
 */

/**
 * @typedef {"ready" | "disabled" | "missing_config" | "invalid_config" | "missing_profile" | "invalid_credentials" | "missing_api_key"} RuntimeIssueCode
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
 *   configPath: string,
 *   globalConfigExists: boolean,
 *   userConfigExists: boolean,
 *   projectConfigExists: boolean,
 *   config: ScopeConfig | null,
 *   credentials: CredentialsFile | null,
 *   runtime: RuntimeConfig,
 *   issueCode: RuntimeIssueCode,
 * }} RuntimeState
 */

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
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

function runtimePaths(projectRoot, codexHome, mem9Home) {
  const globalConfigPath = path.join(codexHome, "mem9", "config.json");

  return {
    globalConfigPath,
    userConfigPath: globalConfigPath,
    projectConfigPath: projectRoot
      ? path.join(projectRoot, ".codex", "mem9", "config.json")
      : "",
    credentialsPath: path.join(mem9Home, ".credentials.json"),
  };
}

function asScopeConfig(value) {
  return isRecord(value) ? /** @type {ScopeConfig} */ (value) : {};
}

function asCredentialsFile(value) {
  return isRecord(value) ? /** @type {CredentialsFile} */ (value) : {};
}

function mergeScopeConfig(globalConfig, projectConfig) {
  if (globalConfig == null && projectConfig == null) {
    return null;
  }

  return {
    ...(globalConfig ?? {}),
    ...(projectConfig ?? {}),
  };
}

export function resolveRuntimeConfig(input) {
  const config = asScopeConfig(input.config);
  const credentials = asCredentialsFile(input.credentials);
  const profileId =
    typeof config.profileId === "string" && config.profileId.trim()
      ? config.profileId.trim()
      : "";
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
  const projectRoot = resolveProjectRoot({ cwd, exists });
  const {
    globalConfigPath,
    userConfigPath,
    projectConfigPath,
    credentialsPath,
  } = runtimePaths(projectRoot, codexHome, mem9Home);
  const globalConfigExists = exists(globalConfigPath);
  const projectConfigMatched = projectConfigPath ? exists(projectConfigPath) : false;

  /** @type {ScopeConfig | null} */
  let globalConfig = null;
  /** @type {ScopeConfig | null} */
  let projectConfig = null;
  /** @type {CredentialsFile | null} */
  let credentials = null;
  /** @type {RuntimeIssueCode} */
  let issueCode = "ready";

  if (globalConfigExists) {
    try {
      globalConfig = asScopeConfig(readJson(globalConfigPath));
    } catch {
      issueCode = "invalid_config";
    }
  }

  if (projectConfigMatched) {
    try {
      projectConfig = asScopeConfig(readJson(projectConfigPath));
    } catch {
      issueCode = "invalid_config";
    }
  }

  if (!globalConfigExists && !projectConfigMatched && issueCode === "ready") {
    issueCode = "missing_config";
  }

  try {
    credentials = asCredentialsFile(readJson(credentialsPath));
  } catch {
    if (issueCode === "ready") {
      issueCode = "invalid_credentials";
    }
  }

  const config = mergeScopeConfig(globalConfig, projectConfig);
  const scope = projectConfigMatched ? "project" : "user";
  const configSource = projectConfigMatched ? "project" : "global";
  const runtime = resolveRuntimeConfig({
    scope,
    config,
    credentials,
    env,
  });
  const profiles =
    credentials && isRecord(credentials.profiles)
      ? /** @type {Record<string, Mem9Profile>} */ (credentials.profiles)
      : {};

  if (issueCode === "ready" && runtime.enabled === false) {
    issueCode = "disabled";
  }

  if (issueCode === "ready" && !runtime.profileId) {
    issueCode = "missing_profile";
  }

  if (
    issueCode === "ready"
    && !isRecord(profiles[runtime.profileId])
  ) {
    issueCode = "missing_profile";
  }

  if (issueCode === "ready" && !runtime.apiKey) {
    issueCode = "missing_api_key";
  }

  return {
    scope,
    cwd,
    codexHome,
    mem9Home,
    projectRoot,
    configSource,
    projectConfigMatched,
    globalConfigPath,
    userConfigPath,
    projectConfigPath,
    credentialsPath,
    configPath: projectConfigMatched ? projectConfigPath : globalConfigPath,
    globalConfigExists,
    userConfigExists: globalConfigExists,
    projectConfigExists: projectConfigMatched,
    config,
    credentials,
    runtime,
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
