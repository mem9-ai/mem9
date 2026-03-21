import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { MemoryInsightOverview } from "./memory-insight-overview";
import type { AnalysisCategoryCard, MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

function createMemory(id: string, content: string, tags: string[]): Memory {
  return {
    id,
    content,
    memory_type: "insight",
    source: "agent",
    tags,
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

function renderInsight({
  compact = false,
  resetToken = 0,
  onMemorySelect = () => {},
  cards,
  memories,
  matchMap,
}: {
  compact?: boolean;
  resetToken?: number;
  onMemorySelect?: (memory: Memory) => void;
  cards: AnalysisCategoryCard[];
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
}) {
  return render(
    <MemoryInsightOverview
      cards={cards}
      memories={memories}
      matchMap={matchMap}
      compact={compact}
      resetToken={resetToken}
      onMemorySelect={onMemorySelect}
    />,
  );
}

describe("MemoryInsightOverview", () => {
  it("renders a single shared canvas and expands multiple cards without dedicated lane framing", async () => {
    const memories = [
      createMemory("project-1", "Deploy `mem9-ui` to Netlify with Alice Johnson", ["netlify"]),
      createMemory("project-2", "Track workflow metrics in 120ms", ["workflow"]),
      createMemory("activity-1", "Document @alice in daily notes", ["notes"]),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      [
        "project-1",
        {
          memoryId: "project-1",
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ],
      [
        "project-2",
        {
          memoryId: "project-2",
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ],
      [
        "activity-1",
        {
          memoryId: "activity-1",
          categories: ["activity"],
          categoryScores: { activity: 1 },
        },
      ],
    ]);

    renderInsight({
      cards: [
        { category: "project", count: 2, confidence: 1 },
        { category: "activity", count: 1, confidence: 1 },
      ],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("insight-node-card:project"));
    fireEvent.click(screen.getByTestId("insight-node-card:activity"));

    expect(await screen.findByTestId("insight-node-tag:project:netlify")).toBeInTheDocument();
    expect(screen.getByTestId("insight-node-tag:activity:notes")).toBeInTheDocument();
    expect(screen.getByTestId("memory-insight-canvas-viewport")).toBeInTheDocument();
    expect(screen.getByTestId("memory-insight-canvas-badge")).toHaveTextContent(
      "One shared canvas",
    );
    expect(screen.queryByTestId("memory-insight-lane-card:project")).not.toBeInTheDocument();
  });

  it("spreads root bubbles across a wider center-left region before expansion", () => {
    const memories = [
      createMemory("project-1", "Project memory", ["project"]),
      createMemory("profile-1", "Profile memory", ["profile"]),
      createMemory("plan-1", "Plan memory", ["plan"]),
      createMemory("policy-1", "Policy memory", ["policy"]),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["project-1", { memoryId: "project-1", categories: ["project"], categoryScores: { project: 1 } }],
      ["profile-1", { memoryId: "profile-1", categories: ["profile"], categoryScores: { profile: 1 } }],
      ["plan-1", { memoryId: "plan-1", categories: ["plan"], categoryScores: { plan: 1 } }],
      ["policy-1", { memoryId: "policy-1", categories: ["policy"], categoryScores: { policy: 1 } }],
    ]);

    renderInsight({
      cards: [
        { category: "project", count: 1, confidence: 1 },
        { category: "profile", count: 1, confidence: 1 },
        { category: "plan", count: 1, confidence: 1 },
        { category: "policy", count: 1, confidence: 1 },
      ],
      memories,
      matchMap,
    });

    const lefts = ["project", "profile", "plan", "policy"]
      .map((id) => screen.getByTestId(`insight-node-card:${id}`).style.left)
      .map((value) => Number.parseFloat(value));

    expect(Math.max(...lefts) - Math.min(...lefts)).toBeGreaterThan(160);
  });

  it("renders the top-right controls on one row in Fullscreen / Reset layout / Fit view order", () => {
    renderInsight({
      cards: [{ category: "project", count: 1, confidence: 1 }],
      memories: [createMemory("mem-1", "A memory about controls", ["ui"])],
      matchMap: new Map<string, MemoryAnalysisMatch>([
        [
          "mem-1",
          {
            memoryId: "mem-1",
            categories: ["project"],
            categoryScores: { project: 1 },
          },
        ],
      ]),
    });

    const controls = screen.getByTestId("memory-insight-controls");
    expect(
      within(controls)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim()),
    ).toEqual(["Fullscreen", "Reset layout", "Fit view"]);
  });

  it("walks a lane from card to tag to entity to memory and only memory opens detail", async () => {
    const onMemorySelect = vi.fn();
    const memories = [
      createMemory(
        "mem-1",
        "Deploy `mem9-ui` to netlify.app with Alice Johnson at 10:30",
        ["netlify"],
      ),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      [
        "mem-1",
        {
          memoryId: "mem-1",
          categories: ["analysis.category.life_log"],
          categoryScores: { "analysis.category.life_log": 1 },
        },
      ],
    ]);

    renderInsight({
      onMemorySelect,
      cards: [
        {
          category: "analysis.category.life_log",
          count: 1,
          confidence: 1,
        },
      ],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("insight-node-card:analysis-category-life-log"));
    fireEvent.click(
      await screen.findByTestId("insight-node-tag:analysis-category-life-log:netlify"),
    );
    expect(onMemorySelect).not.toHaveBeenCalled();

    fireEvent.click(
      await screen.findByTestId(
        "insight-node-entity:analysis-category-life-log:netlify:person_like:alice-johnson",
      ),
    );
    expect(onMemorySelect).not.toHaveBeenCalled();

    fireEvent.click(
      await screen.findByTestId(
        "insight-node-memory:analysis-category-life-log:netlify:person_like:alice-johnson:mem-1",
      ),
    );
    expect(onMemorySelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mem-1" }),
    );
  });

  it("reveals only a limited tag branch first and uses More to page siblings inside one lane", async () => {
    const tagNames = ["tag-a", "tag-b", "tag-c", "tag-d", "tag-e", "tag-f", "tag-g"];
    const memories = tagNames.map((tag, index) =>
      createMemory(`project-${index}`, `Project memory ${index}`, [tag]));
    const matchMap = new Map<string, MemoryAnalysisMatch>(
      tagNames.map((_, index) => [
        `project-${index}`,
        {
          memoryId: `project-${index}`,
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ]),
    );

    renderInsight({
      cards: [{ category: "project", count: 7, confidence: 1 }],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("insight-node-card:project"));

    expect(await screen.findByTestId("insight-node-tag:project:tag-a")).toBeInTheDocument();
    expect(screen.getByTestId("insight-node-tag:project:tag-f")).toBeInTheDocument();
    expect(screen.queryByTestId("insight-node-tag:project:tag-g")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("insight-node-more:card:project:tags"));

    expect(await screen.findByTestId("insight-node-tag:project:tag-g")).toBeInTheDocument();
  });

  it("toggles browser fullscreen state from the top-right control", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    const memories = [createMemory("mem-1", "A memory about fullscreen", ["ui"])];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      [
        "mem-1",
        {
          memoryId: "mem-1",
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ],
    ]);

    renderInsight({
      cards: [{ category: "project", count: 1, confidence: 1 }],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("memory-insight-fullscreen-toggle"));
    expect(requestFullscreen).toHaveBeenCalled();
  });

  it("auto-scrolls right when opening a bubble lane", async () => {
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    const memories = [createMemory("mem-1", "A memory about lane scrolling", ["graph"])];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      [
        "mem-1",
        {
          memoryId: "mem-1",
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ],
    ]);

    renderInsight({
      cards: [{ category: "project", count: 1, confidence: 1 }],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("insight-node-card:project"));

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({
          left: expect.any(Number),
          top: expect.any(Number),
          behavior: "smooth",
        }),
      );
    });

    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: originalScrollTo,
    });
  });
});
