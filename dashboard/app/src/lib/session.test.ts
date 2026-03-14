import { afterEach, describe, expect, it } from "vitest";
import {
  clearSpace,
  getActiveSpaceId,
  getSpaceId,
  restoreRememberedSpace,
  setSpaceId,
} from "./session";

const REMEMBERED_SPACE_KEY = "mem9-remembered-space";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("session helpers", () => {
  it("stores the active space in sessionStorage without remembering login", () => {
    setSpaceId("space-1");

    expect(getSpaceId()).toBe("space-1");
    expect(localStorage.getItem(REMEMBERED_SPACE_KEY)).toBeNull();
  });

  it("restores a remembered login into the current session", () => {
    setSpaceId("space-remembered", true);
    sessionStorage.clear();

    expect(restoreRememberedSpace()).toBe("space-remembered");
    expect(getSpaceId()).toBe("space-remembered");
    expect(getActiveSpaceId()).toBe("space-remembered");
  });

  it("drops expired remembered sessions", () => {
    localStorage.setItem(
      REMEMBERED_SPACE_KEY,
      JSON.stringify({
        spaceId: "space-expired",
        expiresAt: Date.now() - 1_000,
      }),
    );

    expect(restoreRememberedSpace()).toBeNull();
    expect(localStorage.getItem(REMEMBERED_SPACE_KEY)).toBeNull();
  });

  it("clears both session and remembered login", () => {
    setSpaceId("space-1", true);

    clearSpace();

    expect(getSpaceId()).toBeNull();
    expect(localStorage.getItem(REMEMBERED_SPACE_KEY)).toBeNull();
  });
});
