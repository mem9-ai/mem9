import { describe, expect, it } from "vitest";
import type {
  AnalysisJobSnapshotResponse,
  DeepAnalysisReportDetail,
} from "@/types/analysis";
import {
  buildPixelFarmNpcDialogCatalog,
  pickNextPixelFarmNpcDialogEntry,
} from "./npc-dialog-content";

function translate(key: string, vars?: Record<string, string | number>): string {
  return `${key}:${JSON.stringify(vars ?? {})}`;
}

function createLightSnapshot(): AnalysisJobSnapshotResponse {
  return {
    jobId: "aj_1",
    status: "COMPLETED",
    expectedTotalMemories: 42,
    expectedTotalBatches: 1,
    batchSize: 42,
    pipelineVersion: "v1",
    taxonomyVersion: "v3",
    llmEnabled: true,
    createdAt: "2026-04-04T00:00:00.000Z",
    progress: {
      expectedTotalBatches: 1,
      uploadedBatches: 1,
      completedBatches: 1,
      failedBatches: 0,
      processedMemories: 42,
      resultVersion: 1,
    },
    aggregate: {
      categoryCounts: { "analysis.category.project": 10 },
      tagCounts: { Work: 12 },
      topicCounts: { planning: 8 },
      summarySnapshot: ["project focus", "planning streak"],
      resultVersion: 1,
    },
    aggregateCards: [],
    topTags: ["Work"],
    topTopics: ["planning"],
    topTagStats: [{ value: "Work", count: 12 }],
    topTopicStats: [{ value: "planning", count: 8 }],
    batchSummaries: [],
  };
}

function createDeepReport(): DeepAnalysisReportDetail {
  return {
    id: "dar_1",
    status: "COMPLETED",
    stage: "COMPLETE",
    progressPercent: 100,
    lang: "en",
    timezone: "Asia/Shanghai",
    memoryCount: 42,
    requestedAt: "2026-04-04T00:00:00.000Z",
    preview: null,
    report: {
      overview: {
        memoryCount: 42,
        deduplicatedMemoryCount: 40,
        generatedAt: "2026-04-04T00:00:00.000Z",
        lang: "en",
        timeSpan: {
          start: "2026-03-01T00:00:00.000Z",
          end: "2026-04-04T00:00:00.000Z",
        },
      },
      persona: {
        summary: "You keep circling around release prep.",
        goals: ["ship the next release"],
        notableRoutines: ["daily planning"],
      },
      themeLandscape: {
        highlights: [{ name: "release prep", count: 7, description: "shipping work" }],
      },
      entities: { people: [], teams: [], projects: [], tools: [], places: [] },
      relationships: [],
      quality: {
        duplicateRatio: 0,
        noisyMemoryCount: 0,
        duplicateClusters: [],
        lowQualityExamples: [],
        coverageGaps: [],
      },
      recommendations: ["protect focus time"],
      productSignals: { candidateNodes: [], candidateEdges: [], searchSeeds: [] },
    },
  };
}

describe("npc-dialog-content", () => {
  it("keeps deep-analysis, light-analysis, and tips in the same rotation pool", () => {
    const catalog = buildPixelFarmNpcDialogCatalog({
      deepReport: createDeepReport(),
      lightSnapshot: createLightSnapshot(),
      t: translate,
    });

    const seenSources = new Set<string>();
    let rotationState = null;

    for (
      let index = 0;
      index < catalog.deepInsights.length + catalog.lightInsights.length + catalog.tips.length;
      index += 1
    ) {
      const next = pickNextPixelFarmNpcDialogEntry({
        catalog,
        rotationState,
        random: () => 0,
      });
      seenSources.add(next.entry.source);
      rotationState = next.rotationState;
    }

    expect(seenSources).toEqual(new Set([
      "deep-analysis",
      "analysis-snapshot",
      "static-tip",
    ]));
  });

  it("keeps light-analysis lines and tips together when no deep-analysis report is available", () => {
    const catalog = buildPixelFarmNpcDialogCatalog({
      deepReport: null,
      lightSnapshot: createLightSnapshot(),
      t: translate,
    });

    const seenSources = new Set<string>();
    let rotationState = null;

    for (let index = 0; index < catalog.lightInsights.length + catalog.tips.length; index += 1) {
      const next = pickNextPixelFarmNpcDialogEntry({
        catalog,
        rotationState,
        random: () => 0,
      });
      seenSources.add(next.entry.source);
      rotationState = next.rotationState;
    }

    expect(seenSources).toEqual(new Set([
      "analysis-snapshot",
      "static-tip",
    ]));
  });

  it("falls back to static tips when no analysis source exists", () => {
    const catalog = buildPixelFarmNpcDialogCatalog({
      deepReport: null,
      lightSnapshot: null,
      t: translate,
    });

    const { entry } = pickNextPixelFarmNpcDialogEntry({
      catalog,
      rotationState: null,
      random: () => 0,
    });

    expect(entry.source).toBe("static-tip");
  });

  it("walks through the full combined pool before repeating entries", () => {
    const catalog = buildPixelFarmNpcDialogCatalog({
      deepReport: createDeepReport(),
      lightSnapshot: createLightSnapshot(),
      t: translate,
    });
    let rotationState = null;
    const entryIds = new Set<string>();

    for (
      let index = 0;
      index < catalog.deepInsights.length + catalog.lightInsights.length + catalog.tips.length;
      index += 1
    ) {
      const next = pickNextPixelFarmNpcDialogEntry({
        catalog,
        rotationState,
        random: () => 0,
      });
      entryIds.add(next.entry.id);
      rotationState = next.rotationState;
    }

    expect(entryIds.size).toBe(
      catalog.deepInsights.length + catalog.lightInsights.length + catalog.tips.length,
    );
  });

  it("starts a new shuffled round without immediately repeating the previous entry", () => {
    const catalog = buildPixelFarmNpcDialogCatalog({
      deepReport: createDeepReport(),
      lightSnapshot: createLightSnapshot(),
      t: translate,
    });
    let rotationState = null;
    let previousEntryId: string | null = null;

    for (
      let index = 0;
      index < catalog.deepInsights.length + catalog.lightInsights.length + catalog.tips.length;
      index += 1
    ) {
      const next = pickNextPixelFarmNpcDialogEntry({
        catalog,
        rotationState,
        random: () => 0,
      });
      previousEntryId = next.entry.id;
      rotationState = next.rotationState;
    }

    const nextRound = pickNextPixelFarmNpcDialogEntry({
      catalog,
      rotationState,
      random: () => 0,
    });

    expect(nextRound.entry.id).not.toBe(previousEntryId);
  });
});
