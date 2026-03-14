import { afterEach, describe, expect, it, vi } from "vitest";

import { analysisApi } from "./analysis-client";

describe("analysisApi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not send a JSON content-type header for finalize requests without a body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          jobId: "aj_1",
          status: "PROCESSING",
          uploadedBatches: 20,
          expectedTotalBatches: 20,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await analysisApi.finalizeJob("space-1", "aj_1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    expect(init?.method).toBe("POST");
    expect(headers.get("x-mem9-api-key")).toBe("space-1");
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("keeps the JSON content-type header for requests with a body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          jobId: "aj_1",
          status: "UPLOADING",
          expectedTotalBatches: 1,
          uploadConcurrency: 3,
          pollAfterMs: 1500,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await analysisApi.createJob("space-1", {
      dateRange: {
        start: "2026-03-01T00:00:00Z",
        end: "2026-03-02T00:00:00Z",
      },
      expectedTotalMemories: 1,
      expectedTotalBatches: 1,
      batchSize: 1,
      options: {
        lang: "zh-CN",
        taxonomyVersion: "v2",
        llmEnabled: false,
        includeItems: true,
        includeSummary: true,
      },
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});
