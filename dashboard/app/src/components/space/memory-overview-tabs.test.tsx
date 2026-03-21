import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { MemoryOverviewTabs } from "./memory-overview-tabs";
import type { MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

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
    expect(await screen.findByTestId("insight-node-tag:activity:graph")).toBeInTheDocument();
    expect(await screen.findByTestId("insight-node-tag:project:graph")).toBeInTheDocument();
    expect(screen.getByTestId("memory-insight-canvas-viewport")).toBeInTheDocument();

    const pulseTab = screen.getByRole("tab", { name: "Memory Pulse" });
    pulseTab.focus();
    fireEvent.keyDown(pulseTab, { key: "Enter" });

    insightTab.focus();
    fireEvent.keyDown(insightTab, { key: "Enter" });

    expect(screen.queryByTestId("insight-node-tag:activity:graph")).not.toBeInTheDocument();
    expect(screen.queryByTestId("insight-node-tag:project:graph")).not.toBeInTheDocument();
  });

  it("forwards insight leaf clicks as insight-sourced memory selections", async () => {
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
    fireEvent.click(await screen.findByTestId("insight-node-tag:project:graph"));
    fireEvent.click(
      await screen.findByTestId(
        "insight-node-entity:project:graph:named_term:mem9-ui",
      ),
    );
    fireEvent.click(
      await screen.findByTestId(
        "insight-node-memory:project:graph:named_term:mem9-ui:mem-insight-1",
      ),
    );

    expect(onMemorySelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mem-insight-1" }),
      "insight",
    );
  });
});
