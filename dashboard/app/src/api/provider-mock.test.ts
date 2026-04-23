import { describe, expect, it } from "vitest";

import { mockProvider } from "./provider-mock";

describe("mockProvider", () => {
  it("uses MEM9_API_KEY wording for connect validation errors", async () => {
    await expect(mockProvider.verifySpace("short")).rejects.toThrow(
      "Cannot access this memory. Check your MEM9_API_KEY and try again.",
    );
  });
});
