import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Mem9ResolvedPaths } from "./platform-paths.js";
import { stringifyCredentialsFile, parseCredentialsFile } from "./credentials-store.js";
import { DEFAULT_SCOPE_CONFIG } from "./defaults.js";
import { PLUGIN_PACKAGE_NAME } from "./plugin-meta.js";
import { normalizePluginSpecForMatch } from "./plugin-spec.js";
import { DEFAULT_API_URL, type Mem9CredentialsFile } from "./types.js";

export type SetupScope = "user" | "project";

export interface SetupDefaults {
  profileId: string;
  label: string;
  baseUrl: string;
}

export interface SetupRequest {
  paths: Mem9ResolvedPaths;
  scope: SetupScope;
  pluginSpec: string;
  profileId: string;
  label: string;
  baseUrl: string;
  apiKey: string;
}

export interface SetupResult {
  credentialsFile: string;
  scopeConfigFile: string;
  pluginConfigFile: string;
  duplicatePluginConfigFile?: string;
}

interface SetupTargets {
  scopeConfigFile: string;
  pluginConfigFile: string;
  otherPluginConfigFile: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireString(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("invalid json object");
    }
    return parsed;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readCredentialsFile(filePath: string): Promise<Mem9CredentialsFile> {
  try {
    const raw = await readFile(filePath, "utf8");
    return parseCredentialsFile(raw);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return {
        schemaVersion: 1,
        profiles: {},
      };
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function resolveSetupTargets(paths: Mem9ResolvedPaths, scope: SetupScope): SetupTargets {
  if (scope === "user") {
    return {
      scopeConfigFile: paths.globalConfigFile,
      pluginConfigFile: paths.globalPluginConfigFile,
      otherPluginConfigFile: paths.projectPluginConfigFile,
    };
  }

  return {
    scopeConfigFile: paths.projectConfigFile,
    pluginConfigFile: paths.projectPluginConfigFile,
    otherPluginConfigFile: paths.globalPluginConfigFile,
  };
}

function pluginEntrySpec(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    return normalizeOptionalString(entry);
  }

  if (
    Array.isArray(entry) &&
    entry.length >= 1 &&
    typeof entry[0] === "string"
  ) {
    return normalizeOptionalString(entry[0]);
  }

  return undefined;
}

function pluginSpecMatches(entry: unknown, desiredSpec: string): boolean {
  const existingSpec = pluginEntrySpec(entry);
  if (!existingSpec) {
    return false;
  }

  if (existingSpec === desiredSpec) {
    return true;
  }

  return (
    normalizePluginSpecForMatch(existingSpec) ===
    normalizePluginSpecForMatch(desiredSpec)
  );
}

function createScopeConfig(
  existing: Record<string, unknown> | undefined,
  profileId: string,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    schemaVersion: 1,
    profileId,
    debug:
      typeof existing?.debug === "boolean"
        ? existing.debug
        : DEFAULT_SCOPE_CONFIG.debug,
    defaultTimeoutMs:
      typeof existing?.defaultTimeoutMs === "number"
        ? existing.defaultTimeoutMs
        : DEFAULT_SCOPE_CONFIG.defaultTimeoutMs,
    searchTimeoutMs:
      typeof existing?.searchTimeoutMs === "number"
        ? existing.searchTimeoutMs
        : DEFAULT_SCOPE_CONFIG.searchTimeoutMs,
  };
}

function createPluginConfig(
  existing: Record<string, unknown> | undefined,
  pluginSpec: string,
): Record<string, unknown> {
  const plugin = Array.isArray(existing?.plugin) ? [...existing.plugin] : [];

  if (!plugin.some((entry) => pluginSpecMatches(entry, pluginSpec))) {
    plugin.push(pluginSpec);
  }

  return {
    ...(existing ?? {}),
    plugin,
  };
}

export async function loadSetupDefaults(
  paths: Mem9ResolvedPaths,
  scope: SetupScope,
): Promise<SetupDefaults> {
  const targets = resolveSetupTargets(paths, scope);
  const [scopeConfig, credentials] = await Promise.all([
    readJsonObject(targets.scopeConfigFile),
    readCredentialsFile(paths.credentialsFile),
  ]);

  const profileId =
    normalizeOptionalString(scopeConfig?.profileId) ?? "default";
  const profile = credentials.profiles[profileId];

  return {
    profileId,
    label: normalizeOptionalString(profile?.label) ?? "Personal",
    baseUrl: normalizeOptionalString(profile?.baseUrl) ?? DEFAULT_API_URL,
  };
}

export async function writeSetupFiles(input: SetupRequest): Promise<SetupResult> {
  const targets = resolveSetupTargets(input.paths, input.scope);
  const pluginSpec =
    normalizeOptionalString(input.pluginSpec) ?? PLUGIN_PACKAGE_NAME;
  const profileId = requireString(input.profileId, "profileId");
  const label = requireString(input.label, "label");
  const baseUrl = requireString(input.baseUrl, "baseUrl");
  const apiKey = requireString(input.apiKey, "apiKey");

  const [credentials, scopeConfig, pluginConfig, otherPluginConfig] =
    await Promise.all([
      readCredentialsFile(input.paths.credentialsFile),
      readJsonObject(targets.scopeConfigFile),
      readJsonObject(targets.pluginConfigFile),
      readJsonObject(targets.otherPluginConfigFile),
    ]);

  const nextCredentials: Mem9CredentialsFile = {
    schemaVersion: 1,
    profiles: {
      ...credentials.profiles,
      [profileId]: {
        label,
        baseUrl,
        apiKey,
      },
    },
  };

  await Promise.all([
    writeJsonFile(targets.scopeConfigFile, createScopeConfig(scopeConfig, profileId)),
    writeJsonFile(targets.pluginConfigFile, createPluginConfig(pluginConfig, pluginSpec)),
    (async () => {
      await mkdir(path.dirname(input.paths.credentialsFile), { recursive: true });
      await writeFile(
        input.paths.credentialsFile,
        stringifyCredentialsFile(nextCredentials),
        "utf8",
      );
    })(),
  ]);

  const duplicatePluginConfigFile =
    otherPluginConfig &&
    Array.isArray(otherPluginConfig.plugin) &&
    otherPluginConfig.plugin.some((entry) => pluginSpecMatches(entry, pluginSpec))
      ? targets.otherPluginConfigFile
      : undefined;

  return {
    credentialsFile: input.paths.credentialsFile,
    scopeConfigFile: targets.scopeConfigFile,
    pluginConfigFile: targets.pluginConfigFile,
    duplicatePluginConfigFile,
  };
}
