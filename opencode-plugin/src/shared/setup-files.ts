import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Mem9ResolvedPaths } from "./platform-paths.js";
import { parseCredentialsFile, stringifyCredentialsFile } from "./credentials-store.js";
import { DEFAULT_SCOPE_CONFIG } from "./defaults.js";
import {
  DEFAULT_API_URL,
  type Mem9CredentialsFile,
  type Mem9Profile,
} from "./types.js";

export interface SetupProfileSummary {
  profileId: string;
  label: string;
  baseUrl: string;
}

export interface SetupState {
  suggestedProfileId: string;
  suggestedNewProfileId: string;
  suggestedLabel: string;
  suggestedBaseUrl: string;
  usableProfiles: SetupProfileSummary[];
}

export interface SetupRequest {
  paths: Mem9ResolvedPaths;
  profileId: string;
  label: string;
  baseUrl: string;
  apiKey: string;
}

export interface SelectProfileRequest {
  paths: Mem9ResolvedPaths;
  profileId: string;
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

function hasApiKey(profile: unknown): boolean {
  if (!isRecord(profile)) {
    return false;
  }

  return Boolean(normalizeOptionalString(profile.apiKey));
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

function buildUsableProfiles(
  profiles: Record<string, Mem9Profile>,
): SetupProfileSummary[] {
  return Object.entries(profiles)
    .filter(([, profile]) => hasApiKey(profile))
    .sort(([left], [right]) => {
      if (left === "default") {
        return -1;
      }
      if (right === "default") {
        return 1;
      }
      return left.localeCompare(right);
    })
    .map(([profileId, profile]) => {
      const normalized = normalizeProfileRecord(profileId, profile);
      return {
        profileId,
        label: normalized.label,
        baseUrl: normalized.baseUrl,
      };
    });
}

function createGlobalConfig(
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

export async function loadSetupState(paths: Mem9ResolvedPaths): Promise<SetupState> {
  const [globalConfig, credentials] = await Promise.all([
    readJsonObject(paths.globalConfigFile),
    readCredentialsFile(paths.credentialsFile),
  ]);

  const suggestedProfileId = buildDefaultProfileId(
    credentials.profiles,
    normalizeOptionalString(globalConfig?.profileId),
  );
  const suggestedProfile = normalizeProfileRecord(
    suggestedProfileId,
    credentials.profiles[suggestedProfileId],
  );

  return {
    suggestedProfileId,
    suggestedNewProfileId: buildSuggestedNewProfileId(
      credentials.profiles,
      suggestedProfileId,
    ),
    suggestedLabel: suggestedProfile.label,
    suggestedBaseUrl: suggestedProfile.baseUrl,
    usableProfiles: buildUsableProfiles(credentials.profiles),
  };
}

export async function writeSetupFiles(input: SetupRequest): Promise<void> {
  const profileId = requireString(input.profileId, "profileId");
  const label = requireString(input.label, "label");
  const baseUrl = requireString(normalizeBaseUrl(input.baseUrl) ?? "", "baseUrl");
  const apiKey = requireString(input.apiKey, "apiKey");

  const [credentials, globalConfig] = await Promise.all([
    readCredentialsFile(input.paths.credentialsFile),
    readJsonObject(input.paths.globalConfigFile),
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
    writeJsonFile(input.paths.globalConfigFile, createGlobalConfig(globalConfig, profileId)),
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

export async function selectSetupProfile(
  input: SelectProfileRequest,
): Promise<void> {
  const profileId = requireString(input.profileId, "profileId");
  const [credentials, globalConfig] = await Promise.all([
    readCredentialsFile(input.paths.credentialsFile),
    readJsonObject(input.paths.globalConfigFile),
  ]);
  const profile = credentials.profiles[profileId];

  if (!profile || !hasApiKey(profile)) {
    throw new Error(`mem9 profile "${profileId}" is unavailable.`);
  }

  await writeJsonFile(
    input.paths.globalConfigFile,
    createGlobalConfig(globalConfig, profileId),
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
