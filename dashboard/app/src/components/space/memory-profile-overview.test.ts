import { describe, expect, it } from "vitest";
import { buildRadarTopics } from "./memory-profile-overview";
import type { AnalysisCategoryCard, MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

function createMemory(id: string): Memory {
  return {
    id,
    content: `Memory ${id}`,
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

describe("buildRadarTopics", () => {
  it("builds the lightweight radar model without expanding the insight graph", () => {
    const cards: AnalysisCategoryCard[] = [
      { category: "preference", count: 1, confidence: 0.5 },
      { category: "identity", count: 1, confidence: 0.5 },
      { category: "experience", count: 0, confidence: 0 },
    ];
    const memories = [createMemory("memory-1"), createMemory("memory-2")];
    const matches: MemoryAnalysisMatch[] = memories.map((memory) => ({
      memoryId: memory.id,
      categories: ["identity"],
      categoryScores: { identity: 1 },
    }));

    expect(
      buildRadarTopics(
        cards,
        memories,
        new Map(matches.map((match) => [match.memoryId, match])),
      ),
    ).toEqual([
      { id: "card:identity", label: "identity", count: 2 },
      { id: "card:preference", label: "preference", count: 1 },
    ]);
  });

  it("limits the radar to the five highest-count topics", () => {
    const cards: AnalysisCategoryCard[] = [
      "identity",
      "preference",
      "experience",
      "activity",
      "emotion",
      "other",
    ].map((category, index) => ({
      category: category as AnalysisCategoryCard["category"],
      count: index + 1,
      confidence: 0.5,
    }));

    expect(buildRadarTopics(cards, [], new Map())).toHaveLength(5);
    expect(buildRadarTopics(cards, [], new Map()).map((topic) => topic.count)).toEqual([
      6,
      5,
      4,
      3,
      2,
    ]);
  });
});
