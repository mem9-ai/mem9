const SPACE_ID_KEY = "mem9-space-id";
const LAST_ACTIVE_KEY = "mem9-last-active";
const REMEMBERED_SPACE_KEY = "mem9-remembered-space";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const REMEMBER_ME_TTL_MS = 15 * 24 * 60 * 60 * 1000;

interface RememberedSpace {
  spaceId: string;
  expiresAt: number;
}

export function getSpaceId(): string | null {
  return sessionStorage.getItem(SPACE_ID_KEY);
}

function readRememberedSpace(): RememberedSpace | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_SPACE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<RememberedSpace>;
    if (
      typeof parsed.spaceId !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      localStorage.removeItem(REMEMBERED_SPACE_KEY);
      return null;
    }

    if (parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(REMEMBERED_SPACE_KEY);
      return null;
    }

    return {
      spaceId: parsed.spaceId,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    localStorage.removeItem(REMEMBERED_SPACE_KEY);
    return null;
  }
}

export function setSpaceId(id: string, remember = false): void {
  sessionStorage.setItem(SPACE_ID_KEY, id);
  touchActivity();

  if (remember) {
    const remembered: RememberedSpace = {
      spaceId: id,
      expiresAt: Date.now() + REMEMBER_ME_TTL_MS,
    };
    localStorage.setItem(REMEMBERED_SPACE_KEY, JSON.stringify(remembered));
    return;
  }

  localStorage.removeItem(REMEMBERED_SPACE_KEY);
}

export function clearSpace(): void {
  sessionStorage.removeItem(SPACE_ID_KEY);
  sessionStorage.removeItem(LAST_ACTIVE_KEY);
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

export function restoreRememberedSpace(): string | null {
  const remembered = readRememberedSpace();
  if (!remembered) return null;

  sessionStorage.setItem(SPACE_ID_KEY, remembered.spaceId);
  touchActivity();
  return remembered.spaceId;
}

export function getActiveSpaceId(): string | null {
  return getSpaceId() ?? restoreRememberedSpace();
}

export function isRememberedSpace(spaceId: string): boolean {
  if (!spaceId) {
    return false;
  }

  return readRememberedSpace()?.spaceId === spaceId;
}

export function maskSpaceId(id: string): string {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}
