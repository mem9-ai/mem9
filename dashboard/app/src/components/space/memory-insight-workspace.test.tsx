import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { MemoryInsightRelations } from "./memory-insight-relations";
import { MemoryInsightWorkspace } from "./memory-insight-workspace";
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

function createMatch(memoryId: string, categories: string[]): MemoryAnalysisMatch {
  return {
    memoryId,
    categories,
    categoryScores: Object.fromEntries(categories.map((category) => [category, 1])),
  };
}

function setViewport(desktop: boolean): void {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: desktop,
      media: desktop ? "(min-width: 1200px)" : "(min-width: 1200px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const cards: AnalysisCategoryCard[] = [{ category: "project", count: 4, confidence: 1 }];

function createBaseData() {
  const memories = [
    createMemory(
      "mem-1",
      "Deploy `mem9-ui` to netlify.app with `workflow-engine`",
      ["deploy", "workflow"],
      "2026-03-01T00:00:00Z",
    ),
    createMemory(
      "mem-2",
      "Deploy `mem9-ui` to netlify.app with `workflow-engine`",
      ["deploy", "workflow"],
      "2026-03-02T00:00:00Z",
    ),
    createMemory(
      "mem-3",
      "Track `workflow-engine` with `analytics-core`",
      ["analytics"],
      "2026-03-12T00:00:00Z",
    ),
    createMemory(
      "mem-4",
      "Track `workflow-engine` with `analytics-core`",
      ["analytics"],
      "2026-03-15T00:00:00Z",
    ),
  ];
  const matchMap = new Map<string, MemoryAnalysisMatch>([
    ["mem-1", createMatch("mem-1", ["project"])],
    ["mem-2", createMatch("mem-2", ["project"])],
    ["mem-3", createMatch("mem-3", ["project"])],
    ["mem-4", createMatch("mem-4", ["project"])],
  ]);

  return { memories, matchMap };
}

describe("MemoryInsightWorkspace", () => {
  it("switches between browse and relations inside the insight workspace", async () => {
    setViewport(true);
    const { memories, matchMap } = createBaseData();

    render(
      <MemoryInsightWorkspace
        cards={cards}
        memories={memories}
        matchMap={matchMap}
        compact={false}
        resetToken={0}
        onMemorySelect={() => {}}
      />,
    );

    expect(screen.getByTestId("memory-insight-overview")).toBeInTheDocument();

    const relationsTab = screen.getByRole("tab", { name: "Relations" });
    relationsTab.focus();
    fireEvent.keyDown(relationsTab, { key: "Enter" });

    expect(await screen.findByTestId("memory-insight-relations")).toBeInTheDocument();
  });
});

describe("MemoryInsightRelations", () => {
  it("shows entity and edge details and forwards evidence memory clicks", async () => {
    setViewport(true);
    const { memories, matchMap } = createBaseData();
    const onMemorySelect = vi.fn();

    render(
      <MemoryInsightRelations
        cards={cards}
        memories={memories}
        matchMap={matchMap}
        compact={false}
        resetToken={0}
        onMemorySelect={onMemorySelect}
      />,
    );

    fireEvent.click(await screen.findByTestId("relation-node-entity:named_term:mem9-ui"));

    expect(await screen.findByText("Entity Detail")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("relation-evidence-memory:mem-1"));
    expect(onMemorySelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mem-1" }),
    );

    fireEvent.click(screen.getByTestId("relation-edge:named_term:mem9-ui=>named_term:netlify.app"));
    expect(await screen.findByText("Relationship Detail")).toBeInTheDocument();
  });

  it("expands from 1-hop to 2-hop neighborhoods", async () => {
    setViewport(true);
    const { memories, matchMap } = createBaseData();

    render(
      <MemoryInsightRelations
        cards={cards}
        memories={memories}
        matchMap={matchMap}
        compact={false}
        resetToken={0}
        onMemorySelect={() => {}}
      />,
    );

    fireEvent.click(await screen.findByTestId("relation-node-entity:named_term:mem9-ui"));
    expect(screen.queryByTestId("relation-node-entity:named_term:analytics-core")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("memory-insight-relations-expand-depth"));

    expect(await screen.findByTestId("relation-node-entity:named_term:analytics-core")).toBeInTheDocument();
  });

  it("filters the graph by strength threshold", async () => {
    setViewport(true);
    const memories = [
      createMemory(
        "mem-1",
        "Service `api-gateway` depends on `redis-cluster`",
        ["infra"],
        "2026-03-10T00:00:00Z",
      ),
      createMemory(
        "mem-2",
        "Service `api-gateway` depends on `redis-cluster` again",
        ["infra"],
        "2026-03-11T00:00:00Z",
      ),
      createMemory(
        "mem-3",
        "Use `redis-cluster` with `analytics-core`",
        ["infra"],
        "2026-03-12T00:00:00Z",
      ),
      createMemory(
        "mem-4",
        "Use `redis-cluster` with `analytics-core` again",
        ["infra"],
        "2026-03-13T00:00:00Z",
      ),
      createMemory(
        "mem-5",
        "Use `redis-cluster` with `analytics-core` one more time",
        ["infra"],
        "2026-03-14T00:00:00Z",
      ),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["mem-1", createMatch("mem-1", ["project"])],
      ["mem-2", createMatch("mem-2", ["project"])],
      ["mem-3", createMatch("mem-3", ["project"])],
      ["mem-4", createMatch("mem-4", ["project"])],
      ["mem-5", createMatch("mem-5", ["project"])],
    ]);

    render(
      <MemoryInsightRelations
        cards={cards}
        memories={memories}
        matchMap={matchMap}
        compact={false}
        resetToken={0}
        onMemorySelect={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("memory-insight-strength:strong"));

    await waitFor(() => {
      expect(screen.getByTestId("relation-node-entity:named_term:analytics-core")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("relation-node-entity:named_term:api-gateway")).not.toBeInTheDocument();
  });

  it("opens the mobile detail sheet when selecting a node on narrow screens", async () => {
    setViewport(false);
    const { memories, matchMap } = createBaseData();

    render(
      <MemoryInsightRelations
        cards={cards}
        memories={memories}
        matchMap={matchMap}
        compact={false}
        resetToken={0}
        onMemorySelect={() => {}}
      />,
    );

    fireEvent.click(await screen.findByTestId("relation-node-entity:named_term:mem9-ui"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("Entity Detail").length).toBeGreaterThan(0);
  });
});
