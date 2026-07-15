import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { MemoryOverviewTabs } from "./memory-overview-tabs";
import type { Memory } from "@/types/memory";

vi.mock("@/components/space/deep-analysis-tab", () => ({
  DeepAnalysisTab: ({
    spaceId,
    active,
  }: {
    spaceId: string;
    active: boolean;
  }) => <div data-testid="deep-analysis-tab">{`${spaceId}:${String(active)}`}</div>,
}));

vi.mock("@/api/analysis-queries", () => ({
  useUserProfile: () => ({
    data: {
      generatedAt: "2026-06-26T08:00:00.000Z",
      source: { memoryTypes: ["fact", "insight", "pinned"], memoryCount: 2 },
      summary: {
        text: "Interface summary from v1/user-profile.",
        evidence: [],
      },
      attributes: [],
      changes: [],
      relationships: [
        {
          name: "Alice",
          relation: "Teammate",
          importance: 12,
          evidenceCount: 2,
          evidence: [{ memoryId: "mem-profile-1", quote: "Alice collaborates on dashboard work." }],
        },
      ],
      items: [
        {
          kind: "current_priority",
          title: "Prepare KET plan",
          summary: "Keep the 60-day vocabulary schedule visible.",
          importance: 10,
          evidenceCount: 3,
          evidence: [],
        },
        {
          kind: "current_priority",
          title: "Review dashboard work",
          summary: "Focus on user profile rendering.",
          importance: 8,
          evidenceCount: 2,
          evidence: [],
        },
        {
          kind: "current_priority",
          title: "Protect health rhythm",
          summary: "Keep sleep and exercise sustainable.",
          importance: 7,
          evidenceCount: 1,
          evidence: [],
        },
        {
          kind: "current_priority",
          title: "Hidden fourth priority",
          summary: "This should not render.",
          importance: 6,
          evidenceCount: 1,
          evidence: [],
        },
        {
          kind: "companion_style",
          title: "Be direct",
          summary: "Prefer concrete suggestions without preaching.",
          importance: 9,
          evidenceCount: 2,
          evidence: [],
        },
        {
          kind: "robot_constraint",
          title: "Avoid assumptions",
          summary: "Do not change backend response data for UI requests.",
          importance: 9,
          evidenceCount: 4,
          evidence: [],
        },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock("@/api/memory-analysis-reports", () => ({
  analyzeMemorySourceQueryKey: () => ["memoryAnalysisSource"],
  latestCompletedMemoryAnalysisQueryKey: () => ["memoryAnalysisLatestCompleted"],
  useAnalyzeMemorySource: () => ({
    data: null,
    isError: false,
    isFetching: false,
    isLoading: false,
  }),
  useLatestCompletedMemoryAnalysis: () => ({
    data: null,
    isError: false,
    isFetching: false,
    isLoading: false,
  }),
  useEditSessionMessage: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useMarkSessionMessage: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

afterEach(() => {
  setViewportWidth(ORIGINAL_INNER_WIDTH);
});

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
  it("shows Memory List after Report Manage without rendering the old Pulse cards", async () => {
    setViewportWidth(1400);
    const onTabChange = vi.fn();
    render(
      <MemoryOverviewTabs
        spaceId="space-1"
        stats={{ total: 1, pinned: 0, insight: 1 }}
        pulseMemories={[createMemory("mem-1")]}
        insightMemories={[createMemory("mem-1")]}
        cards={[]}
        snapshot={null}
        range="all"
        loading={false}
        compact={false}
        matchMap={new Map()}
        onMemorySelect={() => {}}
        onTabChange={onTabChange}
      />,
    );

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Memory Profile",
      "Periodic Observation",
      "Report Manage",
      "Memory Insight",
      "Memory List",
    ]);
    expect(screen.queryByRole("tab", { name: "Memory Analysis" })).not.toBeInTheDocument();

    const listTab = screen.getByRole("tab", { name: "Memory List" });
    listTab.focus();
    fireEvent.keyDown(listTab, { key: "Enter" });

    await waitFor(() => expect(listTab).toHaveAttribute("data-state", "active"));
    expect(onTabChange).toHaveBeenCalledWith("pulse");
    expect(screen.queryByText("Memory Pulse")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Recent memory activity across the current range"),
    ).not.toBeInTheDocument();
  });

  it("renders short labels for the visible mobile tabs", () => {
    setViewportWidth(390);
    render(
      <MemoryOverviewTabs
        spaceId="space-mobile"
        stats={{ total: 1, pinned: 0, insight: 1 }}
        pulseMemories={[createMemory("mem-mobile-1")]}
        insightMemories={[createMemory("mem-mobile-1")]}
        cards={[]}
        snapshot={null}
        range="all"
        loading={false}
        compact={false}
        matchMap={new Map()}
        onMemorySelect={() => {}}
      />,
    );

    expect(screen.getByTestId("memory-overview-tab-profile")).toHaveTextContent("Profile");
    expect(screen.getByTestId("memory-overview-tab-periodic")).toHaveTextContent("Observe");
    expect(screen.getByTestId("memory-overview-tab-reports")).toHaveTextContent("Reports");
    expect(screen.getByTestId("memory-overview-tab-insight")).toHaveTextContent("Insight");
    expect(screen.getByTestId("memory-overview-tab-pulse")).toHaveTextContent("List");
    expect(screen.queryByTestId("memory-overview-tab-analysis")).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Profile",
      "Observe",
      "Reports",
      "Insight",
      "List",
    ]);
    expect(screen.getByRole("tab", { name: "Memory List" })).toBe(
      screen.getByTestId("memory-overview-tab-pulse"),
    );
    expect(screen.getByRole("tab", { name: "Memory Insight" })).toBe(
      screen.getByTestId("memory-overview-tab-insight"),
    );
  });

  it("exposes the Memory Profile tab with personal info and current understanding", () => {
    setViewportWidth(1400);
    const memory = createMemory("mem-profile-1");

    render(
      <MemoryOverviewTabs
        spaceId="space-profile"
        stats={{ total: 12, pinned: 3, insight: 9 }}
        pulseMemories={[memory]}
        insightMemories={[memory]}
        cards={[]}
        snapshot={null}
        range="all"
        loading={false}
        compact={false}
        matchMap={new Map()}
        onMemorySelect={() => {}}
      />,
    );

    const profileTab = screen.getByRole("tab", { name: "Memory Profile" });
    profileTab.focus();
    fireEvent.keyDown(profileTab, { key: "Enter" });

    expect(screen.getByTestId("memory-profile-overview")).toBeInTheDocument();
    expect(screen.getByText("Basic Profile")).toBeInTheDocument();
    expect(
      screen.getByText("AI's Current Understanding of You"),
    ).toBeInTheDocument();
    expect(screen.getByText("Interface summary from v1/user-profile.")).toBeInTheDocument();
    expect(screen.getAllByText("Recent memory activity across the current range").length).toBeGreaterThan(0);
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("Teammate")).not.toBeInTheDocument();
    expect(screen.getByText("Prepare KET plan")).toBeInTheDocument();
    expect(screen.queryByText(/Keep the 60-day vocabulary schedule visible/u)).not.toBeInTheDocument();
    expect(screen.getByText("Be direct")).toBeInTheDocument();
    expect(screen.getByText("Avoid assumptions")).toBeInTheDocument();
    expect(screen.queryByText("Hidden fourth priority")).not.toBeInTheDocument();
    expect(screen.queryByText("Recall cue")).not.toBeInTheDocument();
    expect(screen.queryByText("Profile Confidence")).not.toBeInTheDocument();
    expect(screen.getByText("12 memories")).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Profile confidence pie chart" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /memories/u })).not.toBeInTheDocument();
  });
});
