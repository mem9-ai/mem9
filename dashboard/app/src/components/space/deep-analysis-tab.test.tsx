import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { DeepAnalysisTab } from "./deep-analysis-tab";

const mocks = vi.hoisted(() => ({
  useDeepAnalysisReports: vi.fn(),
}));

vi.mock("@/api/deep-analysis-queries", () => ({
  useDeepAnalysisReports: mocks.useDeepAnalysisReports,
}));

describe("DeepAnalysisTab", () => {
  it("renders the empty state and triggers deep analysis creation", () => {
    const createReport = vi.fn(async () => undefined);
    mocks.useDeepAnalysisReports.mockReturnValue({
      reports: [],
      selectedReport: null,
      selectedReportId: null,
      setSelectedReportId: vi.fn(),
      inlineError: null,
      clearInlineError: vi.fn(),
      isLoading: false,
      isCreating: false,
      createReport,
    });

    render(<DeepAnalysisTab spaceId="space-1" active />);

    expect(screen.getByText("No analysis reports yet")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Deep Analysis" })[0]!);
    expect(createReport).toHaveBeenCalledWith({
      lang: expect.any(String),
      timezone: expect.any(String),
    });
  });

  it("renders history cards and the selected in-progress report", () => {
    mocks.useDeepAnalysisReports.mockReturnValue({
      reports: [
        {
          id: "dar_latest",
          status: "ANALYZING",
          stage: "CHUNK_ANALYSIS",
          progressPercent: 42,
          lang: "en",
          timezone: "Asia/Shanghai",
          memoryCount: 1200,
          requestedAt: "2026-03-28T09:00:00Z",
          startedAt: "2026-03-28T09:01:00Z",
          completedAt: null,
          errorCode: null,
          errorMessage: null,
          preview: {
            generatedAt: "2026-03-28T09:00:00Z",
            summary: "Current report is synthesizing product and persona signals.",
            topThemes: ["product"],
            keyRecommendations: ["Deduplicate repeated notes"],
          },
        },
        {
          id: "dar_old",
          status: "COMPLETED",
          stage: "COMPLETE",
          progressPercent: 100,
          lang: "en",
          timezone: "Asia/Shanghai",
          memoryCount: 1100,
          requestedAt: "2026-03-27T09:00:00Z",
          startedAt: "2026-03-27T09:01:00Z",
          completedAt: "2026-03-27T09:05:00Z",
          errorCode: null,
          errorMessage: null,
          preview: {
            generatedAt: "2026-03-27T09:05:00Z",
            summary: "Previous report summary.",
            topThemes: ["engineering"],
            keyRecommendations: ["Capture more people signals"],
          },
        },
      ],
      selectedReport: {
        id: "dar_latest",
        status: "ANALYZING",
        stage: "CHUNK_ANALYSIS",
        progressPercent: 42,
        lang: "en",
        timezone: "Asia/Shanghai",
        memoryCount: 1200,
        requestedAt: "2026-03-28T09:00:00Z",
        startedAt: "2026-03-28T09:01:00Z",
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        preview: {
          generatedAt: "2026-03-28T09:00:00Z",
          summary: "Current report is synthesizing product and persona signals.",
          topThemes: ["product"],
          keyRecommendations: ["Deduplicate repeated notes"],
        },
        report: null,
      },
      selectedReportId: "dar_latest",
      setSelectedReportId: vi.fn(),
      inlineError: null,
      clearInlineError: vi.fn(),
      isLoading: false,
      isCreating: false,
      createReport: vi.fn(async () => undefined),
    });

    render(<DeepAnalysisTab spaceId="space-1" active />);

    expect(screen.getByText("Current report is synthesizing product and persona signals.")).toBeInTheDocument();
    expect(screen.getByText("Previous report summary.")).toBeInTheDocument();
    expect(screen.getByText("Chunk analysis")).toBeInTheDocument();
    expect(screen.getByText("The report is still running. This view refreshes automatically.")).toBeInTheDocument();
  });
});
