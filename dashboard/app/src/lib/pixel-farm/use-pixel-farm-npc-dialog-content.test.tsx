import "@/i18n";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analysisApi } from "@/api/analysis-client";
import { readCachedAnalysisResult } from "@/api/local-cache";
import { usePixelFarmNpcDialogContent } from "./use-pixel-farm-npc-dialog-content";

const mocks = vi.hoisted(() => ({
  readCachedAnalysisResult: vi.fn(),
  listDeepAnalysisReports: vi.fn(),
  getDeepAnalysisReport: vi.fn(),
}));

vi.mock("@/api/local-cache", () => ({
  readCachedAnalysisResult: mocks.readCachedAnalysisResult,
}));

vi.mock("@/api/analysis-client", async () => {
  const actual = await vi.importActual<typeof import("@/api/analysis-client")>(
    "@/api/analysis-client",
  );
  return {
    ...actual,
    analysisApi: {
      ...actual.analysisApi,
      listDeepAnalysisReports: mocks.listDeepAnalysisReports,
      getDeepAnalysisReport: mocks.getDeepAnalysisReport,
    },
  };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe("use-pixel-farm-npc-dialog-content", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns deep-analysis-backed content when a completed report exists", async () => {
    vi.mocked(readCachedAnalysisResult).mockResolvedValue({
      fingerprint: "fp",
      jobId: "aj_1",
      updatedAt: "2026-04-04T00:00:00.000Z",
      taxonomyVersion: "v3",
      snapshot: null,
    });
    vi.mocked(analysisApi.listDeepAnalysisReports).mockResolvedValue({
      reports: [{
        id: "dar_1",
        status: "COMPLETED",
        stage: "COMPLETE",
        progressPercent: 100,
        lang: "en",
        timezone: "Asia/Shanghai",
        memoryCount: 42,
        requestedAt: "2026-04-04T00:00:00.000Z",
        preview: null,
      }],
      total: 1,
      limit: 20,
      offset: 0,
    });
    vi.mocked(analysisApi.getDeepAnalysisReport).mockResolvedValue({
      id: "dar_1",
      status: "COMPLETED",
      stage: "COMPLETE",
      progressPercent: 100,
      lang: "en",
      timezone: "Asia/Shanghai",
      memoryCount: 42,
      requestedAt: "2026-04-04T00:00:00.000Z",
      preview: null,
      report: {
        overview: {
          memoryCount: 42,
          deduplicatedMemoryCount: 40,
          generatedAt: "2026-04-04T00:00:00.000Z",
          lang: "en",
          timeSpan: { start: null, end: null },
        },
        persona: { summary: "release prep" },
        themeLandscape: { highlights: [] },
        entities: { people: [], teams: [], projects: [], tools: [], places: [] },
        relationships: [],
        quality: {
          duplicateRatio: 0,
          noisyMemoryCount: 0,
          duplicateClusters: [],
          lowQualityExamples: [],
          coverageGaps: [],
        },
        recommendations: [],
        productSignals: { candidateNodes: [], candidateEdges: [], searchSeeds: [] },
      },
    });

    const { result } = renderHook(
      () => usePixelFarmNpcDialogContent("space-1"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.catalog.deepInsights.length).toBeGreaterThan(0);
    });
  });

  it("keeps tips available when no analysis source exists", async () => {
    vi.mocked(readCachedAnalysisResult).mockResolvedValue(null);
    vi.mocked(analysisApi.listDeepAnalysisReports).mockResolvedValue({
      reports: [],
      total: 0,
      limit: 20,
      offset: 0,
    });

    const { result } = renderHook(
      () => usePixelFarmNpcDialogContent("space-1"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.catalog.tips.length).toBeGreaterThan(0);
    });
  });
});
