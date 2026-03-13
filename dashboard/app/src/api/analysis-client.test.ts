import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisApiError, analysisApi } from "./analysis-client";

describe("analysis client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws a typed error when a successful response is not valid JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>ok</html>", {
        status: 200,
        headers: {
          "Content-Type": "text/html",
        },
      }),
    );

    await expect(analysisApi.getTaxonomy("space-1", "v1")).rejects.toMatchObject({
      name: "AnalysisApiError",
      status: 200,
      message: "Analysis API returned an empty or invalid JSON response",
    } satisfies Partial<AnalysisApiError>);
  });
});
