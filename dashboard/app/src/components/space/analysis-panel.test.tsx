import { fireEvent, render, screen, within } from "@testing-library/react";
import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";
import { AnalysisPanel } from "./analysis-panel";
import type {
  AnalysisFacetStat,
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

function createFacetStats(
  entries: Array<[string, number]>,
): AnalysisFacetStat[] {
  return entries.map(([value, count]) => ({
    value,
    count,
  }));
}

function createSnapshot(
  overrides: Partial<AnalysisJobSnapshotResponse> = {},
): AnalysisJobSnapshotResponse {
  const topTagStats = createFacetStats([["priority", 3]]);
  const topTopicStats = createFacetStats([["agents", 2]]);

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
      tagCounts: { priority: 3 },
      topicCounts: { agents: 2 },
      summarySnapshot: ["identity:1", "preference:1"],
      resultVersion: 1,
    },
    aggregateCards: [
      { category: "identity", count: 1, confidence: 0.5 },
      { category: "preference", count: 1, confidence: 0.5 },
    ],
    topTagStats,
    topTopicStats,
    topTags: topTagStats.map((stat) => stat.value),
    topTopics: topTopicStats.map((stat) => stat.value),
    batchSummaries: [
      {
        batchIndex: 1,
        status: "SUCCEEDED",
        memoryCount: 2,
        processedMemories: 2,
        topCategories: [{ category: "identity", count: 1, confidence: 0.5 }],
        topTags: ["priority"],
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

const noop = () => {};

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
    const onSelectTag = vi.fn();
    render(
      <AnalysisPanel
        state={createState({ phase: "uploading" })}
        sourceCount={4}
        sourceLoading={false}
        taxonomy={null}
        taxonomyUnavailable={false}
        cards={createSnapshot().aggregateCards}
        onSelectCategory={onSelectCategory}
        onSelectTag={onSelectTag}
        onRetry={noop}
        t={t}
      />,
    );

    expect(screen.getByText("analysis.title")).toBeInTheDocument();
    expect(screen.getByText("analysis.phase.uploading")).toBeInTheDocument();
    expect(screen.getByText("analysis.cards")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "priority (3)" })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "priority (3)" }));
    expect(onSelectTag).toHaveBeenCalledWith("priority");
  });

  it("uses uploaded batches for uploading progress", () => {
    const { container } = render(
      <AnalysisPanel
        state={createState({
          phase: "uploading",
          snapshot: createSnapshot({
            progress: {
              expectedTotalBatches: 2,
              uploadedBatches: 1,
              completedBatches: 0,
              failedBatches: 0,
              processedMemories: 0,
              resultVersion: 1,
            },
          }),
        })}
        sourceCount={4}
        sourceLoading={false}
        taxonomy={null}
        taxonomyUnavailable={false}
        cards={createSnapshot().aggregateCards}
        onSelectCategory={noop}
        onSelectTag={noop}
        onRetry={noop}
        t={t}
      />,
    );

    expect(screen.getByText("analysis.batch_summary.syncing:1/2")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="progress-indicator"]'),
    ).toHaveStyle({
      transform: "translateX(-50%)",
    });
  });

  it("renders completed state with collapsible run details", () => {
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
        onSelectCategory={noop}
        onSelectTag={noop}
        onRetry={noop}
        t={t}
      />,
    );

    expect(screen.getByText("analysis.run_details")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "analysis.reanalyze" }),
    ).not.toBeInTheDocument();

    const runDetailsSection = screen
      .getByText("analysis.run_details")
      .closest("section");

    expect(runDetailsSection).not.toBeNull();

    fireEvent.click(
      within(runDetailsSection!).getByRole("button", {
        name: "analysis.expand_section",
      }),
    );

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
        onSelectCategory={noop}
        onSelectTag={noop}
        onRetry={noop}
        t={t}
      />,
    );

    expect(screen.getByText("analysis.degraded_title")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "analysis.retry" }),
    ).toBeInTheDocument();
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
        onSelectCategory={noop}
        onSelectTag={noop}
        onRetry={noop}
        t={t}
      />,
    );

    expect(screen.getByText("analysis.empty")).toBeInTheDocument();
  });

  it("shows 8 facet items by default and expands to the full list", async () => {
    const tagStats = createFacetStats([
      ["tag-1", 9],
      ["tag-2", 8],
      ["tag-3", 7],
      ["tag-4", 6],
      ["tag-5", 5],
      ["tag-6", 4],
      ["tag-7", 3],
      ["tag-8", 2],
      ["tag-9", 1],
    ]);

    render(
      <AnalysisPanel
        state={createState({
          snapshot: createSnapshot({
            aggregate: {
              categoryCounts: {
                identity: 1,
                emotion: 0,
                preference: 1,
                experience: 0,
                activity: 0,
              },
              tagCounts: Object.fromEntries(
                tagStats.map((stat) => [stat.value, stat.count]),
              ),
              topicCounts: {},
              summarySnapshot: ["identity:1", "preference:1"],
              resultVersion: 1,
            },
            topTagStats: tagStats,
            topTopicStats: [],
            topTags: tagStats.map((stat) => stat.value),
            topTopics: [],
          }),
        })}
        sourceCount={4}
        sourceLoading={false}
        taxonomy={null}
        taxonomyUnavailable={false}
        cards={createSnapshot().aggregateCards}
        onSelectCategory={noop}
        onSelectTag={noop}
        onRetry={noop}
        t={t}
      />,
    );

    const container = screen.getByTestId("analysis-facets-tags");
    const expandButton = await screen.findByRole("button", {
      name: "analysis.more",
    });

    expect(expandButton).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "tag-8 (2)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "tag-9 (1)" })).not.toBeInTheDocument();
    expect(container.children).toHaveLength(8);

    fireEvent.click(expandButton);
    expect(
      screen.getByRole("button", { name: "analysis.less" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "tag-9 (1)" })).toBeInTheDocument();
    expect(container.children).toHaveLength(9);

    fireEvent.click(screen.getByRole("button", { name: "analysis.less" }));
    expect(
      screen.getByRole("button", { name: "analysis.more" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "tag-9 (1)" })).not.toBeInTheDocument();
    expect(container.children).toHaveLength(8);
  });

  it("does not show more when facet count is 8 or fewer", () => {
    const tagStats = createFacetStats([
      ["tag-1", 9],
      ["tag-2", 8],
      ["tag-3", 7],
      ["tag-4", 6],
      ["tag-5", 5],
      ["tag-6", 4],
      ["tag-7", 3],
      ["tag-8", 2],
    ]);

    render(
      <AnalysisPanel
        state={createState({
          snapshot: createSnapshot({
            aggregate: {
              categoryCounts: {
                identity: 1,
                emotion: 0,
                preference: 1,
                experience: 0,
                activity: 0,
              },
              tagCounts: Object.fromEntries(
                tagStats.map((stat) => [stat.value, stat.count]),
              ),
              topicCounts: {},
              summarySnapshot: ["identity:1", "preference:1"],
              resultVersion: 1,
            },
            topTagStats: tagStats,
            topTopicStats: [],
            topTags: tagStats.map((stat) => stat.value),
            topTopics: [],
          }),
        })}
        sourceCount={4}
        sourceLoading={false}
        taxonomy={null}
        taxonomyUnavailable={false}
        cards={createSnapshot().aggregateCards}
        onSelectCategory={noop}
        onSelectTag={noop}
        onRetry={noop}
        t={t}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "analysis.more" }),
    ).not.toBeInTheDocument();
  });
});
