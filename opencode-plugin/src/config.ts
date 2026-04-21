import { readFile } from "node:fs/promises";
import type { PluginInput } from "@opencode-ai/plugin";
import { parseCredentialsFile } from "./credentials-store.js";
import {
  resolveOpenCodeBasePaths,
  resolveMem9Home,
  resolveMem9Paths,
  type Mem9ResolvedPaths,
} from "./platform-paths.js";
import {
  DEFAULT_API_URL,
  type Mem9ConfigFile,
  type Mem9CredentialsFile,
} from "./types.js";

const DEFAULT_CONFIG: Required<
  Pick<
    Mem9ConfigFile,
    "schemaVersion" | "debug" | "defaultTimeoutMs" | "searchTimeoutMs"
  >
> = {
  schemaVersion: 1,
  debug: false,
  defaultTimeoutMs: 8000,
  searchTimeoutMs: 15000,
};

const EMPTY_CREDENTIALS: Mem9CredentialsFile = {
  schemaVersion: 1,
  profiles: {},
};

export interface EffectiveConfig extends Mem9ConfigFile {
  paths?: Mem9ResolvedPaths;
}

export interface RuntimeIdentity {
  apiKey: string;
  baseUrl: string;
  source: "env" | "legacy_env" | "profile";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function normalizeConfigFile(value: unknown): Mem9ConfigFile {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("invalid mem9 config file");
  }

  if ("profileId" in value && value.profileId !== undefined && typeof value.profileId !== "string") {
    throw new Error("invalid mem9 config file");
  }
  if ("debug" in value && value.debug !== undefined && typeof value.debug !== "boolean") {
    throw new Error("invalid mem9 config file");
  }
  if (
    "defaultTimeoutMs" in value &&
    value.defaultTimeoutMs !== undefined &&
    typeof value.defaultTimeoutMs !== "number"
  ) {
    throw new Error("invalid mem9 config file");
  }
  if (
    "searchTimeoutMs" in value &&
    value.searchTimeoutMs !== undefined &&
    typeof value.searchTimeoutMs !== "number"
  ) {
    throw new Error("invalid mem9 config file");
  }

  return {
    schemaVersion: 1,
    profileId: typeof value.profileId === "string" ? value.profileId : undefined,
    debug: typeof value.debug === "boolean" ? value.debug : undefined,
    defaultTimeoutMs:
      typeof value.defaultTimeoutMs === "number" ? value.defaultTimeoutMs : undefined,
    searchTimeoutMs:
      typeof value.searchTimeoutMs === "number" ? value.searchTimeoutMs : undefined,
  };
}

async function readConfigFile(filePath: string): Promise<Mem9ConfigFile | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeConfigFile(JSON.parse(raw) as unknown);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return undefined;
    }
    console.warn("[mem9] Skipping unreadable mem9 config file.");
    return undefined;
  }
}

async function readCredentialsFile(filePath: string): Promise<Mem9CredentialsFile> {
  try {
    const raw = await readFile(filePath, "utf8");
    return parseCredentialsFile(raw);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return EMPTY_CREDENTIALS;
    }
    console.warn("[mem9] Skipping unreadable mem9 credentials file.");
    return EMPTY_CREDENTIALS;
  }
}

function resolvePluginPaths(input: PluginInput): Mem9ResolvedPaths {
  const basePaths = resolveOpenCodeBasePaths(process.env);
  return resolveMem9Paths({
    configDir: basePaths.configDir,
    dataDir: basePaths.dataDir,
    projectDir: input.worktree || input.directory,
    mem9Home: resolveMem9Home(process.env),
  });
}

export function mergeConfigLayers(
  globalConfig?: Mem9ConfigFile,
  projectConfig?: Mem9ConfigFile,
): Mem9ConfigFile {
  return {
    ...DEFAULT_CONFIG,
    ...globalConfig,
    ...projectConfig,
  };
}

export function resolveRuntimeIdentity(
  env: Record<string, string | undefined>,
  credentials: Mem9CredentialsFile,
  config: Mem9ConfigFile,
): RuntimeIdentity | null {
  const envApiKey = normalizeOptionalString(env.MEM9_API_KEY);
  const envBaseUrl = normalizeOptionalString(env.MEM9_API_URL) ?? DEFAULT_API_URL;
  const legacyTenantID = normalizeOptionalString(env.MEM9_TENANT_ID);
  const profileID = normalizeOptionalString(config.profileId);

  if (envApiKey) {
    return {
      apiKey: envApiKey,
      baseUrl: envBaseUrl,
      source: "env",
    };
  }

  if (legacyTenantID) {
    return {
      apiKey: legacyTenantID,
      baseUrl: envBaseUrl,
      source: "legacy_env",
    };
  }

  if (!profileID) {
    return null;
  }

  const profile = credentials.profiles[profileID];
  if (!profile) {
    return null;
  }

  const profileApiKey = normalizeOptionalString(profile.apiKey);
  if (!profileApiKey) {
    return null;
  }

  return {
    apiKey: profileApiKey,
    baseUrl: normalizeOptionalString(profile.baseUrl) ?? DEFAULT_API_URL,
    source: "profile",
  };
}

export async function resolveEffectiveConfig(input: PluginInput): Promise<EffectiveConfig> {
  const paths = resolvePluginPaths(input);

  const [globalConfig, projectConfig] = await Promise.all([
    readConfigFile(paths.globalConfigFile),
    readConfigFile(paths.projectConfigFile),
  ]);

  return {
    ...mergeConfigLayers(globalConfig, projectConfig),
    paths,
  };
}

export async function resolvePluginIdentity(
  config: EffectiveConfig,
): Promise<RuntimeIdentity | null> {
  const envIdentity = resolveRuntimeIdentity(process.env, EMPTY_CREDENTIALS, config);
  if (envIdentity && envIdentity.source !== "profile") {
    return envIdentity;
  }

  if (!config.paths) {
    return null;
  }

  const credentials = await readCredentialsFile(config.paths.credentialsFile);
  return resolveRuntimeIdentity(process.env, credentials, config);
}
