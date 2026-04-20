import type { Mem9CredentialsFile, Mem9Profile } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMem9Profile(value: unknown): value is Mem9Profile {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.label === "string" &&
    typeof value.baseUrl === "string" &&
    typeof value.apiKey === "string"
  );
}

export function parseCredentialsFile(raw: string): Mem9CredentialsFile {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.profiles)) {
    throw new Error("invalid mem9 credentials file");
  }

  const profiles: Record<string, Mem9Profile> = {};
  for (const [profileID, profile] of Object.entries(parsed.profiles)) {
    if (!isMem9Profile(profile)) {
      throw new Error("invalid mem9 credentials file");
    }
    profiles[profileID] = profile;
  }

  return {
    schemaVersion: 1,
    profiles,
  };
}

export function stringifyCredentialsFile(file: Mem9CredentialsFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}
