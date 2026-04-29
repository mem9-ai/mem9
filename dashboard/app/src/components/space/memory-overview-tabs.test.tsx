import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { MemoryOverviewTabs } from "./memory-overview-tabs";
import {
  buildInsightEntityNodeId,
  buildInsightMemoryNodeId,
  buildInsightTagNodeId,
} from "@/lib/memory-insight";
import type { MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

vi.mock("@/components/space/deep-analysis-tab", () => ({
  DeepAnalysisTab: ({
    spaceId,
    active,
  }: {
    spaceId: string;
    active: boolean;
  }) => <div data-testid="deep-analysis-tab">{`${spaceId}:${String(active)}`}</div>,
}));

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

afterEach(() => {
  setViewportWidth(ORIGINAL_INNER_WIDTH);
});

function createMemory(id: string): Memory {
  return {
    id,
    content: "A memory about `mem9-ui` and @alice",
    memory_type: "insight",
    source: "agent",
    tags: ["graph"],
    metadata: null,
    agent_id: "agent",
    session_id: "session",
    state: "active",
    version: 1,
    updated_by: "agent",
    created_at: "2026-03-10T00:00:00Z",
    updated_at: "2026-03-10T00:00:00Z",
  };
}

describe("MemoryOverviewTabs", () => {
  it("defaults to Memory Pulse and resets all local insight lanes when leaving the insight tab", async () => {
    setViewportWidth(1400);
    const memory = createMemory("mem-1");
    const secondMemory = createMemory("mem-2");
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      [
        memory.id,
        {
          memoryId: memory.id,
          categories: ["activity"],
          categoryScores: { activity: 1 },
        },
      ],
      [
        secondMemory.id,
        {
          memoryId: secondMemory.id,
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ],
    ]);

    render(
      <MemoryOverviewTabs
        spaceId="space-1"
        stats={{ total: 2, pinned: 0, insight: 2 }}
        pulseMemories={[memory, secondMemory]}
        insightMemories={[memory, secondMemory]}
        cards={[
          { category: "activity", count: 1, confidence: 1 },
          { category: "project", count: 1, confidence: 1 },
        ]}
        snapshot={null}
        range="all"
        loading={false}
        compact={false}
        matchMap={matchMap}
        onTypeSelect={() => {}}
        onTagSelect={() => {}}
        onMemorySelect={() => {}}
        onTimelineSelect={() => {}}
      />,
    );

    expect(screen.getByRole("tab", { name: "Memory Pulse" })).toHaveAttribute(
      "data-state",
      "active",
    );

    const insightTab = screen.getByRole("tab", { name: "Memory Insight" });
    insightTab.focus();
    fireEvent.keyDown(insightTab, { key: "Enter" });

    expect(
      await screen.findByTestId("memory-insight-overview"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("insight-node-card:activity"));
    fireEvent.click(screen.getByTestId("insight-node-card:project"));
    expect(
      await screen.findByTestId(`insight-node-${buildInsightTagNodeId("activity", "graph")}`),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId(`insight-node-${buildInsightTagNodeId("project", "graph")}`),
    ).toBeInTheDocument();
    expect(screen.getByTestId("memory-insight-canvas-viewport")).toBeInTheDocument();

    const pulseTab = screen.getByRole("tab", { name: "Memory Pulse" });
    pulseTab.focus();
    fireEvent.keyDown(pulseTab, { key: "Enter" });

    insightTab.focus();
    fireEvent.keyDown(insightTab, { key: "Enter" });

    expect(
      screen.queryByTestId(`insight-node-${buildInsightTagNodeId("activity", "graph")}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`insight-node-${buildInsightTagNodeId("project", "graph")}`),
    ).not.toBeInTheDocument();
  });

  it("forwards insight leaf clicks as insight-sourced memory selections", async () => {
    setViewportWidth(1400);
    const onMemorySelect = vi.fn();
    const memory: Memory = {
      ...createMemory("mem-insight-1"),
      content: "Deploy `mem9-ui` with Alice Johnson",
      tags: ["graph"],
    };
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      [
        memory.id,
        {
          memoryId: memory.id,
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ],
    ]);

    render(
      <MemoryOverviewTabs
        spaceId="space-1"
        stats={{ total: 1, pinned: 0, insight: 1 }}
        pulseMemories={[memory]}
        insightMemories={[memory]}
        cards={[{ category: "project", count: 1, confidence: 1 }]}
        snapshot={null}
        range="all"
        loading={false}
        compact={false}
        matchMap={matchMap}
        onTypeSelect={() => {}}
        onTagSelect={() => {}}
        onMemorySelect={onMemorySelect}
        onTimelineSelect={() => {}}
      />,
    );

    const insightTab = screen.getByRole("tab", { name: "Memory Insight" });
    insightTab.focus();
    fireEvent.keyDown(insightTab, { key: "Enter" });

    fireEvent.click(await screen.findByTestId("insight-node-card:project"));
    fireEvent.click(
      await screen.findByTestId(`insight-node-${buildInsightTagNodeId("project", "graph")}`),
    );
    fireEvent.click(
      await screen.findByTestId(
        `insight-node-${buildInsightEntityNodeId(
          "project",
          "graph",
          "named_term",
          "mem9-ui",
        )}`,
      ),
    );
    fireEvent.click(
      await screen.findByTestId(
        `insight-node-${buildInsightMemoryNodeId(
          "project",
          "graph",
          "named_term",
          "mem9-ui",
          "mem-insight-1",
        )}`,
      ),
    );

    expect(onMemorySelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mem-insight-1" }),
      "insight",
    );
  });

  it("exposes the Memory Analysis tab and mounts the analysis content on selection", () => {
    setViewportWidth(1400);
    render(
      <MemoryOverviewTabs
        spaceId="space-1"
        stats={{ total: 0, pinned: 0, insight: 0 }}
        pulseMemories={[]}
        insightMemories={[]}
        cards={[]}
        snapshot={null}
        range="all"
        loading={false}
        compact={false}
        matchMap={new Map()}
        onTypeSelect={() => {}}
        onTagSelect={() => {}}
        onMemorySelect={() => {}}
        onTimelineSelect={() => {}}
      />,
    );

    expect(screen.queryByTestId("deep-analysis-tab")).not.toBeInTheDocument();

    const analysisTab = screen.getByRole("tab", { name: "Memory Analysis" });
    analysisTab.focus();
    fireEvent.keyDown(analysisTab, { key: "Enter" });

    expect(screen.getByTestId("deep-analysis-tab")).toHaveTextContent("space-1:true");

    const pulseTab = screen.getByRole("tab", { name: "Memory Pulse" });
    pulseTab.focus();
    fireEvent.keyDown(pulseTab, { key: "Enter" });

    expect(screen.getByTestId("deep-analysis-tab")).toHaveTextContent("space-1:false");
  });

  it("renders short labels and replaces the insight workspace with a desktop redirect on mobile", () => {
    setViewportWidth(390);
    const memory = createMemory("mem-mobile-1");

    render(
      <MemoryOverviewTabs
        spaceId="space-mobile"
        stats={{ total: 1, pinned: 0, insight: 1 }}
        pulseMemories={[memory]}
        insightMemories={[memory]}
        cards={[{ category: "project", count: 1, confidence: 1 }]}
        snapshot={null}
        range="all"
        loading={false}
        compact={false}
        matchMap={new Map()}
        onTypeSelect={() => {}}
        onTagSelect={() => {}}
        onMemorySelect={() => {}}
        onTimelineSelect={() => {}}
      />,
    );

    expect(screen.getByTestId("memory-overview-tab-pulse")).toHaveTextContent("Pulse");
    expect(screen.getByTestId("memory-overview-tab-insight")).toHaveTextContent("Insight");
    expect(screen.getByTestId("memory-overview-tab-analysis")).toHaveTextContent("Analysis");

    expect(screen.getByRole("tab", { name: "Memory Pulse" })).toBe(
      screen.getByTestId("memory-overview-tab-pulse"),
    );

    const insightTab = screen.getByTestId("memory-overview-tab-insight");
    insightTab.focus();
    fireEvent.keyDown(insightTab, { key: "Enter" });

    expect(
      screen.getByTestId("memory-insight-desktop-only-hint"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("memory-insight-overview")).not.toBeInTheDocument();
  });

  it("renders the full Memory Insight workspace at iPad mini landscape width (1024px)", async () => {
    // 1024px is the floor for `useIsLargeViewport`. iPads in landscape report
    // exactly this width (or wider), so we expect the full workspace, the
    // desktop tab styling, and the long "Memory ___" labels — not the mobile
    // segmented control / redirect hint.
    setViewportWidth(1024);
    const memory = createMemory("mem-tablet-1");
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      [
        memory.id,
        {
          memoryId: memory.id,
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ],
    ]);

    render(
      <MemoryOverviewTabs
        spaceId="space-tablet"
        stats={{ total: 1, pinned: 0, insight: 1 }}
        pulseMemories={[memory]}
        insightMemories={[memory]}
        cards={[{ category: "project", count: 1, confidence: 1 }]}
        snapshot={null}
        range="all"
        loading={false}
        compact={false}
        matchMap={matchMap}
        onTypeSelect={() => {}}
        onTagSelect={() => {}}
        onMemorySelect={() => {}}
        onTimelineSelect={() => {}}
      />,
    );

    expect(screen.queryByTestId("memory-overview-tab-insight")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Memory Insight" })).toBeInTheDocument();

    const insightTab = screen.getByRole("tab", { name: "Memory Insight" });
    insightTab.focus();
    fireEvent.keyDown(insightTab, { key: "Enter" });

    expect(
      await screen.findByTestId("memory-insight-overview"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("memory-insight-desktop-only-hint"),
    ).not.toBeInTheDocument();
  });

  it("swaps the insight workspace for the redirect hint when the viewport shrinks below the large breakpoint", async () => {
    setViewportWidth(1400);
    const memory = createMemory("mem-resize-1");
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      [
        memory.id,
        {
          memoryId: memory.id,
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ],
    ]);

    render(
      <MemoryOverviewTabs
        spaceId="space-resize"
        stats={{ total: 1, pinned: 0, insight: 1 }}
        pulseMemories={[memory]}
        insightMemories={[memory]}
        cards={[{ category: "project", count: 1, confidence: 1 }]}
        snapshot={null}
        range="all"
        loading={false}
        compact={false}
        matchMap={matchMap}
        onTypeSelect={() => {}}
        onTagSelect={() => {}}
        onMemorySelect={() => {}}
        onTimelineSelect={() => {}}
      />,
    );

    const insightTab = screen.getByRole("tab", { name: "Memory Insight" });
    insightTab.focus();
    fireEvent.keyDown(insightTab, { key: "Enter" });

    expect(
      await screen.findByTestId("memory-insight-overview"),
    ).toBeInTheDocument();

    setViewportWidth(390);
    fireEvent(window, new Event("resize"));

    expect(
      await screen.findByTestId("memory-insight-desktop-only-hint"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("memory-insight-overview")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Memory Insight" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });
});
