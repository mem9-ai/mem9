import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import {
  calculateCompanionDays,
  MemoryProfileOverview,
} from "./memory-profile-overview";
import type { Memory } from "@/types/memory";

const { useBackgroundMemoryInsightGraph } = vi.hoisted(() => ({
  useBackgroundMemoryInsightGraph: vi.fn(() => ({
    data: {
      nodes: [],
      edges: [],
      cards: [
        {
          id: "card:legacy",
          kind: "card" as const,
          category: "legacy",
          label: "Legacy graph topic",
          count: 99,
          confidence: 1,
          size: 100,
          branchKey: "legacy",
          parentId: null,
          depth: 0 as const,
        },
      ],
      tags: [],
      entities: [],
      memories: [],
    },
    isComputing: false,
  })),
}));

vi.mock("@/lib/memory-insight-background", () => ({
  useBackgroundMemoryInsightGraph,
}));

vi.mock("@/api/analysis-queries", () => ({
  useUserProfile: () => ({
    data: undefined,
    isLoading: false,
  }),
}));

function createMemory(): Memory {
  return {
    id: "mem-1",
    content: "Dashboard profile memory",
    memory_type: "insight",
    source: "agent",
    tags: ["dashboard"],
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

describe("MemoryProfileOverview", () => {
  it("renders the topic radar from cards without starting an insight graph computation", () => {
    render(
      <MemoryProfileOverview
        spaceId="space-1"
        stats={{ total: 12, pinned: 3, insight: 9 }}
        memories={[createMemory()]}
        cards={[
          { category: "Projects", count: 12, confidence: 0.9 },
          { category: "Preferences", count: 7, confidence: 0.8 },
        ]}
        snapshot={null}
        range="all"
        facetSummary={undefined}
        loading={false}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Projects: 12" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Preferences: 7" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Legacy graph topic: 99" }),
    ).not.toBeInTheDocument();
    expect(useBackgroundMemoryInsightGraph).not.toHaveBeenCalled();
  });

  it("calculates companion days for a memory set larger than the function argument limit", () => {
    const recentMemory = {
      ...createMemory(),
      created_at: "2026-07-29T00:00:00Z",
    };
    const memories = new Array<Memory>(150_000).fill(recentMemory);
    memories[memories.length - 1] = {
      ...recentMemory,
      id: "mem-oldest",
      created_at: "2026-07-20T00:00:00Z",
    };

    expect(
      calculateCompanionDays(
        memories,
        Date.parse("2026-07-30T00:00:00Z"),
      ),
    ).toBe(10);
  });
});
