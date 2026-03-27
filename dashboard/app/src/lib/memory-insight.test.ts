import { describe, expect, it } from "vitest";
import {
  buildMemoryInsightGraph,
  buildInsightEntityNodeId,
  buildInsightMemoryNodeId,
  buildInsightTagNodeId,
  extractMemoryInsightEntities,
  formatInsightCategoryLabel,
  memoryMatchesInsightEntity,
} from "./memory-insight";
import type { AnalysisCategoryCard, MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

function createMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    content: "Default memory content",
    memory_type: "insight",
    source: "agent",
    tags: [],
    metadata: null,
    agent_id: "agent",
    session_id: "session",
    state: "active",
    version: 1,
    updated_by: "agent",
    created_at: "2026-03-10T00:00:00Z",
    updated_at: "2026-03-10T00:00:00Z",
    ...overrides,
  };
}

function createCard(category: string, count: number): AnalysisCategoryCard {
  return {
    category,
    count,
    confidence: 0.5,
  };
}

function createMatch(
  memoryId: string,
  categories: string[],
): MemoryAnalysisMatch {
  return {
    memoryId,
    categories,
    categoryScores: Object.fromEntries(categories.map((category) => [category, 1])),
  };
}

describe("memory-insight", () => {
  it("extracts named_term, metric, and person_like entities", () => {
    const memory = createMemory("mem-1", {
      content:
        'Bosn mentioned @alice while deploying `mem9-ui` to netlify.app at 09:30 with 32% rollout on v1.2.3. Ming Zhang reviewed it.',
    });

    const entities = extractMemoryInsightEntities(memory);
    const labels = entities.map((entity) => `${entity.kind}:${entity.label}`);

    expect(labels).toEqual(
      expect.arrayContaining([
        "person_like:@alice",
        "named_term:mem9-ui",
        "named_term:netlify.app",
        "metric:09:30",
        "metric:32%",
        "metric:v1.2.3",
        "person_like:Ming Zhang",
      ]),
    );
  });

  it("deduplicates repeated extracted entities", () => {
    const memory = createMemory("mem-2", {
      content: 'Repeat `mem9-ui` and `mem9-ui` plus @bosn plus @bosn.',
    });

    const entities = extractMemoryInsightEntities(memory);

    expect(
      entities.filter(
        (entity) =>
          entity.kind === "named_term" && entity.normalizedLabel === "mem9-ui",
      ),
    ).toHaveLength(1);
    expect(
      entities.filter(
        (entity) =>
          entity.kind === "person_like" && entity.normalizedLabel === "@bosn",
      ),
    ).toHaveLength(1);
  });

  it("builds card to tag to entity to memory branches with untagged fallback", () => {
    const graph = buildMemoryInsightGraph({
      cards: [createCard("activity", 2), createCard("identity", 1)],
      memories: [
        createMemory("mem-1", {
          content: "Deploy `netlify-app` with Alice Johnson at 10:30",
          tags: ["netlify", "deploy"],
        }),
        createMemory("mem-2", {
          content: "Plain status update with no explicit entity markers.",
          tags: [],
        }),
      ],
      matchMap: new Map<string, MemoryAnalysisMatch>([
        [
          "mem-1",
          createMatch("mem-1", ["activity", "identity"]),
        ],
        [
          "mem-2",
          createMatch("mem-2", ["activity"]),
        ],
      ]),
    });

    const activityCard = graph.cards.find((card) => card.category === "activity");
    const identityCard = graph.cards.find((card) => card.category === "identity");

    expect(activityCard?.count).toBe(2);
    expect(identityCard?.count).toBe(1);
    expect(activityCard?.branchKey).toBe("activity");

    const sharedMemoryNodes = graph.memories.filter(
      (node) => node.memoryId === "mem-1",
    );
    expect(sharedMemoryNodes.length).toBeGreaterThanOrEqual(2);
    expect(
      new Set(sharedMemoryNodes.map((node) => node.category)),
    ).toEqual(new Set(["activity", "identity"]));

    const untaggedTag = graph.tags.find((tag) => tag.synthetic);
    expect(untaggedTag?.label).toBe("#untagged");
    expect(untaggedTag?.count).toBe(1);

    const fallbackEntity = graph.entities.find(
      (entity) => entity.parentId === untaggedTag?.id,
    );
    expect(fallbackEntity?.entityKind).toBe("fallback");
    expect(
      graph.memories.some((node) => node.parentId === fallbackEntity?.id),
    ).toBe(true);
  });

  it("deduplicates repeated entity mentions inside the same branch", () => {
    const graph = buildMemoryInsightGraph({
      cards: [createCard("project", 2)],
      memories: [
        createMemory("mem-1", {
          content: "Use `React Flow` and then mention `React Flow` again.",
          tags: ["graph"],
        }),
        createMemory("mem-2", {
          content: "Use `React Flow` in the canvas build.",
          tags: ["graph"],
        }),
      ],
      matchMap: new Map<string, MemoryAnalysisMatch>([
        ["mem-1", createMatch("mem-1", ["project"])],
        ["mem-2", createMatch("mem-2", ["project"])],
      ]),
    });

    const entityNodes = graph.entities.filter(
      (node) =>
        node.entityKind === "named_term" && node.entityValue === "React Flow",
    );

    expect(entityNodes).toHaveLength(1);
    expect(entityNodes[0]?.entityKind).toBe("named_term");
    expect(entityNodes[0]?.count).toBe(2);
    expect(
      graph.memories.filter(
        (node) =>
          node.kind === "memory" &&
          node.entityKind === "named_term" &&
          node.entityValue === "React Flow",
      ),
    ).toHaveLength(2);
  });

  it("keeps distinct entity and memory node ids when labels collapse to the same slug", () => {
    const graph = buildMemoryInsightGraph({
      cards: [createCard("artifact", 2)],
      memories: [
        createMemory("mem-1", {
          content: "Requested to go to `~/git/PingComp` and inspect the checkout.",
          tags: ["PingComp"],
        }),
        createMemory("mem-2", {
          content: "Requested to go to `git/PingComp` and inspect the checkout.",
          tags: ["PingComp"],
        }),
      ],
      matchMap: new Map<string, MemoryAnalysisMatch>([
        ["mem-1", createMatch("mem-1", ["artifact"])],
        ["mem-2", createMatch("mem-2", ["artifact"])],
      ]),
    });

    const tildeEntityId = buildInsightEntityNodeId(
      "artifact",
      "PingComp",
      "named_term",
      "~/git/PingComp",
    );
    const plainEntityId = buildInsightEntityNodeId(
      "artifact",
      "PingComp",
      "named_term",
      "git/PingComp",
    );

    expect(tildeEntityId).not.toBe(plainEntityId);
    expect(graph.entities.some((entity) => entity.id === tildeEntityId)).toBe(true);
    expect(graph.entities.some((entity) => entity.id === plainEntityId)).toBe(true);

    const tildeMemoryId = buildInsightMemoryNodeId(
      "artifact",
      "PingComp",
      "named_term",
      "~/git/PingComp",
      "mem-1",
    );
    const plainMemoryId = buildInsightMemoryNodeId(
      "artifact",
      "PingComp",
      "named_term",
      "git/PingComp",
      "mem-2",
    );

    expect(tildeMemoryId).not.toBe(plainMemoryId);
    expect(graph.memories.some((memoryNode) => memoryNode.id === tildeMemoryId)).toBe(true);
    expect(graph.memories.some((memoryNode) => memoryNode.id === plainMemoryId)).toBe(true);
  });

  it("keeps distinct branch ids when multiple raw tags collapse to the same slug", () => {
    const graph = buildMemoryInsightGraph({
      cards: [createCard("artifact", 1)],
      memories: [
        createMemory("mem-1", {
          content: "Verified `SKILL.md` after the release.",
          tags: ["README.md", "/README.md"],
        }),
      ],
      matchMap: new Map<string, MemoryAnalysisMatch>([
        ["mem-1", createMatch("mem-1", ["artifact"])],
      ]),
    });

    const plainTagId = buildInsightTagNodeId("artifact", "README.md");
    const slashTagId = buildInsightTagNodeId("artifact", "/README.md");

    expect(plainTagId).not.toBe(slashTagId);
    expect(graph.tags.some((tag) => tag.id === plainTagId)).toBe(true);
    expect(graph.tags.some((tag) => tag.id === slashTagId)).toBe(true);
    expect(graph.nodes).toHaveLength(new Set(graph.nodes.map((node) => node.id)).size);

    const plainEntityId = buildInsightEntityNodeId(
      "artifact",
      "README.md",
      "named_term",
      "SKILL.md",
    );
    const slashEntityId = buildInsightEntityNodeId(
      "artifact",
      "/README.md",
      "named_term",
      "SKILL.md",
    );

    expect(plainEntityId).not.toBe(slashEntityId);
    expect(graph.entities.some((entity) => entity.id === plainEntityId)).toBe(true);
    expect(graph.entities.some((entity) => entity.id === slashEntityId)).toBe(true);

    const plainMemoryId = buildInsightMemoryNodeId(
      "artifact",
      "README.md",
      "named_term",
      "SKILL.md",
      "mem-1",
    );
    const slashMemoryId = buildInsightMemoryNodeId(
      "artifact",
      "/README.md",
      "named_term",
      "SKILL.md",
      "mem-1",
    );

    expect(plainMemoryId).not.toBe(slashMemoryId);
    expect(graph.memories.some((memoryNode) => memoryNode.id === plainMemoryId)).toBe(true);
    expect(graph.memories.some((memoryNode) => memoryNode.id === slashMemoryId)).toBe(true);
  });

  it("filters low-signal tags out of browse aggregation", () => {
    const graph = buildMemoryInsightGraph({
      cards: [createCard("project", 2)],
      memories: [
        createMemory("mem-1", {
          content: "Deploy `mem9-ui` with Alice Johnson",
          tags: ["clawd", "import", "project-alpha"],
        }),
        createMemory("mem-2", {
          content: "Only generic tags on this memory",
          tags: ["clawd", "md", "json"],
        }),
      ],
      matchMap: new Map<string, MemoryAnalysisMatch>([
        ["mem-1", createMatch("mem-1", ["project"])],
        ["mem-2", createMatch("mem-2", ["project"])],
      ]),
    });

    expect(graph.tags.map((tag) => tag.tagValue)).toContain("project-alpha");
    expect(graph.tags.map((tag) => tag.tagValue)).not.toContain("clawd");
    expect(graph.tags.map((tag) => tag.tagValue)).not.toContain("import");
    expect(graph.tags.some((tag) => tag.synthetic && tag.tagValue === "__untagged__")).toBe(true);
  });

  it("uses derived tags to reduce untagged branches when a stable local signal exists", () => {
    const graph = buildMemoryInsightGraph({
      cards: [createCard("project", 2)],
      memories: [
        createMemory("mem-1", {
          content: "继续推进 `OpenClaw` 部署到 /srv/openclaw/config",
          tags: ["clawd", "md"],
        }),
        createMemory("mem-2", {
          content: "再次推进 `OpenClaw` 部署到 /srv/openclaw/config",
          tags: ["import", "json"],
        }),
      ],
      matchMap: new Map<string, MemoryAnalysisMatch>([
        ["mem-1", createMatch("mem-1", ["project"])],
        ["mem-2", createMatch("mem-2", ["project"])],
      ]),
    });

    expect(graph.tags.map((tag) => tag.tagValue)).toContain("OpenClaw");
    expect(graph.tags.map((tag) => tag.tagValue)).toContain("/openclaw/config");
    expect(graph.tags.some((tag) => tag.origin === "derived")).toBe(true);
    expect(graph.tags.some((tag) => tag.synthetic)).toBe(false);
  });

  it("matches memories against an entity filter", () => {
    const memory = createMemory("mem-3", {
      content: "Follow up with @alice on `mem9-ui` after 2h",
    });

    expect(
      memoryMatchesInsightEntity(memory, {
        id: "entity:person_like:@alice",
        label: "@alice",
        normalizedLabel: "@alice",
        kind: "person_like",
      }),
    ).toBe(true);
    expect(
      memoryMatchesInsightEntity(memory, {
        id: "entity:named_term:dashboard",
        label: "dashboard",
        normalizedLabel: "dashboard",
        kind: "named_term",
      }),
    ).toBe(false);
  });

  it("formats raw and prefixed category labels for insight nodes", () => {
    const translate = (key: string) =>
      key === "analysis.category.activity" ? "Activity" : key;

    expect(formatInsightCategoryLabel("activity", translate)).toBe("Activity");
    expect(
      formatInsightCategoryLabel("analysis.category.life_log", translate),
    ).toBe("Life Log");
    expect(formatInsightCategoryLabel("analysis.category.deep_work", translate)).toBe(
      "Deep Work",
    );
  });
});
