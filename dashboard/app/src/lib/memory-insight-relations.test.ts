import { describe, expect, it } from "vitest";
import { buildMemoryInsightRelationGraph } from "./memory-insight-relations";
import type { AnalysisCategoryCard, MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

function createMemory(
  id: string,
  content: string,
  tags: string[],
  updatedAt: string,
): Memory {
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
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

function createCard(category: string, count: number): AnalysisCategoryCard {
  return {
    category,
    count,
    confidence: 1,
  };
}

function createMatch(memoryId: string, categories: string[]): MemoryAnalysisMatch {
  return {
    memoryId,
    categories,
    categoryScores: Object.fromEntries(categories.map((category) => [category, 1])),
  };
}

describe("memory-insight-relations", () => {
  it("filters memories by active category and tag before building the graph", () => {
    const memories = [
      createMemory(
        "mem-1",
        "Deploy `mem9-ui` to netlify.app with Alice Johnson",
        ["deploy"],
        "2026-03-10T00:00:00Z",
      ),
      createMemory(
        "mem-2",
        "Discuss `mem9-ui` with Bob Chen",
        ["notes"],
        "2026-03-11T00:00:00Z",
      ),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["mem-1", createMatch("mem-1", ["project"])],
      ["mem-2", createMatch("mem-2", ["activity"])],
    ]);

    const graph = buildMemoryInsightRelationGraph({
      cards: [createCard("project", 1), createCard("activity", 1)],
      memories,
      matchMap,
      activeCategory: "project",
      activeTag: "deploy",
    });

    expect(graph.totalMemories).toBe(1);
    expect(graph.entities.map((entity) => entity.label)).toEqual(
      expect.arrayContaining(["mem9-ui", "netlify.app", "Alice Johnson"]),
    );
    expect(graph.entities.map((entity) => entity.label)).not.toContain("Bob Chen");
  });

  it("applies relation type priority before aggregating the final edge label", () => {
    const memories = [
      createMemory(
        "mem-1",
        "Service `api-gateway` depends on `redis-cluster` and works with `redis-cluster`",
        ["infra"],
        "2026-03-10T00:00:00Z",
      ),
      createMemory(
        "mem-2",
        "Service `api-gateway` depends on `redis-cluster` again",
        ["infra"],
        "2026-03-11T00:00:00Z",
      ),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["mem-1", createMatch("mem-1", ["project"])],
      ["mem-2", createMatch("mem-2", ["project"])],
    ]);

    const graph = buildMemoryInsightRelationGraph({
      cards: [createCard("project", 2)],
      memories,
      matchMap,
    });
    const edge = graph.edges.find(
      (candidate) =>
        candidate.sourceLabel === "api-gateway" &&
        candidate.targetLabel === "redis-cluster",
    );

    expect(edge?.relationType).toBe("depends_on");
    expect(edge?.coOccurrenceCount).toBe(2);
  });

  it("keeps singleton neighbors in the graph but only promotes recurring entities into top lists", () => {
    const memories = [
      createMemory(
        "mem-1",
        "Deploy `mem9-ui` to netlify.app with Alice Johnson",
        ["deploy"],
        "2026-03-10T00:00:00Z",
      ),
      createMemory(
        "mem-2",
        "Deploy `mem9-ui` to netlify.app with Ming Zhang",
        ["deploy"],
        "2026-03-11T00:00:00Z",
      ),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["mem-1", createMatch("mem-1", ["project"])],
      ["mem-2", createMatch("mem-2", ["project"])],
    ]);

    const graph = buildMemoryInsightRelationGraph({
      cards: [createCard("project", 2)],
      memories,
      matchMap,
    });

    expect(graph.topEntityIds).toContain("named_term:mem9-ui");
    expect(graph.topEntityIds).toContain("named_term:netlify.app");
    expect(graph.topEntityIds).not.toContain("person_like:alice johnson");
    expect(graph.entities.map((entity) => entity.id)).toContain("person_like:alice johnson");
  });

  it("filters edges by minimum co-occurrence before computing display rankings", () => {
    const memories = [
      createMemory(
        "mem-1",
        "Deploy `mem9-ui` to netlify.app with Alice Johnson",
        ["deploy"],
        "2026-03-10T00:00:00Z",
      ),
      createMemory(
        "mem-2",
        "Deploy `mem9-ui` to netlify.app with Alice Johnson",
        ["deploy"],
        "2026-03-11T00:00:00Z",
      ),
      createMemory(
        "mem-3",
        "Discuss `mem9-ui` with Bob Chen",
        ["notes"],
        "2026-03-12T00:00:00Z",
      ),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["mem-1", createMatch("mem-1", ["project"])],
      ["mem-2", createMatch("mem-2", ["project"])],
      ["mem-3", createMatch("mem-3", ["project"])],
    ]);

    const graph = buildMemoryInsightRelationGraph({
      cards: [createCard("project", 3)],
      memories,
      matchMap,
      minimumCoOccurrence: 2,
    });

    expect(graph.edges.every((edge) => edge.coOccurrenceCount >= 2)).toBe(true);
    expect(graph.edges.some((edge) => edge.targetLabel === "Bob Chen")).toBe(false);
  });

  it("computes bridge, cluster, and rising summaries from the filtered graph", () => {
    const memories = [
      createMemory(
        "mem-1",
        "Deploy `mem9-ui` to netlify.app with `workflow-engine`",
        ["deploy", "workflow", "clawd"],
        "2026-03-01T00:00:00Z",
      ),
      createMemory(
        "mem-2",
        "Track `mem9-ui` with `workflow-engine` and `analytics-core`",
        ["workflow", "analytics"],
        "2026-03-02T00:00:00Z",
      ),
      createMemory(
        "mem-3",
        "Track `mem9-ui` with `analytics-core` on dashboard",
        ["analytics"],
        "2026-03-19T00:00:00Z",
      ),
      createMemory(
        "mem-4",
        "Track `mem9-ui` with `analytics-core` on dashboard",
        ["analytics"],
        "2026-03-20T00:00:00Z",
      ),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["mem-1", createMatch("mem-1", ["project", "delivery"])],
      ["mem-2", createMatch("mem-2", ["project", "analysis"])],
      ["mem-3", createMatch("mem-3", ["analysis"])],
      ["mem-4", createMatch("mem-4", ["analysis"])],
    ]);

    const graph = buildMemoryInsightRelationGraph({
      cards: [
        createCard("project", 2),
        createCard("delivery", 1),
        createCard("analysis", 3),
      ],
      memories,
      matchMap,
    });

    expect(graph.bridgeEntities[0]?.label).toBe("mem9-ui");
    expect(graph.clusters[0]?.entityIds.length).toBeGreaterThanOrEqual(3);
    expect(graph.risingEntities[0]?.label).toBe("analytics-core");
    expect(graph.risingEntities[0]?.recentCount).toBeGreaterThan(graph.risingEntities[0]?.previousCount ?? 0);
    expect(graph.bridgeEntities[0]?.tags).not.toContain("clawd");
  });

  it("limits ranked global nodes and edges to top 30 / top 80", () => {
    const memories: Memory[] = [];
    const matchEntries: Array<[string, MemoryAnalysisMatch]> = [];

    for (let index = 0; index < 45; index += 1) {
      const id = `mem-${index}`;
      memories.push(
        createMemory(
          id,
          `Use \`shared-core\` with \`module-${index}\` and \`module-${(index + 1) % 45}\``,
          ["graph"],
          `2026-03-${String((index % 20) + 1).padStart(2, "0")}T00:00:00Z`,
        ),
      );
      matchEntries.push([id, createMatch(id, ["project"])]);
    }

    const graph = buildMemoryInsightRelationGraph({
      cards: [createCard("project", memories.length)],
      memories,
      matchMap: new Map(matchEntries),
    });

    expect(graph.topEntityIds.length).toBeLessThanOrEqual(30);
    expect(graph.topEdgeIds.length).toBeLessThanOrEqual(80);
  });

  it("reuses derived tags for active tag filters and shared tag summaries", () => {
    const memories = [
      createMemory(
        "mem-1",
        "继续推进 `OpenClaw` 与 `workflow-engine`，部署到 /srv/openclaw/config",
        ["clawd", "md"],
        "2026-03-10T00:00:00Z",
      ),
      createMemory(
        "mem-2",
        "再次推进 `OpenClaw` 与 `workflow-engine`，部署到 /srv/openclaw/config",
        ["import", "json"],
        "2026-03-11T00:00:00Z",
      ),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["mem-1", createMatch("mem-1", ["project"])],
      ["mem-2", createMatch("mem-2", ["project"])],
    ]);

    const graph = buildMemoryInsightRelationGraph({
      cards: [createCard("project", 2)],
      memories,
      matchMap,
      activeTag: "OpenClaw",
    });

    expect(graph.totalMemories).toBe(2);
    expect(graph.edges[0]?.sharedTags).toContain("OpenClaw");
    expect(graph.edges[0]?.sharedTags).not.toContain("clawd");
  });
});
