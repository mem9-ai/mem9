import { describe, expect, it } from "vitest";
import {
  projectInsightWorkerMemory,
  shouldSkipBackgroundWorkerTask,
  shouldUseDerivedSignalsWorker,
} from "./memory-insight-background";
import type { Memory } from "@/types/memory";

function createMemory(): Memory {
  return {
    id: "mem-1",
    content: "Investigate dashboard query flow",
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

  it("skips empty worker tasks without disabling populated relation graphs", () => {
    expect(
      shouldSkipBackgroundWorkerTask({
        type: "derived-signals",
        memoryCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldSkipBackgroundWorkerTask({
        type: "insight-graph",
        memoryCount: 100,
        cardCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldSkipBackgroundWorkerTask({
        type: "relation-graph",
        memoryCount: 100,
        cardCount: 0,
      }),
    ).toBe(false);
  });
});
