import { fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";
import { AnalysisPanel } from "./analysis-panel";
import type {
  AnalysisJobSnapshotResponse,
  SpaceAnalysisState,
} from "@/types/analysis";

const t = vi.fn((key: string, options?: Record<string, unknown>) => {
  if (options?.version) return `${key}:${options.version}`;
  if (options?.index) return `${key}:${options.index}`;
  if (options?.count) return `${key}:${options.count}`;
  if (options?.value) return `${key}:${options.value}`;
  if (options?.current && options?.total) {
    return `${key}:${options.current}/${options.total}`;
  }
  return key;
}) as unknown as TFunction;

function createSnapshot(
  overrides: Partial<AnalysisJobSnapshotResponse> = {},
): AnalysisJobSnapshotResponse {
  return {
    jobId: "aj_1",
    status: "PROCESSING",
    expectedTotalMemories: 4,
    expectedTotalBatches: 2,
    batchSize: 2,
    pipelineVersion: "v1",
    taxonomyVersion: "v2",
    llmEnabled: true,
    createdAt: "2026-03-03T00:00:00Z",
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    progress: {
      expectedTotalBatches: 2,
      uploadedBatches: 2,
      completedBatches: 1,
      failedBatches: 0,
      processedMemories: 2,
      resultVersion: 1,
    },
    aggregate: {
      categoryCounts: {
        identity: 1,
        emotion: 0,
        preference: 1,
        experience: 0,
        activity: 0,
      },
      tagCounts: { ai: 2 },
      topicCounts: { agents: 2 },
      summarySnapshot: ["identity:1", "preference:1"],
      resultVersion: 1,
    },
    aggregateCards: [
      { category: "identity", count: 1, confidence: 0.5 },
      { category: "preference", count: 1, confidence: 0.5 },
    ],
    topTags: ["ai"],
    topTopics: ["agents"],
    batchSummaries: [
      {
        batchIndex: 1,
        status: "SUCCEEDED",
        memoryCount: 2,
        processedMemories: 2,
        topCategories: [{ category: "identity", count: 1, confidence: 0.5 }],
        topTags: ["ai"],
      },
      {
        batchIndex: 2,
        status: "QUEUED",
        memoryCount: 2,
        processedMemories: 0,
        topCategories: [],
        topTags: [],
      },
    ],
    ...overrides,
  };
}

function createState(
  overrides: Partial<SpaceAnalysisState> = {},
): SpaceAnalysisState {
  return {
    phase: "processing",
    snapshot: createSnapshot(),
    events: [
      {
        version: 1,
        type: "batch_completed",
        timestamp: "2026-03-03T00:00:00Z",
        jobId: "aj_1",
        batchIndex: 1,
        message: "Batch 1 completed",
      },
    ],
    cursor: 1,
    error: null,
    warning: null,
    jobId: "aj_1",
    fingerprint: "fp",
    pollAfterMs: 1500,
    isRetrying: false,
    ...overrides,
  };
}

describe("AnalysisPanel", () => {
  it("renders processing state with aggregate data", () => {
    const onSelectCategory = vi.fn();
    render(
      <AnalysisPanel
        state={createState({ phase: "uploading" })}
        sourceCount={4}
        sourceLoading={false}
        taxonomy={null}
        taxonomyUnavailable={false}
        cards={createSnapshot().aggregateCards}
        onSelectCategory={onSelectCategory}
        onRetry={() => {}}
        t={t}
      />,
    );

    expect(screen.getByText("analysis.title")).toBeInTheDocument();
    expect(screen.getByText("analysis.phase.uploading")).toBeInTheDocument();
    expect(screen.getByText("analysis.cards")).toBeInTheDocument();
    expect(screen.getByText("analysis.top_topics")).toBeInTheDocument();
    expect(
      screen.getByText("analysis.batch_summary.syncing:2/2"),
    ).toBeInTheDocument();
    expect(screen.queryByText("analysis.batch_label:1")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /analysis\.category\.preference/,
      }),
    );
    expect(onSelectCategory).toHaveBeenCalledWith("preference");
  });

  it("renders completed state with recent updates", () => {
    render(
      <AnalysisPanel
        state={createState({
          phase: "completed",
          snapshot: createSnapshot({ status: "COMPLETED" }),
        })}
        sourceCount={4}
        sourceLoading={false}
        taxonomy={{ version: "v2", updatedAt: "", categories: [], rules: [] }}
        taxonomyUnavailable={false}
        cards={createSnapshot().aggregateCards}
        onSelectCategory={() => {}}
        onRetry={() => {}}
        t={t}
      />,
    );

    expect(screen.getByText("analysis.phase.completed")).toBeInTheDocument();
    expect(screen.getByText("Batch 1 completed")).toBeInTheDocument();
    expect(screen.getByText("analysis.taxonomy_version:v2")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "analysis.reanalyze" }),
    ).toBeInTheDocument();
  });

  it("renders degraded state with retry action", () => {
    render(
      <AnalysisPanel
        state={createState({
          phase: "degraded",
          snapshot: null,
          events: [],
          error: "analysis_unavailable",
          jobId: null,
          fingerprint: null,
        })}
        sourceCount={2}
        sourceLoading={false}
        taxonomy={null}
        taxonomyUnavailable={true}
        cards={[]}
        onSelectCategory={() => {}}
        onRetry={() => {}}
        t={t}
      />,
    );

    expect(screen.getByText("analysis.degraded_title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "analysis.retry" })).toBeInTheDocument();
  });

  it("renders empty state when there are no memories in range", () => {
    render(
      <AnalysisPanel
        state={createState({
          phase: "completed",
          snapshot: null,
          events: [],
          jobId: null,
          fingerprint: null,
        })}
        sourceCount={0}
        sourceLoading={false}
        taxonomy={null}
        taxonomyUnavailable={false}
        cards={[]}
        onSelectCategory={() => {}}
        onRetry={() => {}}
        t={t}
      />,
    );

    expect(screen.getByText("analysis.empty")).toBeInTheDocument();
  });
});
