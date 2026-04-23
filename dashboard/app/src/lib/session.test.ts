import { afterEach, describe, expect, it } from "vitest";
import {
  clearSpace,
  getActiveApiKey,
  getActiveSpaceId,
  getApiKey,
  getSpaceId,
  restoreRememberedApiKey,
  restoreRememberedSpace,
  setApiKey,
  setSpaceId,
} from "./session";

const API_KEY_KEY = "mem9-api-key";
const SPACE_ID_KEY = "mem9-space-id";
const LAST_ACTIVE_KEY = "mem9-last-active";
const REMEMBERED_API_KEY = "mem9-remembered-api-key";
const REMEMBERED_SPACE_KEY = "mem9-remembered-space";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("session helpers", () => {
  it("stores the active api key in sessionStorage without remembering login", () => {
    setApiKey("space-1");

    expect(getApiKey()).toBe("space-1");
    expect(getSpaceId()).toBe("space-1");
    expect(sessionStorage.getItem(API_KEY_KEY)).toBe("space-1");
    expect(sessionStorage.getItem(SPACE_ID_KEY)).toBeNull();
    expect(localStorage.getItem(REMEMBERED_API_KEY)).toBeNull();
    expect(localStorage.getItem(REMEMBERED_SPACE_KEY)).toBeNull();
  });

  it("restores a remembered login into the current session", () => {
    setApiKey("space-remembered", true);
    sessionStorage.clear();

    expect(restoreRememberedApiKey()).toBe("space-remembered");
    expect(restoreRememberedSpace()).toBe("space-remembered");
    expect(getApiKey()).toBe("space-remembered");
    expect(restoreRememberedSpace()).toBe("space-remembered");
    expect(getSpaceId()).toBe("space-remembered");
    expect(getActiveApiKey()).toBe("space-remembered");
    expect(getActiveSpaceId()).toBe("space-remembered");
  });

  it("drops expired remembered sessions", () => {
    localStorage.setItem(
      REMEMBERED_API_KEY,
      JSON.stringify({
        apiKey: "space-expired",
        expiresAt: Date.now() - 1_000,
      }),
    );

    expect(restoreRememberedApiKey()).toBeNull();
    expect(localStorage.getItem(REMEMBERED_API_KEY)).toBeNull();
  });

  it("clears both session and remembered login", () => {
    setApiKey("space-1", true);

    clearSpace();

    expect(getApiKey()).toBeNull();
    expect(getSpaceId()).toBeNull();
    expect(localStorage.getItem(REMEMBERED_API_KEY)).toBeNull();
    expect(localStorage.getItem(REMEMBERED_SPACE_KEY)).toBeNull();
  });

  it("migrates a legacy session key into the new api key slot", () => {
    sessionStorage.setItem(LAST_ACTIVE_KEY, "123");
    sessionStorage.setItem(SPACE_ID_KEY, "legacy-space");

    expect(getApiKey()).toBe("legacy-space");
    expect(sessionStorage.getItem(API_KEY_KEY)).toBe("legacy-space");
    expect(sessionStorage.getItem(LAST_ACTIVE_KEY)).toBe("123");
    expect(sessionStorage.getItem(SPACE_ID_KEY)).toBeNull();
  });

  it("migrates a legacy remembered key into the new api key slot", () => {
    const expiresAt = Date.now() + 10_000;

    localStorage.setItem(
      REMEMBERED_SPACE_KEY,
      JSON.stringify({
        expiresAt,
        spaceId: "legacy-remembered-space",
      }),
    );

    expect(restoreRememberedApiKey()).toBe("legacy-remembered-space");
    expect(getApiKey()).toBe("legacy-remembered-space");
    expect(localStorage.getItem(REMEMBERED_API_KEY)).toBe(
      JSON.stringify({
        apiKey: "legacy-remembered-space",
        expiresAt,
      }),
    );
    expect(localStorage.getItem(REMEMBERED_SPACE_KEY)).toBeNull();
  });

  it("prefers the new api key when both new and legacy session keys exist", () => {
    sessionStorage.setItem(API_KEY_KEY, "new-space");
    sessionStorage.setItem(SPACE_ID_KEY, "legacy-space");

    expect(getApiKey()).toBe("new-space");
    expect(sessionStorage.getItem(SPACE_ID_KEY)).toBeNull();
  });

  it("prefers the new remembered api key when both remembered keys exist", () => {
    localStorage.setItem(
      REMEMBERED_API_KEY,
      JSON.stringify({
        apiKey: "new-space",
        expiresAt: Date.now() + 10_000,
      }),
    );
    localStorage.setItem(
      REMEMBERED_SPACE_KEY,
      JSON.stringify({
        expiresAt: Date.now() + 10_000,
        spaceId: "legacy-space",
      }),
    );

    expect(restoreRememberedApiKey()).toBe("new-space");
    expect(localStorage.getItem(REMEMBERED_SPACE_KEY)).toBeNull();
  });

  it("writes through to new keys and clears legacy copies", () => {
    sessionStorage.setItem(SPACE_ID_KEY, "legacy-space");
    localStorage.setItem(
      REMEMBERED_SPACE_KEY,
      JSON.stringify({
        expiresAt: Date.now() + 10_000,
        spaceId: "legacy-space",
      }),
    );

    setSpaceId("fresh-space", true);

    expect(sessionStorage.getItem(API_KEY_KEY)).toBe("fresh-space");
    expect(sessionStorage.getItem(SPACE_ID_KEY)).toBeNull();
    expect(localStorage.getItem(REMEMBERED_API_KEY)).toBeTruthy();
    expect(localStorage.getItem(REMEMBERED_SPACE_KEY)).toBeNull();
  });
});
