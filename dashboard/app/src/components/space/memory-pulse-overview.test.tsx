import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryPulseOverview } from "./memory-pulse-overview";
import type { MemoryStats } from "@/types/memory";

const stats: MemoryStats = {
  total: 2,
  pinned: 1,
  insight: 1,
};

describe("MemoryPulseOverview", () => {
  it("stays hidden until stats are ready", () => {
    const { container } = render(
      <MemoryPulseOverview
        stats={undefined}
        memories={[]}
        cards={[]}
        snapshot={null}
        range="all"
        loading={false}
        onTypeSelect={() => {}}
        onTagSelect={() => {}}
        onTimelineSelect={() => {}}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders once stats are available", () => {
    render(
      <MemoryPulseOverview
        stats={stats}
        memories={[
          {
            id: "mem-1",
            content: "memory",
            memory_type: "insight",
            source: "openclaw",
            tags: ["project"],
            metadata: { facet: "plans" },
            agent_id: "agent",
            session_id: "session",
            state: "active",
            version: 1,
            updated_by: "agent",
            created_at: "2026-03-10T00:00:00Z",
            updated_at: "2026-03-10T00:00:00Z",
          },
        ]}
        cards={[]}
        snapshot={null}
        range="all"
        loading={false}
        onTypeSelect={() => {}}
        onTagSelect={() => {}}
        onTimelineSelect={() => {}}
      />,
    );

    expect(screen.getByText("memory_pulse.title")).toBeInTheDocument();
  });

  it("shows skeleton while loading with no pulse data yet", () => {
    render(
      <MemoryPulseOverview
        stats={undefined}
        memories={[]}
        cards={[]}
        snapshot={null}
        range="all"
        loading
        onTypeSelect={() => {}}
        onTagSelect={() => {}}
        onTimelineSelect={() => {}}
      />,
    );

    expect(screen.getByTestId("memory-pulse-skeleton")).toBeInTheDocument();
  });
});
