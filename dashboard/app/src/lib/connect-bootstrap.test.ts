import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeConnectBootstrapFromLocation,
  parseConnectBootstrapFromLocation,
  resetConnectBootstrapForTests,
} from "./connect-bootstrap";

afterEach(() => {
  resetConnectBootstrapForTests();
});

describe("connect bootstrap helpers", () => {
  it("prefers key over id when both params are present", () => {
    const parsed = parseConnectBootstrapFromLocation(
      new URL("https://mem9.ai/your-memory?id=space-id&key=space-key"),
    );

    expect(parsed.state).toEqual({
      autoConnectKey: "space-key",
      hasBootstrapParams: true,
      initialInput: "space-key",
    });
    expect(parsed.sanitizedURL).toBe("/your-memory");
  });

  it("ignores empty params after trimming", () => {
    const parsed = parseConnectBootstrapFromLocation(
      new URL("https://mem9.ai/your-memory?id=%20space-id%20&key=%20%20"),
    );

    expect(parsed.state).toEqual({
      autoConnectKey: null,
      hasBootstrapParams: true,
      initialInput: "space-id",
    });
    expect(parsed.sanitizedURL).toBe("/your-memory");
  });

  it("removes sensitive params while preserving other search params and hash", () => {
    const replaceState = vi.fn();
    const history = {
      replaceState,
      state: { from: "test" },
    };

    initializeConnectBootstrapFromLocation({
      history,
      location: new URL(
        "https://mem9.ai/your-memory?id=space-id&foo=1&bar=2#details",
      ),
    });

    expect(replaceState).toHaveBeenCalledWith(
      history.state,
      "",
      "/your-memory?foo=1&bar=2#details",
    );
  });
});
