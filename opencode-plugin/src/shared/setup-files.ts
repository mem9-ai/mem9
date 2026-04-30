import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Mem9ResolvedPaths } from "./platform-paths.ts";
import { parseCredentialsFile, stringifyCredentialsFile } from "./credentials-store.ts";
import { DEFAULT_SCOPE_CONFIG } from "./defaults.ts";
import {
  DEFAULT_API_URL,
  type Mem9ConfigFile,
  type Mem9CredentialsFile,
  type Mem9Profile,
} from "./types.ts";

export type SetupScope = "user" | "project";

export interface SetupProfileSummary {
  profileId: string;
  label: string;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyPreview: string;
}

export interface ScopeConfigState {
  profileId?: string;
  debug: boolean;
  defaultTimeoutMs: number;
  searchTimeoutMs: number;
}

export interface SetupState {
  suggestedProfileId: string;
  suggestedNewProfileId: string;
  suggestedLabel: string;
  suggestedBaseUrl: string;
  profiles: SetupProfileSummary[];
  usableProfiles: SetupProfileSummary[];
  scopeStates: Record<SetupScope, ScopeConfigState>;
}

export interface SetupRequest {
  paths: Mem9ResolvedPaths;
  profileId: string;
  label: string;
  baseUrl: string;
  apiKey: string;
}

export interface ScopeConfigRequest {
  paths: Mem9ResolvedPaths;
  scope: SetupScope;
  profileId: string;
  debug: boolean;
  defaultTimeoutMs: number;
  searchTimeoutMs: number;
}

export interface ProvisionApiKeyOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
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

function normalizeBaseUrl(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.replace(/\/+$/, "") : undefined;
}

function normalizeTimeoutMs(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
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

function resolveScopeConfigFile(
  paths: Mem9ResolvedPaths,
  scope: SetupScope,
): string {
  return scope === "user" ? paths.globalConfigFile : paths.projectConfigFile;
}

function hasApiKey(profile: unknown): boolean {
  if (!isRecord(profile)) {
    return false;
  }

  return Boolean(normalizeOptionalString(profile.apiKey));
}

function summarizeApiKeyPreview(apiKey: string): string {
  const normalized = apiKey.trim();
  if (normalized.length === 0) {
    return "";
  }

  if (normalized.length <= 4) {
    return `${normalized.slice(0, 1)}...`;
  }

  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}...${normalized.slice(-2)}`;
  }

  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function normalizeProfileRecord(
  profileId: string,
  profile: Mem9Profile | undefined,
): Mem9Profile {
  return {
    label:
      normalizeOptionalString(profile?.label)
      ?? (profileId === "default" ? "Personal" : profileId),
    baseUrl: normalizeBaseUrl(profile?.baseUrl) ?? DEFAULT_API_URL,
    apiKey: typeof profile?.apiKey === "string" ? profile.apiKey : "",
  };
}

function buildDefaultProfileId(
  profiles: Record<string, Mem9Profile>,
  preferredProfileId: string | undefined,
): string {
  const preferred = normalizeOptionalString(preferredProfileId);
  if (preferred) {
    return preferred;
  }

  const profileIds = Object.keys(profiles).sort((left, right) =>
    left.localeCompare(right),
  );
  if (profileIds.includes("default")) {
    return "default";
  }

  return profileIds[0] ?? "default";
}

function buildSuggestedNewProfileId(
  profiles: Record<string, Mem9Profile>,
  preferredProfileId: string,
): string {
  const existingProfile = profiles[preferredProfileId];
  if (!existingProfile || !hasApiKey(existingProfile)) {
    return preferredProfileId;
  }

  let suffix = 2;
  while (profiles[`${preferredProfileId}-${suffix}`]) {
    suffix += 1;
  }

  return `${preferredProfileId}-${suffix}`;
}

function sortProfileSummaries(
  left: SetupProfileSummary,
  right: SetupProfileSummary,
): number {
  if (left.profileId === "default") {
    return -1;
  }
  if (right.profileId === "default") {
    return 1;
  }
  if (left.hasApiKey !== right.hasApiKey) {
    return left.hasApiKey ? -1 : 1;
  }
  return left.profileId.localeCompare(right.profileId);
}

function buildProfiles(
  profiles: Record<string, Mem9Profile>,
): SetupProfileSummary[] {
  return Object.entries(profiles)
    .map(([profileId, profile]) => {
      const normalized = normalizeProfileRecord(profileId, profile);
      return {
        profileId,
        label: normalized.label,
        baseUrl: normalized.baseUrl,
        hasApiKey: normalized.apiKey.trim().length > 0,
        apiKeyPreview: summarizeApiKeyPreview(normalized.apiKey),
      };
    })
    .sort(sortProfileSummaries);
}

function normalizeConfigLayer(
  value: Record<string, unknown> | undefined,
): Mem9ConfigFile {
  return {
    schemaVersion: 1,
    profileId: normalizeOptionalString(value?.profileId),
    debug: typeof value?.debug === "boolean" ? value.debug : undefined,
    defaultTimeoutMs:
      typeof value?.defaultTimeoutMs === "number" ? value.defaultTimeoutMs : undefined,
    searchTimeoutMs:
      typeof value?.searchTimeoutMs === "number" ? value.searchTimeoutMs : undefined,
  };
}

function buildScopeState(
  config: Mem9ConfigFile,
  usableProfiles: SetupProfileSummary[],
  fallbackProfileId?: string,
): ScopeConfigState {
  const usableProfileIds = new Set(
    usableProfiles.map((profile) => profile.profileId),
  );
  const configuredProfileId = normalizeOptionalString(config.profileId);
  const resolvedProfileId =
    (configuredProfileId && usableProfileIds.has(configuredProfileId))
      ? configuredProfileId
      : usableProfiles[0]?.profileId ?? fallbackProfileId;

  return {
    profileId: resolvedProfileId,
    debug: config.debug ?? DEFAULT_SCOPE_CONFIG.debug,
    defaultTimeoutMs: normalizeTimeoutMs(
      config.defaultTimeoutMs,
      DEFAULT_SCOPE_CONFIG.defaultTimeoutMs,
    ),
    searchTimeoutMs: normalizeTimeoutMs(
      config.searchTimeoutMs,
      DEFAULT_SCOPE_CONFIG.searchTimeoutMs,
    ),
  };
}

function mergeConfigLayers(
  ...layers: Mem9ConfigFile[]
): Mem9ConfigFile {
  const merged: Mem9ConfigFile = {
    schemaVersion: 1,
  };

  for (const layer of layers) {
    if (layer.profileId !== undefined) {
      merged.profileId = layer.profileId;
    }
    if (layer.debug !== undefined) {
      merged.debug = layer.debug;
    }
    if (layer.defaultTimeoutMs !== undefined) {
      merged.defaultTimeoutMs = layer.defaultTimeoutMs;
    }
    if (layer.searchTimeoutMs !== undefined) {
      merged.searchTimeoutMs = layer.searchTimeoutMs;
    }
  }

  return merged;
}

function createScopeConfig(
  existing: Record<string, unknown> | undefined,
  input: ScopeConfigState,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    schemaVersion: 1,
    profileId: input.profileId,
    debug: input.debug,
    defaultTimeoutMs: normalizeTimeoutMs(
      input.defaultTimeoutMs,
      DEFAULT_SCOPE_CONFIG.defaultTimeoutMs,
    ),
    searchTimeoutMs: normalizeTimeoutMs(
      input.searchTimeoutMs,
      DEFAULT_SCOPE_CONFIG.searchTimeoutMs,
    ),
  };
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

export async function loadSetupState(paths: Mem9ResolvedPaths): Promise<SetupState> {
  const [globalConfigRaw, projectConfigRaw, credentials] = await Promise.all([
    readJsonObject(paths.globalConfigFile),
    readJsonObject(paths.projectConfigFile),
    readCredentialsFile(paths.credentialsFile),
  ]);
  const globalConfig = normalizeConfigLayer(globalConfigRaw);
  const projectConfig = normalizeConfigLayer(projectConfigRaw);
  const profiles = buildProfiles(credentials.profiles);
  const usableProfiles = profiles.filter((profile) => profile.hasApiKey);

  const suggestedProfileId = buildDefaultProfileId(
    credentials.profiles,
    globalConfig.profileId,
  );
  const suggestedProfile = normalizeProfileRecord(
    suggestedProfileId,
    credentials.profiles[suggestedProfileId],
  );
  const userScopeState = buildScopeState(
    globalConfig,
    usableProfiles,
    suggestedProfileId,
  );
  const projectScopeState = buildScopeState(
    mergeConfigLayers(globalConfig, projectConfig),
    usableProfiles,
    userScopeState.profileId ?? suggestedProfileId,
  );

  return {
    suggestedProfileId,
    suggestedNewProfileId: buildSuggestedNewProfileId(
      credentials.profiles,
      suggestedProfileId,
    ),
    suggestedLabel: suggestedProfile.label,
    suggestedBaseUrl: suggestedProfile.baseUrl,
    profiles,
    usableProfiles,
    scopeStates: {
      user: userScopeState,
      project: projectScopeState,
    },
  };
}

export async function writeSetupFiles(input: SetupRequest): Promise<void> {
  const profileId = requireString(input.profileId, "profileId");
  const label = requireString(input.label, "label");
  const baseUrl = requireString(normalizeBaseUrl(input.baseUrl) ?? "", "baseUrl");
  const apiKey = requireString(input.apiKey, "apiKey");

  const [credentials, globalConfigRaw] = await Promise.all([
    readCredentialsFile(input.paths.credentialsFile),
    readJsonObject(input.paths.globalConfigFile),
  ]);
  const globalConfig = buildScopeState(
    normalizeConfigLayer(globalConfigRaw),
    [],
    profileId,
  );

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
    writeJsonFile(
      input.paths.globalConfigFile,
      createScopeConfig(globalConfigRaw, {
        ...globalConfig,
        profileId,
      }),
    ),
    (async () => {
      await mkdir(path.dirname(input.paths.credentialsFile), { recursive: true });
      await writeFile(
        input.paths.credentialsFile,
        stringifyCredentialsFile(nextCredentials),
        "utf8",
      );
    })(),
  ]);
}

export async function writeScopeConfig(
  input: ScopeConfigRequest,
): Promise<void> {
  const profileId = requireString(input.profileId, "profileId");
  const configFile = resolveScopeConfigFile(input.paths, input.scope);
  const [existing, credentials] = await Promise.all([
    readJsonObject(configFile),
    readCredentialsFile(input.paths.credentialsFile),
  ]);
  const profile = credentials.profiles[profileId];

  if (!profile || !hasApiKey(profile)) {
    throw new Error(`mem9 profile "${profileId}" is unavailable.`);
  }

  await writeJsonFile(
    configFile,
    createScopeConfig(existing, {
      profileId,
      debug: input.debug,
      defaultTimeoutMs: input.defaultTimeoutMs,
      searchTimeoutMs: input.searchTimeoutMs,
    }),
  );
}

export async function provisionApiKey(
  options: ProvisionApiKeyOptions,
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Global fetch is unavailable, so mem9 setup cannot request an API key.");
  }

  const baseUrl = requireString(normalizeBaseUrl(options.baseUrl) ?? "", "baseUrl");
  const timeoutMs = options.timeoutMs ?? DEFAULT_SCOPE_CONFIG.defaultTimeoutMs;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/v1alpha1/mem9s`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`mem9 setup timed out after ${timeoutMs}ms while requesting an API key.`);
    }

    throw new Error(
      `mem9 setup could not request an API key: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new Error(`mem9 setup could not request an API key (HTTP ${response.status}).`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(
      `mem9 setup received invalid JSON while requesting an API key: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(payload)) {
    throw new Error("mem9 setup did not receive an API key from the server.");
  }

  const apiKey = normalizeOptionalString(payload.id);
  if (!apiKey) {
    throw new Error("mem9 setup did not receive an API key from the server.");
  }

  return apiKey;
}
