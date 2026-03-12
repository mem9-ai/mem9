const SPACE_ID_KEY = "mem9-space-id";
const LAST_ACTIVE_KEY = "mem9-last-active";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function getSpaceId(): string | null {
  return sessionStorage.getItem(SPACE_ID_KEY);
}

export function setSpaceId(id: string): void {
  sessionStorage.setItem(SPACE_ID_KEY, id);
  touchActivity();
}

export function clearSpace(): void {
  sessionStorage.removeItem(SPACE_ID_KEY);
  sessionStorage.removeItem(LAST_ACTIVE_KEY);
}

export function touchActivity(): void {
  sessionStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
}

export function isSessionExpired(): boolean {
  const last = sessionStorage.getItem(LAST_ACTIVE_KEY);
  if (!last) return true;
  return Date.now() - Number(last) > IDLE_TIMEOUT_MS;
}

export function maskSpaceId(id: string): string {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}
