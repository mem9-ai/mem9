import type {
  AnalysisJobSnapshotResponse,
  DeepAnalysisReportDetail,
} from "@/types/analysis";
import {
  PIXEL_FARM_NPC_TIP_IDS,
  buildPixelFarmNpcDialogEntry,
} from "@/lib/pixel-farm/npc-tips";

export type PixelFarmNpcDialogSource =
  | "deep-analysis"
  | "analysis-snapshot"
  | "static-tip";

export interface PixelFarmNpcDialogCandidate {
  id: string;
  source: PixelFarmNpcDialogSource;
  templateKey: string;
  text: string;
}

export interface PixelFarmNpcDialogCatalog {
  deepInsights: PixelFarmNpcDialogCandidate[];
  lightInsights: PixelFarmNpcDialogCandidate[];
  tips: PixelFarmNpcDialogCandidate[];
}

export interface PixelFarmNpcDialogRotationState {
  activePoolSignature: string | null;
  lastEntryId: string | null;
  lastTemplateKey: string | null;
  remainingIds: string[];
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function buildDeepCandidates(
  deepReport: DeepAnalysisReportDetail | null,
  t: Translate,
): PixelFarmNpcDialogCandidate[] {
  const report = deepReport?.status === "COMPLETED" ? deepReport.report : null;
  if (!report) {
    return [];
  }

  const candidates: PixelFarmNpcDialogCandidate[] = [];
  const personaSummary = report.persona.summary.trim();
  if (personaSummary) {
    candidates.push({
      id: `deep-persona-summary:${personaSummary}`,
      source: "deep-analysis",
      templateKey: "persona-summary",
      text: t("pixel_farm.npc_dialog.deep.persona_summary", {
        summary: personaSummary,
      }),
    });
  }

  const topTheme = report.themeLandscape.highlights[0];
  if (topTheme?.name) {
    candidates.push({
      id: `deep-theme:${topTheme.name}`,
      source: "deep-analysis",
      templateKey: "theme-highlight",
      text: t("pixel_farm.npc_dialog.deep.theme_highlight", {
        theme: topTheme.name,
      }),
    });
  }

  const recommendation = report.recommendations[0];
  if (recommendation) {
    candidates.push({
      id: `deep-recommendation:${recommendation}`,
      source: "deep-analysis",
      templateKey: "recommendation",
      text: t("pixel_farm.npc_dialog.deep.recommendation", {
        recommendation,
      }),
    });
  }

  return candidates;
}

function buildLightCandidates(
  lightSnapshot: AnalysisJobSnapshotResponse | null,
  t: Translate,
): PixelFarmNpcDialogCandidate[] {
  if (!lightSnapshot || lightSnapshot.status !== "COMPLETED") {
    return [];
  }

  const candidates: PixelFarmNpcDialogCandidate[] = [];
  const summary = lightSnapshot.aggregate.summarySnapshot[0];
  if (summary) {
    candidates.push({
      id: `light-summary:${summary}`,
      source: "analysis-snapshot",
      templateKey: "summary-snapshot",
      text: t("pixel_farm.npc_dialog.light.summary_snapshot", {
        summary,
      }),
    });
  }

  const topTag = lightSnapshot.topTagStats?.[0];
  if (topTag?.value) {
    candidates.push({
      id: `light-tag:${topTag.value}`,
      source: "analysis-snapshot",
      templateKey: "top-tag",
      text: t("pixel_farm.npc_dialog.light.top_tag", {
        tag: topTag.value,
      }),
    });
  }

  const topTopic = lightSnapshot.topTopicStats?.[0];
  if (topTopic?.value) {
    candidates.push({
      id: `light-topic:${topTopic.value}`,
      source: "analysis-snapshot",
      templateKey: "top-topic",
      text: t("pixel_farm.npc_dialog.light.top_topic", {
        topic: topTopic.value,
      }),
    });
  }

  return candidates;
}

function buildTipCandidates(t: Translate): PixelFarmNpcDialogCandidate[] {
  return PIXEL_FARM_NPC_TIP_IDS.map((tipId) => {
    const entry = buildPixelFarmNpcDialogEntry(tipId, t);
    return {
      id: entry.id,
      source: "static-tip",
      templateKey: `tip:${tipId}`,
      text: entry.content,
    };
  });
}

export function buildPixelFarmNpcDialogCatalog(input: {
  deepReport: DeepAnalysisReportDetail | null;
  lightSnapshot: AnalysisJobSnapshotResponse | null;
  t: Translate;
}): PixelFarmNpcDialogCatalog {
  return {
    deepInsights: buildDeepCandidates(input.deepReport, input.t),
    lightInsights: buildLightCandidates(input.lightSnapshot, input.t),
    tips: buildTipCandidates(input.t),
  };
}

function resolveActivePool(
  catalog: PixelFarmNpcDialogCatalog,
): PixelFarmNpcDialogCandidate[] {
  return [
    ...catalog.deepInsights,
    ...catalog.lightInsights,
    ...catalog.tips,
  ];
}

function buildPoolSignature(pool: readonly PixelFarmNpcDialogCandidate[]): string {
  return pool.map((candidate) => candidate.id).join("|");
}

function shuffleCandidates<T>(
  items: readonly T[],
  random: () => number,
): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index]!;
    shuffled[index] = shuffled[swapIndex]!;
    shuffled[swapIndex] = current;
  }

  return shuffled;
}

function moveFirstAwayFromPrevious(
  pool: PixelFarmNpcDialogCandidate[],
  previousEntryId: string | null,
  previousTemplateKey: string | null,
): PixelFarmNpcDialogCandidate[] {
  if (pool.length < 2) {
    return pool;
  }

  const first = pool[0];
  if (!first) {
    return pool;
  }

  if (previousEntryId && first.id === previousEntryId) {
    const replacementIndex = pool.findIndex((candidate) => candidate.id !== previousEntryId);
    if (replacementIndex > 0) {
      const replacement = pool[replacementIndex]!;
      pool[replacementIndex] = first;
      pool[0] = replacement;
      return pool;
    }
  }

  if (previousTemplateKey && first.templateKey === previousTemplateKey) {
    const replacementIndex = pool.findIndex(
      (candidate) => candidate.templateKey !== previousTemplateKey,
    );
    if (replacementIndex > 0) {
      const replacement = pool[replacementIndex]!;
      pool[replacementIndex] = first;
      pool[0] = replacement;
    }
  }

  return pool;
}

function rebuildQueue(input: {
  pool: readonly PixelFarmNpcDialogCandidate[];
  previousEntryId: string | null;
  previousTemplateKey: string | null;
  random: () => number;
}): string[] {
  const shuffled = moveFirstAwayFromPrevious(
    shuffleCandidates(input.pool, input.random),
    input.previousEntryId,
    input.previousTemplateKey,
  );

  return shuffled.map((candidate) => candidate.id);
}

export function pickNextPixelFarmNpcDialogEntry(input: {
  catalog: PixelFarmNpcDialogCatalog;
  rotationState: PixelFarmNpcDialogRotationState | null;
  random?: () => number;
}): {
  entry: PixelFarmNpcDialogCandidate;
  rotationState: PixelFarmNpcDialogRotationState;
} {
  const random = input.random ?? Math.random;
  const pool = resolveActivePool(input.catalog);
  const poolSignature = buildPoolSignature(pool);
  const currentState = input.rotationState;

  const queue =
    currentState &&
    currentState.activePoolSignature === poolSignature &&
    currentState.remainingIds.length > 0
      ? currentState.remainingIds
      : rebuildQueue({
          pool,
          previousEntryId: currentState?.lastEntryId ?? null,
          previousTemplateKey: currentState?.lastTemplateKey ?? null,
          random,
        });

  const entryId = queue[0] ?? pool[0]?.id;
  const entry = pool.find((candidate) => candidate.id === entryId) ?? pool[0];
  if (!entry) {
    throw new Error("Pixel farm NPC dialog pool must contain at least one candidate.");
  }

  return {
    entry,
    rotationState: {
      activePoolSignature: poolSignature,
      lastEntryId: entry.id,
      lastTemplateKey: entry.templateKey,
      remainingIds: queue.filter((candidateId) => candidateId !== entry.id),
    },
  };
}
