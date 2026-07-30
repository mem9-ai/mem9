import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDeepAnalysisReports } from "./deep-analysis-queries";

const mocks = vi.hoisted(() => ({
  listDeepAnalysisReports: vi.fn(),
  getDeepAnalysisReport: vi.fn(),
  createDeepAnalysisReport: vi.fn(),
}));

vi.mock("./analysis-client", () => ({
  analysisApi: {
    listDeepAnalysisReports: mocks.listDeepAnalysisReports,
    getDeepAnalysisReport: mocks.getDeepAnalysisReport,
    createDeepAnalysisReport: mocks.createDeepAnalysisReport,
  },
  AnalysisApiError: class AnalysisApiError extends Error {},
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
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

describe("useDeepAnalysisReports", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not trigger list or detail requests while inactive", async () => {
    mocks.listDeepAnalysisReports.mockResolvedValue({
      reports: [
        {
          id: "dar_1",
          status: "COMPLETED",
          stage: "COMPLETE",
          progressPercent: 100,
          lang: "en",
          timezone: "UTC",
          memoryCount: 10,
          requestedAt: "2026-03-28T00:00:00Z",
          startedAt: "2026-03-28T00:00:01Z",
          completedAt: "2026-03-28T00:05:00Z",
          errorCode: null,
          errorMessage: null,
          preview: null,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });
    mocks.getDeepAnalysisReport.mockResolvedValue({
      id: "dar_1",
      status: "COMPLETED",
      stage: "COMPLETE",
      progressPercent: 100,
      lang: "en",
      timezone: "UTC",
      memoryCount: 10,
      requestedAt: "2026-03-28T00:00:00Z",
      startedAt: "2026-03-28T00:00:01Z",
      completedAt: "2026-03-28T00:05:00Z",
      errorCode: null,
      errorMessage: null,
      preview: null,
      report: null,
    });

    const { rerender } = renderHook(
      ({ active }) => useDeepAnalysisReports("space-1", active),
      {
        initialProps: { active: false },
        wrapper: createWrapper(),
      },
    );

    expect(mocks.listDeepAnalysisReports).not.toHaveBeenCalled();
    expect(mocks.getDeepAnalysisReport).not.toHaveBeenCalled();

    rerender({ active: true });

    await waitFor(() => {
      expect(mocks.listDeepAnalysisReports).toHaveBeenCalledWith(
        "space-1",
        20,
        0,
        expect.any(AbortSignal),
      );
      expect(mocks.getDeepAnalysisReport).toHaveBeenCalledWith(
        "space-1",
        "dar_1",
        expect.any(AbortSignal),
      );
    });
  });

  it("starts loading immediately when active on mount", async () => {
    mocks.listDeepAnalysisReports.mockResolvedValue({
      reports: [
        {
          id: "dar_2",
          status: "ANALYZING",
          stage: "CHUNK_ANALYSIS",
          progressPercent: 25,
          lang: "zh-CN",
          timezone: "Asia/Shanghai",
          memoryCount: 20,
          requestedAt: "2026-03-28T01:00:00Z",
          startedAt: "2026-03-28T01:00:01Z",
          completedAt: null,
          errorCode: null,
          errorMessage: null,
          preview: null,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });
    mocks.getDeepAnalysisReport.mockResolvedValue({
      id: "dar_2",
      status: "ANALYZING",
      stage: "CHUNK_ANALYSIS",
      progressPercent: 25,
      lang: "zh-CN",
      timezone: "Asia/Shanghai",
      memoryCount: 20,
      requestedAt: "2026-03-28T01:00:00Z",
      startedAt: "2026-03-28T01:00:01Z",
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      preview: null,
      report: null,
    });

    renderHook(() => useDeepAnalysisReports("space-1", true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mocks.listDeepAnalysisReports).toHaveBeenCalledTimes(1);
      expect(mocks.getDeepAnalysisReport).toHaveBeenCalledTimes(1);
    });
  });
});
