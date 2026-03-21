import { describe, expect, it } from "vitest";
import {
  buildAnalysisCardsFromMatches,
  createAnalysisMatchMap,
  matchMemoriesToTaxonomy,
} from "./analysis-matcher";
import type { TaxonomyResponse } from "@/types/analysis";
import type { Memory } from "@/types/memory";

function createMemory(
  id: string,
  content: string,
  tags: string[] = [],
): Memory {
  return {
    id,
    content,
    memory_type: "insight",
    source: "agent",
    tags,
    metadata: null,
    agent_id: "agent",
    session_id: "",
    state: "active",
    version: 1,
    updated_by: "agent",
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-02T00:00:00Z",
  };
}

const taxonomy: TaxonomyResponse = {
  version: "v3",
  updatedAt: "2026-03-10T00:00:00Z",
  categories: ["identity", "emotion", "preference", "experience", "activity"],
  rules: [
    {
      id: "r1",
      version: "v3",
      category: "activity",
      label: "Build",
      lang: "en",
      matchType: "keyword",
      pattern: "deploy",
      weight: 2,
      enabled: true,
    },
    {
      id: "r2",
      version: "v3",
      category: "preference",
      label: "Editor",
      lang: "en",
      matchType: "phrase",
      pattern: "prefer neovim",
      weight: 1,
      enabled: true,
    },
    {
      id: "r3",
      version: "v3",
      category: "identity",
      label: "Founder",
      lang: "en",
      matchType: "regex",
      pattern: "founder|co-?founder",
      weight: 3,
      enabled: true,
    },
  ],
};

describe("analysis-matcher", () => {
  it("matches memories into local categories and builds cards", () => {
    const memories = [
      createMemory("mem-1", "I prefer Neovim for daily work", ["editor"]),
      createMemory("mem-2", "Need to deploy the dashboard tomorrow"),
      createMemory("mem-3", "I am the cofounder of mem9"),
    ];

    const matches = matchMemoriesToTaxonomy(memories, taxonomy);
    const cards = buildAnalysisCardsFromMatches(matches, memories.length);
    const matchMap = createAnalysisMatchMap(matches);

    expect(matches).toHaveLength(3);
    expect(matchMap.get("mem-1")?.categories).toContain("preference");
    expect(matchMap.get("mem-2")?.categories).toContain("activity");
    expect(matchMap.get("mem-3")?.categories).toContain("identity");
    expect(cards.map((card) => card.category)).toEqual([
      "preference",
      "activity",
      "identity",
    ]);
    expect(cards[0]?.count).toBe(1);
  });

  it("counts one memory once per matched category", () => {
    const memories = [
      createMemory("mem-1", "I prefer Neovim and will deploy tonight"),
    ];

    const matches = matchMemoriesToTaxonomy(memories, taxonomy);
    const cards = buildAnalysisCardsFromMatches(matches, memories.length);

    expect(matches[0]?.categories).toEqual(["activity", "preference"]);
    expect(cards).toEqual([
      { category: "activity", count: 1, confidence: 1 },
      { category: "preference", count: 1, confidence: 1 },
    ]);
  });
});
