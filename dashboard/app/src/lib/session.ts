const API_KEY_KEY = "mem9-api-key";
const SPACE_ID_KEY = "mem9-space-id";
const LAST_ACTIVE_KEY = "mem9-last-active";
const REMEMBERED_API_KEY = "mem9-remembered-api-key";
const REMEMBERED_SPACE_KEY = "mem9-remembered-space";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const REMEMBER_ME_TTL_MS = 15 * 24 * 60 * 60 * 1000;
export const MEM9_CONNECT_READY_EVENT = "mem9-connect-ready";
export const MEM9_SPACE_HANDOFF_EVENT = "mem9-space-handoff";

interface RememberedApiKey {
  apiKey: string;
  expiresAt: number;
}

function writeSessionKey(storage: Storage, apiKey: string): void {
  storage.setItem(API_KEY_KEY, apiKey);
  removeLegacySessionState(storage);
}

function removeLegacySessionState(storage: Storage): void {
  storage.removeItem(SPACE_ID_KEY);
}

function removeLegacyRememberedState(storage: Storage): void {
  storage.removeItem(REMEMBERED_SPACE_KEY);
}

function writeSessionState(storage: Storage, apiKey: string): void {
  writeSessionKey(storage, apiKey);
  storage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
}

function migrateLegacySessionState(storage: Storage): string | null {
  const legacyApiKey = storage.getItem(SPACE_ID_KEY);
  if (!legacyApiKey) {
    return null;
  }

  writeSessionKey(storage, legacyApiKey);
  return legacyApiKey;
}

function readRawRememberedApiKey(
  storage: Storage,
  key: string,
  valueKey: "apiKey" | "spaceId",
): RememberedApiKey | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<RememberedApiKey & { spaceId: string }>;
    const storedValue = parsed[valueKey];
    if (
      typeof storedValue !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      storage.removeItem(key);
      return null;
    }

    if (parsed.expiresAt <= Date.now()) {
      storage.removeItem(key);
      return null;
    }

    return {
      apiKey: storedValue,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    storage.removeItem(key);
    return null;
  }
}

function writeRememberedApiKey(
  storage: Storage,
  apiKey: string,
  expiresAt = Date.now() + REMEMBER_ME_TTL_MS,
): void {
  const remembered: RememberedApiKey = {
    apiKey,
    expiresAt,
  };
  storage.setItem(REMEMBERED_API_KEY, JSON.stringify(remembered));
  removeLegacyRememberedState(storage);
}

function readRememberedApiKey(): RememberedApiKey | null {
  const rememberedApiKey = readRawRememberedApiKey(
    localStorage,
    REMEMBERED_API_KEY,
    "apiKey",
  );
  if (rememberedApiKey) {
    removeLegacyRememberedState(localStorage);
    return rememberedApiKey;
  }

  const legacyRememberedApiKey = readRawRememberedApiKey(
    localStorage,
    REMEMBERED_SPACE_KEY,
    "spaceId",
  );
  if (!legacyRememberedApiKey) {
    return null;
  }

  writeRememberedApiKey(
    localStorage,
    legacyRememberedApiKey.apiKey,
    legacyRememberedApiKey.expiresAt,
  );
  return legacyRememberedApiKey;
}

export function getApiKey(): string | null {
  const apiKey = sessionStorage.getItem(API_KEY_KEY);
  if (apiKey) {
    removeLegacySessionState(sessionStorage);
    return apiKey;
  }

  return migrateLegacySessionState(sessionStorage);
}

export function setApiKey(apiKey: string, remember = false): void {
  writeSessionState(sessionStorage, apiKey);

  if (remember) {
    writeRememberedApiKey(localStorage, apiKey);
    return;
  }

  localStorage.removeItem(REMEMBERED_API_KEY);
  removeLegacyRememberedState(localStorage);
}

export function getSpaceId(): string | null {
  return getApiKey();
}

export function setSpaceId(spaceId: string, remember = false): void {
  setApiKey(spaceId, remember);
}

export function clearSpace(): void {
  sessionStorage.removeItem(API_KEY_KEY);
  sessionStorage.removeItem(SPACE_ID_KEY);
  sessionStorage.removeItem(LAST_ACTIVE_KEY);
  localStorage.removeItem(REMEMBERED_API_KEY);
  localStorage.removeItem(REMEMBERED_SPACE_KEY);
}

export function touchActivity(): void {
  sessionStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
}

export function isSessionExpired(): boolean {
  const last = sessionStorage.getItem(LAST_ACTIVE_KEY);
  if (!last) return true;
  return Date.now() - Number(last) > IDLE_TIMEOUT_MS;
}

export function restoreRememberedApiKey(): string | null {
  const remembered = readRememberedApiKey();
  if (!remembered) return null;

  writeSessionState(sessionStorage, remembered.apiKey);
  return remembered.apiKey;
}

export function getActiveApiKey(): string | null {
  return getApiKey() ?? restoreRememberedApiKey();
}

export function restoreRememberedSpace(): string | null {
  return restoreRememberedApiKey();
}

export function getActiveSpaceId(): string | null {
  return getActiveApiKey();
}

export function isRememberedApiKey(apiKey: string): boolean {
  if (!apiKey) {
    return false;
  }

  return readRememberedApiKey()?.apiKey === apiKey;
}

export function isRememberedSpace(spaceId: string): boolean {
  return isRememberedApiKey(spaceId);
}

export function maskSpaceId(id: string): string {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}
