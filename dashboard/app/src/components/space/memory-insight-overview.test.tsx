import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { MemoryInsightOverview } from "./memory-insight-overview";
import {
  buildInsightEntityNodeId,
  buildInsightMemoryNodeId,
  buildInsightTagNodeId,
} from "@/lib/memory-insight";
import type { AnalysisCategoryCard, MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

function createMemory(id: string, content: string, tags: string[]): Memory {
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
    created_at: "2026-03-10T00:00:00Z",
    updated_at: "2026-03-10T00:00:00Z",
  };
}

function renderInsight({
  compact = false,
  resetToken = 0,
  onMemorySelect = () => {},
  cards,
  memories,
  matchMap,
}: {
  compact?: boolean;
  resetToken?: number;
  onMemorySelect?: (memory: Memory) => void;
  cards: AnalysisCategoryCard[];
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
}) {
  return render(
    <MemoryInsightOverview
      cards={cards}
      memories={memories}
      matchMap={matchMap}
      compact={compact}
      resetToken={resetToken}
      onMemorySelect={onMemorySelect}
    />,
  );
}

describe("MemoryInsightOverview", () => {
  it("renders a single shared canvas and expands multiple cards without dedicated lane framing", async () => {
    const memories = [
      createMemory("project-1", "Deploy `mem9-ui` to Netlify with Alice Johnson", ["netlify"]),
      createMemory("project-2", "Track workflow metrics in 120ms", ["workflow"]),
      createMemory("activity-1", "Document @alice in daily notes", ["notes"]),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      [
        "project-1",
        {
          memoryId: "project-1",
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ],
      [
        "project-2",
        {
          memoryId: "project-2",
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ],
      [
        "activity-1",
        {
          memoryId: "activity-1",
          categories: ["activity"],
          categoryScores: { activity: 1 },
        },
      ],
    ]);

    renderInsight({
      cards: [
        { category: "project", count: 2, confidence: 1 },
        { category: "activity", count: 1, confidence: 1 },
      ],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("insight-node-card:project"));
    fireEvent.click(screen.getByTestId("insight-node-card:activity"));

    expect(
      await screen.findByTestId(`insight-node-${buildInsightTagNodeId("project", "netlify")}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`insight-node-${buildInsightTagNodeId("activity", "notes")}`),
    ).toBeInTheDocument();
    expect(screen.getByTestId("memory-insight-canvas-viewport")).toBeInTheDocument();
    expect(screen.getByTestId("memory-insight-canvas-badge")).toHaveTextContent(
      "One shared canvas",
    );
    expect(screen.queryByTestId("memory-insight-lane-card:project")).not.toBeInTheDocument();
  });

  it("spreads root bubbles across a wider center-left region before expansion", () => {
    const memories = [
      createMemory("project-1", "Project memory", ["project"]),
      createMemory("profile-1", "Profile memory", ["profile"]),
      createMemory("plan-1", "Plan memory", ["plan"]),
      createMemory("policy-1", "Policy memory", ["policy"]),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["project-1", { memoryId: "project-1", categories: ["project"], categoryScores: { project: 1 } }],
      ["profile-1", { memoryId: "profile-1", categories: ["profile"], categoryScores: { profile: 1 } }],
      ["plan-1", { memoryId: "plan-1", categories: ["plan"], categoryScores: { plan: 1 } }],
      ["policy-1", { memoryId: "policy-1", categories: ["policy"], categoryScores: { policy: 1 } }],
    ]);

    renderInsight({
      cards: [
        { category: "project", count: 1, confidence: 1 },
        { category: "profile", count: 1, confidence: 1 },
        { category: "plan", count: 1, confidence: 1 },
        { category: "policy", count: 1, confidence: 1 },
      ],
      memories,
      matchMap,
    });

    const lefts = ["project", "profile", "plan", "policy"]
      .map((id) => screen.getByTestId(`insight-node-card:${id}`).style.left)
      .map((value) => Number.parseFloat(value));
    const tops = ["project", "profile", "plan", "policy"]
      .map((id) => screen.getByTestId(`insight-node-card:${id}`).style.top)
      .map((value) => Number.parseFloat(value));

    expect(Math.max(...lefts) - Math.min(...lefts)).toBeGreaterThan(160);
    expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(60);
  });

  it("keeps root bubble motion variables stable across card reorder and twinkle independent per bubble", () => {
    const memories = [
      createMemory("project-1", "Project memory", ["project"]),
      createMemory("profile-1", "Profile memory", ["profile"]),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["project-1", { memoryId: "project-1", categories: ["project"], categoryScores: { project: 1 } }],
      ["profile-1", { memoryId: "profile-1", categories: ["profile"], categoryScores: { profile: 1 } }],
    ]);

    const view = renderInsight({
      cards: [
        { category: "project", count: 1, confidence: 1 },
        { category: "profile", count: 1, confidence: 1 },
      ],
      memories,
      matchMap,
    });

    const projectMotionBefore = screen
      .getByTestId("insight-node-card:project")
      .querySelector<HTMLElement>(".memory-insight-bubble-motion");
    const profileMotionBefore = screen
      .getByTestId("insight-node-card:profile")
      .querySelector<HTMLElement>(".memory-insight-bubble-motion");

    expect(projectMotionBefore).not.toBeNull();
    expect(profileMotionBefore).not.toBeNull();

    const projectDurationBefore = projectMotionBefore!.style.getPropertyValue("--insight-drift-duration");
    const projectDelayBefore = projectMotionBefore!.style.getPropertyValue("--insight-drift-delay");
    const projectTwinkleBefore = projectMotionBefore!.style.getPropertyValue("--insight-twinkle-duration");
    const profileTwinkleBefore = profileMotionBefore!.style.getPropertyValue("--insight-twinkle-duration");

    expect(projectTwinkleBefore).not.toBe(profileTwinkleBefore);

    view.rerender(
      <MemoryInsightOverview
        cards={[
          { category: "profile", count: 1, confidence: 1 },
          { category: "project", count: 1, confidence: 1 },
        ]}
        memories={memories}
        matchMap={matchMap}
        compact={false}
        resetToken={0}
        onMemorySelect={() => {}}
      />,
    );

    const projectMotionAfter = screen
      .getByTestId("insight-node-card:project")
      .querySelector<HTMLElement>(".memory-insight-bubble-motion");

    expect(projectMotionAfter).not.toBeNull();
    expect(
      projectMotionAfter!.style.getPropertyValue("--insight-drift-duration"),
    ).toBe(projectDurationBefore);
    expect(
      projectMotionAfter!.style.getPropertyValue("--insight-drift-delay"),
    ).toBe(projectDelayBefore);
    expect(
      projectMotionAfter!.style.getPropertyValue("--insight-twinkle-duration"),
    ).toBe(projectTwinkleBefore);
  });

  it("renders the top-right controls on one row in Fullscreen / Reset layout / Fit view order", () => {
    renderInsight({
      cards: [{ category: "project", count: 1, confidence: 1 }],
      memories: [createMemory("mem-1", "A memory about controls", ["ui"])],
      matchMap: new Map<string, MemoryAnalysisMatch>([
        [
          "mem-1",
          {
            memoryId: "mem-1",
            categories: ["project"],
            categoryScores: { project: 1 },
          },
        ],
      ]),
    });

    const controls = screen.getByTestId("memory-insight-controls");
    expect(
      within(controls)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim()),
    ).toEqual(["Fullscreen", "Reset layout", "Fit view"]);
  });

  it("makes low-memory bubbles much smaller than dominant categories", () => {
    const memories = [
      createMemory("artifact-1", "Artifact memory", ["artifact"]),
      createMemory("experience-1", "Experience memory", ["experience"]),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["artifact-1", { memoryId: "artifact-1", categories: ["artifact"], categoryScores: { artifact: 1 } }],
      ["experience-1", { memoryId: "experience-1", categories: ["experience"], categoryScores: { experience: 1 } }],
    ]);

    renderInsight({
      cards: [
        { category: "artifact", count: 1221, confidence: 1 },
        { category: "experience", count: 155, confidence: 1 },
      ],
      memories,
      matchMap,
    });

    const artifactDiameter = Number.parseFloat(
      screen.getByTestId("insight-node-card:artifact").dataset.bubbleDiameter ?? "0",
    );
    const experienceDiameter = Number.parseFloat(
      screen.getByTestId("insight-node-card:experience").dataset.bubbleDiameter ?? "0",
    );

    expect(artifactDiameter / experienceDiameter).toBeGreaterThan(3);
    expect((artifactDiameter * artifactDiameter) / (experienceDiameter * experienceDiameter)).toBeGreaterThan(9);
  });

  it("walks a lane from card to tag to entity to memory and only memory opens detail", async () => {
    const onMemorySelect = vi.fn();
    const memories = [
      createMemory(
        "mem-1",
        "Deploy `mem9-ui` to netlify.app with Alice Johnson at 10:30",
        ["netlify"],
      ),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      [
        "mem-1",
        {
          memoryId: "mem-1",
          categories: ["analysis.category.life_log"],
          categoryScores: { "analysis.category.life_log": 1 },
        },
      ],
    ]);

    renderInsight({
      onMemorySelect,
      cards: [
        {
          category: "analysis.category.life_log",
          count: 1,
          confidence: 1,
        },
      ],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("insight-node-card:analysis-category-life-log"));
    fireEvent.click(
      await screen.findByTestId(
        `insight-node-${buildInsightTagNodeId("analysis.category.life_log", "netlify")}`,
      ),
    );
    expect(onMemorySelect).not.toHaveBeenCalled();

    fireEvent.click(
      await screen.findByTestId(
        `insight-node-${buildInsightEntityNodeId(
          "analysis.category.life_log",
          "netlify",
          "person_like",
          "Alice Johnson",
        )}`,
      ),
    );
    expect(onMemorySelect).not.toHaveBeenCalled();

    fireEvent.click(
      await screen.findByTestId(
        `insight-node-${buildInsightMemoryNodeId(
          "analysis.category.life_log",
          "netlify",
          "person_like",
          "Alice Johnson",
          "mem-1",
        )}`,
      ),
    );
    expect(onMemorySelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mem-1" }),
    );
  });

  it("truncates long lane labels to one line and exposes the full text on hover", async () => {
    const longContent = [
      "Requested to go to ~/git/PingComp and investigate the deployment drift before the next release window.",
      "Coordinate with Alice Johnson on the follow-up notes and capture every environment diff in the report.",
    ].join("\n");
    const memories = [createMemory("mem-1", longContent, ["pingcomp"])];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      [
        "mem-1",
        {
          memoryId: "mem-1",
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ],
    ]);

    renderInsight({
      cards: [{ category: "project", count: 1, confidence: 1 }],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("insight-node-card:project"));
    fireEvent.click(
      await screen.findByTestId(`insight-node-${buildInsightTagNodeId("project", "pingcomp")}`),
    );
    fireEvent.click(
      await screen.findByTestId(
        `insight-node-${buildInsightEntityNodeId(
          "project",
          "pingcomp",
          "person_like",
          "Alice Johnson",
        )}`,
      ),
    );

    const memoryNode = await screen.findByTestId(
      `insight-node-${buildInsightMemoryNodeId(
        "project",
        "pingcomp",
        "person_like",
        "Alice Johnson",
        "mem-1",
      )}`,
    );
    const label = memoryNode.querySelector(".whitespace-nowrap");

    expect(label).not.toBeNull();
    expect(label).toHaveTextContent(/\.\.\.$/);
    expect(label?.textContent).not.toContain("\n");
    expect(memoryNode).toHaveAttribute(
      "title",
      expect.stringContaining(
        "Requested to go to ~/git/PingComp and investigate the deployment drift before the next release window. Coordinate with Alice Johnson on the follow-up notes and capture every environment diff in the report.",
      ),
    );
  });

  it("reveals only a limited tag branch first and uses More to page siblings inside one lane", async () => {
    const tagNames = ["tag-a", "tag-b", "tag-c", "tag-d", "tag-e", "tag-f", "tag-g"];
    const memories = tagNames.map((tag, index) =>
      createMemory(`project-${index}`, `Project memory ${index}`, [tag]));
    const matchMap = new Map<string, MemoryAnalysisMatch>(
      tagNames.map((_, index) => [
        `project-${index}`,
        {
          memoryId: `project-${index}`,
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ]),
    );

    renderInsight({
      cards: [{ category: "project", count: 7, confidence: 1 }],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("insight-node-card:project"));

    expect(
      await screen.findByTestId(`insight-node-${buildInsightTagNodeId("project", "tag-a")}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`insight-node-${buildInsightTagNodeId("project", "tag-f")}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`insight-node-${buildInsightTagNodeId("project", "tag-g")}`),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("insight-node-more:card:project:tags"));

    expect(
      await screen.findByTestId(`insight-node-${buildInsightTagNodeId("project", "tag-g")}`),
    ).toBeInTheDocument();
  });

  it("removes the previous entity column when switching tags inside one lane", async () => {
    const memories = [
      createMemory(
        "artifact-1",
        "Delivered PingComp lead-management enhancements on the `main` branch.",
        ["PingComp"],
      ),
      createMemory(
        "artifact-2",
        "Verified `SKILL.md` in `/home/ec2-user` after the release.",
        ["SKILL.md"],
      ),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["artifact-1", { memoryId: "artifact-1", categories: ["artifact"], categoryScores: { artifact: 1 } }],
      ["artifact-2", { memoryId: "artifact-2", categories: ["artifact"], categoryScores: { artifact: 1 } }],
    ]);

    renderInsight({
      cards: [{ category: "artifact", count: 2, confidence: 1 }],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("insight-node-card:artifact"));
    fireEvent.click(
      await screen.findByTestId(`insight-node-${buildInsightTagNodeId("artifact", "PingComp")}`),
    );

    const pingCompEntityId = buildInsightEntityNodeId(
      "artifact",
      "PingComp",
      "named_term",
      "PingComp",
    );
    const skillEntityId = buildInsightEntityNodeId(
      "artifact",
      "SKILL.md",
      "named_term",
      "SKILL.md",
    );

    await waitFor(() => {
      expect(screen.getByTestId(`insight-node-${pingCompEntityId}`)).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByTestId(`insight-node-${buildInsightTagNodeId("artifact", "SKILL.md")}`),
    );

    await waitFor(() => {
      expect(screen.queryByTestId(`insight-node-${pingCompEntityId}`)).not.toBeInTheDocument();
      expect(screen.getByTestId(`insight-node-${skillEntityId}`)).toBeInTheDocument();
    });
  });

  it("removes the previous memory column when switching entities under the same tag", async () => {
    const memories = [
      createMemory(
        "artifact-1",
        "Delivered PingComp lead-management enhancements for PingComp.",
        ["PingComp"],
      ),
      createMemory(
        "artifact-2",
        "Reviewed the `git/PingComp` repository metadata for the release.",
        ["PingComp"],
      ),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["artifact-1", { memoryId: "artifact-1", categories: ["artifact"], categoryScores: { artifact: 1 } }],
      ["artifact-2", { memoryId: "artifact-2", categories: ["artifact"], categoryScores: { artifact: 1 } }],
    ]);

    renderInsight({
      cards: [{ category: "artifact", count: 2, confidence: 1 }],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("insight-node-card:artifact"));
    fireEvent.click(
      await screen.findByTestId(`insight-node-${buildInsightTagNodeId("artifact", "PingComp")}`),
    );

    fireEvent.click(
      await screen.findByTestId(
        `insight-node-${buildInsightEntityNodeId(
          "artifact",
          "PingComp",
          "named_term",
          "PingComp",
        )}`,
      ),
    );

    expect(
      await screen.findByTestId(
        `insight-node-${buildInsightMemoryNodeId(
          "artifact",
          "PingComp",
          "named_term",
          "PingComp",
          "artifact-1",
        )}`,
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId(
        `insight-node-${buildInsightEntityNodeId(
          "artifact",
          "PingComp",
          "named_term",
          "git/PingComp",
        )}`,
      ),
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId(
          `insight-node-${buildInsightMemoryNodeId(
            "artifact",
            "PingComp",
            "named_term",
            "PingComp",
            "artifact-1",
          )}`,
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId(
          `insight-node-${buildInsightMemoryNodeId(
            "artifact",
            "PingComp",
            "named_term",
            "git/PingComp",
            "artifact-2",
          )}`,
        ),
      ).toBeInTheDocument();
    });
  });

  it("does not keep both memory branches when switching between same-label entity kinds", async () => {
    const memories = [
      createMemory(
        "artifact-1",
        "Delivered PingComp lead-management enhancements on 2026-03-05.",
        ["PingComp"],
      ),
      createMemory(
        "artifact-2",
        "The PingComp service was restarted on 2026-03-05 after deploy.",
        ["PingComp"],
      ),
    ];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      ["artifact-1", { memoryId: "artifact-1", categories: ["artifact"], categoryScores: { artifact: 1 } }],
      ["artifact-2", { memoryId: "artifact-2", categories: ["artifact"], categoryScores: { artifact: 1 } }],
    ]);

    renderInsight({
      cards: [{ category: "artifact", count: 2, confidence: 1 }],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("insight-node-card:artifact"));
    fireEvent.click(
      await screen.findByTestId(`insight-node-${buildInsightTagNodeId("artifact", "PingComp")}`),
    );

    fireEvent.click(
      await screen.findByTestId(
        `insight-node-${buildInsightEntityNodeId(
          "artifact",
          "PingComp",
          "named_term",
          "2026-03-05",
        )}`,
      ),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(
          `insight-node-${buildInsightMemoryNodeId(
            "artifact",
            "PingComp",
            "named_term",
            "2026-03-05",
            "artifact-1",
          )}`,
        ),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByTestId(
        `insight-node-${buildInsightEntityNodeId(
          "artifact",
          "PingComp",
          "metric",
          "2026-03-05",
        )}`,
      ),
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId(
          `insight-node-${buildInsightMemoryNodeId(
            "artifact",
            "PingComp",
            "named_term",
            "2026-03-05",
            "artifact-1",
          )}`,
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId(
          `insight-node-${buildInsightMemoryNodeId(
            "artifact",
            "PingComp",
            "metric",
            "2026-03-05",
            "artifact-1",
          )}`,
        ),
      ).toBeInTheDocument();
    });
  });

  it("toggles browser fullscreen state from the top-right control", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    const memories = [createMemory("mem-1", "A memory about fullscreen", ["ui"])];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      [
        "mem-1",
        {
          memoryId: "mem-1",
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ],
    ]);

    renderInsight({
      cards: [{ category: "project", count: 1, confidence: 1 }],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("memory-insight-fullscreen-toggle"));
    expect(requestFullscreen).toHaveBeenCalled();
  });

  it("auto-scrolls right when opening a bubble lane", async () => {
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    const memories = [createMemory("mem-1", "A memory about lane scrolling", ["graph"])];
    const matchMap = new Map<string, MemoryAnalysisMatch>([
      [
        "mem-1",
        {
          memoryId: "mem-1",
          categories: ["project"],
          categoryScores: { project: 1 },
        },
      ],
    ]);

    renderInsight({
      cards: [{ category: "project", count: 1, confidence: 1 }],
      memories,
      matchMap,
    });

    fireEvent.click(screen.getByTestId("insight-node-card:project"));

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({
          left: expect.any(Number),
          top: expect.any(Number),
          behavior: "smooth",
        }),
      );
    });

    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: originalScrollTo,
    });
  });
});
