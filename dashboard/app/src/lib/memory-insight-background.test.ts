import { describe, expect, it } from "vitest";
import {
  buildBoundedMemoryInsightGraphInput,
  buildBoundedMemoryInsightRelationGraphInput,
  projectInsightWorkerMemory,
  shouldUseDerivedSignalsWorker,
} from "./memory-insight-background";
import { buildMemoryInsightRelationGraph } from "./memory-insight-relations";
import type { MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

function createMemory(
  id = "mem-1",
  content = "Investigate dashboard query flow",
): Memory {
  return {
    id,
    content,
    memory_type: "insight",
    source: "agent",
    tags: ["dashboard", "query"],
    metadata: { importance: "high" },
    agent_id: "agent-1",
    session_id: "sess-1",
    state: "active",
    version: 7,
    updated_by: "agent-1",
    created_at: "2026-03-28T00:00:00Z",
    updated_at: "2026-03-28T01:00:00Z",
  };
}

describe("memory insight background helpers", () => {
  it("uses sync computation when the memory set is smaller than the minimum threshold", () => {
    expect(
      shouldUseDerivedSignalsWorker({
        enabled: true,
        memoryCount: 79,
        minimumMemoryCount: 80,
        workerAvailable: true,
      }),
    ).toBe(false);

    expect(
      shouldUseDerivedSignalsWorker({
        enabled: true,
        memoryCount: 80,
        minimumMemoryCount: 80,
        workerAvailable: true,
      }),
    ).toBe(true);
  });

  it("projects worker memories down to the minimal derived-signal payload", () => {
    expect(projectInsightWorkerMemory(createMemory())).toEqual({
      id: "mem-1",
      content: "Investigate dashboard query flow",
      created_at: "2026-03-28T00:00:00Z",
      updated_at: "2026-03-28T01:00:00Z",
      tags: ["dashboard", "query"],
    });
  });

  it("limits insight graph worker input and keeps only matching lookup entries", () => {
    const memories = [
      createMemory("mem-1"),
      createMemory("mem-2"),
      createMemory("mem-3"),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>(
      memories.map((memory) => [
        memory.id,
        {
          memoryId: memory.id,
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ]),
    );

    const bounded = buildBoundedMemoryInsightGraphInput({
      memories,
      matchMap,
      budget: {
        maxSourceMemories: 2,
        maxMemories: 10,
        maxNodes: 20,
        maxEdges: 20,
      },
    });

    expect(bounded.memories.map((memory) => memory.id)).toEqual([
      "mem-1",
      "mem-2",
    ]);
    expect(bounded.matches.map((match) => match.memoryId)).toEqual([
      "mem-1",
      "mem-2",
    ]);
    expect([...bounded.matchMap.keys()]).toEqual(["mem-1", "mem-2"]);
  });

  it("bounds a 40k relation graph before worker transfer and throughout its output", () => {
    const memories = Array.from({ length: 40_000 }, (_, index) =>
      createMemory(
        `mem-${index}`,
        index < 100
          ? `Use \`shared-core\` with \`module-${index}-a\`, \`module-${index}-b\`, and \`module-${index}-c\``
          : "plain note",
      ),
    );
    const matchMap = new Map<string, MemoryAnalysisMatch>(
      ["mem-0", "mem-399", "mem-400", "mem-39999"].map((memoryId) => [
        memoryId,
        {
          memoryId,
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ]),
    );
    const budget = {
      maxSourceMemories: 400,
      maxEntities: 80,
      maxEdges: 60,
    };

    const boundedInput = buildBoundedMemoryInsightRelationGraphInput({
      memories,
      matchMap,
      budget,
    });
    const graph = buildMemoryInsightRelationGraph({
      cards: [],
      memories,
      matchMap,
      budget,
    });

    expect(boundedInput.memories).toHaveLength(400);
    expect(boundedInput.matches.map((match) => match.memoryId)).toEqual([
      "mem-0",
      "mem-399",
    ]);
    expect([...boundedInput.matchMap.keys()]).toEqual(["mem-0", "mem-399"]);
    expect(graph.totalMemories).toBe(400);
    expect(graph.entities.length).toBeLessThanOrEqual(80);
    expect(graph.entitiesById.size).toBeLessThanOrEqual(80);
    expect(graph.edges.length).toBeLessThanOrEqual(60);
    expect(graph.edgesById.size).toBeLessThanOrEqual(60);
  });
});
