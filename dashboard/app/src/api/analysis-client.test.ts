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
        taxonomyVersion: "v3",
        llmEnabled: false,
        includeItems: true,
        includeSummary: true,
      },
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("calls the deep-analysis create endpoint with the same auth header contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          reportId: "dar_1",
          status: "QUEUED",
          stage: "FETCH_SOURCE",
          progressPercent: 0,
          requestedAt: "2026-03-28T00:00:00Z",
          memoryCount: 1001,
        }),
        {
          status: 202,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await analysisApi.createDeepAnalysisReport("space-1", {
      lang: "zh-CN",
      timezone: "Asia/Shanghai",
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    expect(String(url)).toContain("/v1/deep-analysis/reports");
    expect(init?.method).toBe("POST");
    expect(headers.get("x-mem9-api-key")).toBe("space-1");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("builds the deep-analysis list query string correctly", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          reports: [],
          total: 0,
          limit: 10,
          offset: 20,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await analysisApi.listDeepAnalysisReports("space-1", 10, 20);

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/v1/deep-analysis/reports?limit=10&offset=20");
  });

  it("downloads the duplicate cleanup csv with the same auth header contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("duplicateMemoryId,clusterIndex\nmem_2,1\n", {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      }),
    );

    const blob = await analysisApi.downloadDeepAnalysisDuplicatesCsv("space-1", "dar_1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    expect(String(url)).toContain("/v1/deep-analysis/reports/dar_1/duplicates.csv");
    expect(headers.get("x-mem9-api-key")).toBe("space-1");
    expect(blob).toBeTruthy();
  });
});
