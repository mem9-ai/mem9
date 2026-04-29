import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Brain,
  Clock3,
  Database,
  Download,
  Layers,
  Lightbulb,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { analysisApi, AnalysisApiError } from "@/api/analysis-client";
import { useDeepAnalysisReports } from "@/api/deep-analysis-queries";
import { getSourceMemoriesQueryKey } from "@/api/source-memories";
import { DeepAnalysisOverlay } from "@/components/space/deep-analysis-overlay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type {
  DeepAnalysisDuplicateCleanupStatus,
  DeepAnalysisDiscoveryCard,
  DeepAnalysisEntityGroup,
  DeepAnalysisEvidenceHighlight,
  DeepAnalysisRelationship,
  DeepAnalysisReportDetail,
  DeepAnalysisThemeItem,
} from "@/types/analysis";

const TERMINAL_REPORT_STATUSES = new Set(["COMPLETED", "FAILED"]);
const ACTIVE_DUPLICATE_CLEANUP_STATUSES = new Set(["QUEUED", "RUNNING"]);

function formatDateTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function normalizeEntityGroups(value: unknown): DeepAnalysisEntityGroup[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const label = toStringOrNull(item.label);
    if (!label) {
      return [];
    }

    const evidenceMemoryIds = toStringArray(item.evidenceMemoryIds);
    return [{
      label,
      count: isFiniteNumber(item.count) ? item.count : Math.max(evidenceMemoryIds.length, 1),
      evidenceMemoryIds,
    }];
  });
}

function normalizeThemeHighlights(value: unknown): DeepAnalysisThemeItem[] {
  const rawItems = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.highlights)
      ? value.highlights
      : [];

  return rawItems.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const name = toStringOrNull(item.name);
    if (!name) {
      return [];
    }

    return [{
      name,
      count: isFiniteNumber(item.count) ? item.count : 0,
      description: toStringOrNull(item.description) ?? "",
    }];
  });
}

function getOverviewTimeSpan(report: DeepAnalysisReportDetail): {
  start: string | null;
  end: string | null;
} {
  const overview = report.report?.overview as
    | { timeSpan?: { start?: string | null; end?: string | null } }
    | undefined;

  return {
    start: overview?.timeSpan?.start ?? null,
    end: overview?.timeSpan?.end ?? null,
  };
}

function getDuplicateRatio(report: DeepAnalysisReportDetail): number {
  const quality = report.report?.quality as
    | { duplicateRatio?: number; duplicateMemoryCount?: number }
    | undefined;
  if (isFiniteNumber(quality?.duplicateRatio)) {
    return quality.duplicateRatio;
  }

  const duplicateMemoryCount = isFiniteNumber(quality?.duplicateMemoryCount)
    ? quality.duplicateMemoryCount
    : 0;
  const baseCount = report.report?.overview.memoryCount ?? report.memoryCount;
  return baseCount > 0 ? duplicateMemoryCount / baseCount : 0;
}

function getNoisyMemoryCount(report: DeepAnalysisReportDetail): number {
  const quality = report.report?.quality as
    | { noisyMemoryCount?: number; lowQualityExamples?: unknown }
    | undefined;
  if (isFiniteNumber(quality?.noisyMemoryCount)) {
    return quality.noisyMemoryCount;
  }

  return Array.isArray(quality?.lowQualityExamples) ? quality.lowQualityExamples.length : 0;
}

function countDuplicateMemories(
  report: DeepAnalysisReportDetail,
  removedDuplicateIds: string[] = [],
): number {
  const removed = new Set(removedDuplicateIds);
  const duplicateClusters = report.report?.quality.duplicateClusters ?? [];

  if (duplicateClusters.length > 0) {
    return duplicateClusters.reduce(
      (sum, cluster) =>
        sum + cluster.duplicateMemoryIds.filter((memoryId) => !removed.has(memoryId)).length,
      0,
    );
  }

  const reportedCount = report.report?.quality.duplicateMemoryCount ?? 0;
  return Math.max(0, reportedCount - removed.size);
}

function getDuplicateCleanupStatus(
  report: DeepAnalysisReportDetail,
): DeepAnalysisDuplicateCleanupStatus | null {
  return report.preview?.duplicateCleanup ?? null;
}

function isDuplicateCleanupPending(
  cleanup: DeepAnalysisDuplicateCleanupStatus | null | undefined,
): boolean {
  return !!cleanup && ACTIVE_DUPLICATE_CLEANUP_STATUSES.has(cleanup.status);
}

function getDuplicateCleanupFeedback(
  cleanup: DeepAnalysisDuplicateCleanupStatus | null,
  t: TFunction,
): { tone: "success" | "error" | "muted"; message: string } | null {
  if (!cleanup) {
    return null;
  }

  if (cleanup.status === "QUEUED" || cleanup.status === "RUNNING") {
    return {
      tone: "muted",
      message: t("deep_analysis.quality.delete_running", {
        count: cleanup.totalCount,
      }),
    };
  }

  if (cleanup.status === "FAILED") {
    return {
      tone: "error",
      message: cleanup.errorMessage
        ? `${t("deep_analysis.quality.delete_failed")} ${cleanup.errorMessage}`
        : t("deep_analysis.quality.delete_failed"),
    };
  }

  return cleanup.failedCount > 0
    ? {
      tone: "success",
      message: t("deep_analysis.quality.delete_partial", {
        deleted: cleanup.deletedCount,
        failed: cleanup.failedCount,
      }),
    }
    : {
      tone: "success",
      message: t("deep_analysis.quality.delete_success", {
        count: cleanup.deletedCount,
      }),
    };
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ReportSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="surface-card px-5 py-6 sm:px-7">
      <div className="mb-4 flex items-center gap-2.5 border-b border-border/50 pb-3">
        {icon ?? <span className="h-4 w-[3px] rounded-full bg-primary/40" />}
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/60">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

const WORD_CLOUD_COLORS = [
  "#f472b6", // pink
  "#60a5fa", // blue
  "#34d399", // emerald
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#fb923c", // orange
  "#2dd4bf", // teal
  "#f87171", // red
  "#818cf8", // indigo
  "#4ade80", // green
  "#e879f9", // fuchsia
  "#38bdf8", // sky
  "#facc15", // yellow
  "#c084fc", // purple
  "#fb7185", // rose
];

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    return (state >>> 0) / 0xffffffff;
  };
}

function EntityWordCloud({
  groups,
  onEntityClick,
}: {
  groups: { label: string; items: DeepAnalysisEntityGroup[] }[];
  onEntityClick?: (label: string) => void;
}) {
  const allItems = groups.flatMap((group) => group.items);
  if (allItems.length === 0) {
    return null;
  }

  const maxCount = Math.max(...allItems.map((item) => item.count));
  const minCount = Math.min(...allItems.map((item) => item.count));
  const range = maxCount - minCount || 1;

  const rand = seededRandom(42);

  // Sort: largest in the center, smaller towards edges (alternating left/right insertion)
  const sorted = [...allItems].sort((a, b) => b.count - a.count);
  const arranged: typeof allItems = [];
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (!item) {
      continue;
    }
    if (i % 2 === 0) {
      arranged.push(item);
    } else {
      arranged.unshift(item);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-center py-6 px-2">
      {arranged.map((item, idx) => {
        const ratio = (item.count - minCount) / range;
        const fontSize = 0.65 + ratio * 1.6;
        const color = WORD_CLOUD_COLORS[idx % WORD_CLOUD_COLORS.length];
        const opacity = 0.55 + ratio * 0.45;
        const shouldRotate = rand() > 0.8;
        const rotation = shouldRotate ? (rand() > 0.5 ? 90 : -90) : 0;

        // Organic spacing: vary horizontal and vertical margins pseudo-randomly
        const hGap = Math.round(4 + rand() * 12);
        const vGap = Math.round(2 + rand() * 8);
        const vShift = Math.round((rand() - 0.5) * 14);
        const verticalPad = shouldRotate ? `${Math.round(fontSize * 8)}px` : `${vGap}px`;

        return (
          <button
            type="button"
            key={item.label}
            onClick={() => onEntityClick?.(item.label)}
            className="inline-block cursor-pointer select-none whitespace-nowrap transition-transform hover:scale-110 hover:brightness-125"
            style={{
              fontSize: `${fontSize}rem`,
              color,
              opacity,
              fontWeight: ratio > 0.5 ? 700 : ratio > 0.2 ? 500 : 400,
              transform: `rotate(${rotation}deg) translateY(${vShift}px)`,
              marginLeft: `${hGap}px`,
              marginRight: `${hGap}px`,
              marginTop: verticalPad,
              marginBottom: verticalPad,
              background: "none",
              border: "none",
              padding: 0,
              lineHeight: 1.1,
            }}
            title={`${item.label}: ${item.count} memories`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function RelationshipList({
  items,
}: {
  items: DeepAnalysisRelationship[];
}) {
  if (items.length === 0) {
    return <p className="text-sm text-soft-foreground">No strong relationship signals yet.</p>;
  }

  const relationColors = [
    "var(--facet-people)",
    "var(--facet-about-you)",
    "var(--facet-experiences)",
    "var(--facet-plans)",
    "var(--facet-preferences)",
    "var(--facet-routines)",
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item, index) => (
        <div
          key={`${item.source}-${item.target}-${index}`}
          className="rounded-xl border border-border/70 bg-popover/70 px-3 py-3"
          style={{ borderLeftWidth: 3, borderLeftColor: relationColors[index % relationColors.length] }}
        >
          <div className="text-sm font-medium text-foreground">
            {item.source}{" "}
            <span className="text-soft-foreground">{item.relation}</span>{" "}
            {item.target}
          </div>
          <div className="mt-1 text-[11px] text-soft-foreground">
            Confidence {Math.round(item.confidence * 100)}%
          </div>
          {item.evidenceExcerpts.length > 0 && (
            <div className="mt-2 text-sm text-foreground/85 line-clamp-2">
              {item.evidenceExcerpts[0]}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const PERSONA_SECTION_COLORS: Record<string, string> = {
  working_style: "var(--facet-experiences)",
  preferences: "var(--facet-preferences)",
  goals: "var(--facet-plans)",
  constraints: "var(--facet-constraints)",
  decision_signals: "var(--facet-about-you)",
  notable_routines: "var(--facet-routines)",
  contradictions: "var(--facet-people)",
};

function PersonaList({
  title,
  colorKey,
  items,
}: {
  title: string;
  colorKey?: string;
  items: string[];
}) {
  if (items.length === 0) {
    return null;
  }

  const accentColor = (colorKey && PERSONA_SECTION_COLORS[colorKey]) || "var(--facet-other)";

  return (
    <div className="rounded-lg border border-border/40 bg-popover/30 px-3.5 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground/80">
        <span className="inline-block size-2 rounded-full" style={{ backgroundColor: accentColor }} />
        {title}
      </div>
      <div className="space-y-1.5 text-sm text-foreground/85">
        {items.map((item) => (
          <p key={item} className="pl-4">{item}</p>
        ))}
      </div>
    </div>
  );
}

function EvidenceList({
  title,
  items,
}: {
  title: string;
  items: DeepAnalysisEvidenceHighlight[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-foreground/80">{title}</div>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item, idx) => (
          <div
            key={`${item.title}-${item.detail}`}
            className="rounded-xl border border-border/70 bg-popover/70 px-3 py-3"
            style={{
              borderTopWidth: 2,
              borderTopColor: [
                "var(--facet-about-you)",
                "var(--facet-experiences)",
                "var(--facet-plans)",
                "var(--facet-preferences)",
              ][idx % 4],
            }}
          >
            <div className="text-sm font-medium text-foreground">{item.title}</div>
            <p className="mt-2 text-sm leading-6 text-foreground/85">{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiscoveryCardList({
  items,
}: {
  items: DeepAnalysisDiscoveryCard[];
}) {
  if (items.length === 0) {
    return <p className="text-sm text-soft-foreground">No high-confidence discovery cards yet.</p>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.id} className="rounded-xl border border-border/70 border-t-2 border-t-primary/20 bg-popover/70 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm font-semibold text-foreground">{item.title}</div>
            <Badge variant={item.confidence > 0.8 ? "default" : "outline"}>
              {Math.round(item.confidence * 100)}%
            </Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-foreground/85">{item.summary}</p>
        </div>
      ))}
    </div>
  );
}

function ReportDetail({
  report,
  removedDuplicateIds,
  onDownloadDuplicates,
  onDeleteDuplicates,
  isDownloadingDuplicates,
  isDeletingDuplicates,
  downloadError,
  deleteError,
  deleteFeedback,
  onEntitySearch,
}: {
  report: DeepAnalysisReportDetail;
  removedDuplicateIds: string[];
  onDownloadDuplicates: () => Promise<void>;
  onDeleteDuplicates: () => Promise<void>;
  isDownloadingDuplicates: boolean;
  isDeletingDuplicates: boolean;
  downloadError: string | null;
  deleteError: string | null;
  deleteFeedback: string | null;
  onEntitySearch?: (query: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const duplicateCleanup = getDuplicateCleanupStatus(report);
  const duplicateCleanupFeedback = getDuplicateCleanupFeedback(duplicateCleanup, t);
  const duplicateCleanupPending = isDuplicateCleanupPending(duplicateCleanup);
  const duplicateCount = countDuplicateMemories(report, removedDuplicateIds);
  const overviewTimeSpan = getOverviewTimeSpan(report);
  const themeHighlights = normalizeThemeHighlights(report.report?.themeLandscape);
  const entities = report.report?.entities as
    | {
      people?: unknown;
      teams?: unknown;
      projects?: unknown;
      tools?: unknown;
      places?: unknown;
    }
    | undefined;
  const normalizedEntityGroups = [
    { label: t("deep_analysis.entities.people"), items: normalizeEntityGroups(entities?.people) },
    { label: t("deep_analysis.entities.teams"), items: normalizeEntityGroups(entities?.teams) },
    { label: t("deep_analysis.entities.projects"), items: normalizeEntityGroups(entities?.projects) },
    { label: t("deep_analysis.entities.tools"), items: normalizeEntityGroups(entities?.tools) },
    { label: t("deep_analysis.entities.places"), items: normalizeEntityGroups(entities?.places) },
  ];

  return (
    <div className="space-y-4">
      <ReportSection title={t("deep_analysis.sections.overview")}>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border/70 border-l-2 border-l-primary/25 bg-popover/70 px-3 py-3">
            <div className="flex items-center gap-2">
              <Database className="size-3.5 text-soft-foreground" />
              <div className="text-xl font-semibold text-foreground">
                {report.memoryCount}
              </div>
            </div>
            <div className="mt-1 text-[11px] text-soft-foreground">
              {t("deep_analysis.metrics.memories")}
            </div>
          </div>
          <div className="rounded-xl border border-border/70 border-l-2 border-l-primary/25 bg-popover/70 px-3 py-3">
            <div className="flex items-center gap-2">
              <Layers className="size-3.5 text-soft-foreground" />
              <div className="text-xl font-semibold text-foreground">
                {report.report?.overview.deduplicatedMemoryCount ?? report.memoryCount}
              </div>
            </div>
            <div className="mt-1 text-[11px] text-soft-foreground">
              {t("deep_analysis.metrics.deduplicated")}
            </div>
          </div>
          <div className="rounded-xl border border-border/70 border-l-2 border-l-primary/25 bg-popover/70 px-3 py-3">
            <div className="text-sm font-semibold text-foreground">
              {overviewTimeSpan.start
                ? formatDateTime(overviewTimeSpan.start, i18n.language)
                : "—"}
            </div>
            <div className="mt-1 text-[11px] text-soft-foreground">
              {t("deep_analysis.metrics.start")}
            </div>
          </div>
          <div className="rounded-xl border border-border/70 border-l-2 border-l-primary/25 bg-popover/70 px-3 py-3">
            <div className="text-sm font-semibold text-foreground">
              {overviewTimeSpan.end
                ? formatDateTime(overviewTimeSpan.end, i18n.language)
                : "—"}
            </div>
            <div className="mt-1 text-[11px] text-soft-foreground">
              {t("deep_analysis.metrics.end")}
            </div>
          </div>
        </div>
      </ReportSection>

      <ReportSection title={t("deep_analysis.sections.persona")}>
        <div className="rounded-xl bg-primary/[0.04] px-4 py-3 dark:bg-primary/[0.06]">
          <p className="text-sm leading-6 text-foreground/90">
            {report.report?.persona.summary ?? report.preview?.summary ?? t("deep_analysis.pending")}
          </p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <PersonaList
            title={t("deep_analysis.persona.working_style")}
            colorKey="working_style"
            items={report.report?.persona.workingStyle ?? []}
          />
          <PersonaList
            title={t("deep_analysis.persona.preferences")}
            colorKey="preferences"
            items={report.report?.persona.preferences ?? []}
          />
          <PersonaList
            title={t("deep_analysis.persona.goals")}
            colorKey="goals"
            items={report.report?.persona.goals ?? []}
          />
          <PersonaList
            title={t("deep_analysis.persona.constraints")}
            colorKey="constraints"
            items={report.report?.persona.constraints ?? []}
          />
          <PersonaList
            title={t("deep_analysis.persona.decision_signals")}
            colorKey="decision_signals"
            items={report.report?.persona.decisionSignals ?? []}
          />
          <PersonaList
            title={t("deep_analysis.persona.notable_routines")}
            colorKey="notable_routines"
            items={report.report?.persona.notableRoutines ?? report.report?.persona.habits ?? []}
          />
          <PersonaList
            title={t("deep_analysis.persona.contradictions")}
            colorKey="contradictions"
            items={report.report?.persona.contradictionsOrTensions ?? []}
          />
        </div>
        <div className="mt-4">
          <EvidenceList
            title={t("deep_analysis.persona.evidence")}
            items={report.report?.persona.evidenceHighlights ?? []}
          />
        </div>
      </ReportSection>

      <ReportSection title={t("deep_analysis.sections.discoveries")}>
        <DiscoveryCardList items={report.report?.discoveries ?? []} />
      </ReportSection>

      <ReportSection title={t("deep_analysis.sections.themes")}>
        <div className="grid gap-3 md:grid-cols-2">
          {themeHighlights.map((item, idx) => (
            <div key={item.name} className="rounded-xl border border-border/70 bg-popover/70 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{
                      backgroundColor: [
                        "var(--facet-about-you)",
                        "var(--facet-preferences)",
                        "var(--facet-people)",
                        "var(--facet-experiences)",
                        "var(--facet-plans)",
                        "var(--facet-routines)",
                      ][idx % 6],
                    }}
                  />
                  {item.name}
                </div>
                <Badge variant="outline">{item.count}</Badge>
              </div>
              <p className="mt-2 text-sm text-soft-foreground">{item.description}</p>
            </div>
          ))}
        </div>
      </ReportSection>

      <ReportSection title={t("deep_analysis.sections.relationships")}>
        <RelationshipList items={report.report?.relationships ?? []} />
      </ReportSection>

      <ReportSection title={t("deep_analysis.sections.entities")}>
        <EntityWordCloud
          groups={normalizedEntityGroups}
          onEntityClick={onEntitySearch}
        />
      </ReportSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <ReportSection title={t("deep_analysis.sections.quality")} icon={<ShieldCheck className="size-3.5 text-primary/50" />}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5 text-sm text-foreground/85">
              <p>
                {t("deep_analysis.quality.duplicate_ratio")}:{" "}
                {Math.round(getDuplicateRatio(report) * 100)}%
              </p>
              <p>
                {t("deep_analysis.quality.duplicate_count")}: {duplicateCount}
              </p>
              <p>
                {t("deep_analysis.quality.noisy_memories")}:{" "}
                {getNoisyMemoryCount(report)}
              </p>
              {(report.report?.quality.coverageGaps ?? []).map((item) => (
                <p key={item} className="text-soft-foreground">{item}</p>
              ))}
              {downloadError && (
                <p className="text-xs text-destructive">{downloadError}</p>
              )}
              {deleteError && (
                <p className="text-xs text-destructive">{deleteError}</p>
              )}
              {duplicateCleanupFeedback?.tone === "error" && !deleteError && (
                <p className="text-xs text-destructive">{duplicateCleanupFeedback.message}</p>
              )}
              {duplicateCleanupFeedback?.tone === "muted" && !deleteError && (
                <p className="text-xs text-soft-foreground">{duplicateCleanupFeedback.message}</p>
              )}
              {duplicateCleanupFeedback?.tone === "success" && !deleteError && (
                <p className="text-xs text-emerald-500">{duplicateCleanupFeedback.message}</p>
              )}
              {deleteFeedback && !deleteError && (
                <p className="text-xs text-emerald-500">{deleteFeedback}</p>
              )}
            </div>
            {duplicateCount > 0 && (
              <div className="flex shrink-0 flex-col gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void onDownloadDuplicates();
                  }}
                  disabled={isDownloadingDuplicates || isDeletingDuplicates}
                  className="h-8 gap-1.5 text-xs"
                >
                  {isDownloadingDuplicates ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  {t("deep_analysis.quality.download_short")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    void onDeleteDuplicates();
                  }}
                  disabled={isDeletingDuplicates || isDownloadingDuplicates || duplicateCleanupPending}
                  className="h-8 gap-1.5 text-xs"
                >
                  {isDeletingDuplicates || duplicateCleanupPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  {t("deep_analysis.quality.delete_short")}
                </Button>
              </div>
            )}
          </div>
        </ReportSection>

        <ReportSection title={t("deep_analysis.sections.recommendations")} icon={<Lightbulb className="size-3.5 text-primary/50" />}>
          <div className="space-y-2.5">
            {(report.report?.recommendations ?? []).map((item, idx) => (
              <div key={item} className="flex items-start gap-3 text-sm text-foreground/85">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                  {idx + 1}
                </span>
                <p>{item}</p>
              </div>
            ))}
          </div>
        </ReportSection>
      </div>
    </div>
  );
}

export function DeepAnalysisTab({
  spaceId,
  active,
  onEntitySearch,
}: {
  spaceId: string;
  active: boolean;
  onEntitySearch?: (query: string) => void;
}) {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [deletingWholeReportId, setDeletingWholeReportId] = useState<string | null>(null);
  const [deleteDuplicatesTarget, setDeleteDuplicatesTarget] = useState<string | null>(null);
  const [deleteReportTarget, setDeleteReportTarget] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteFeedback, setDeleteFeedback] = useState<string | null>(null);
  const handledCleanupSignatureRef = useRef<string | null>(null);
  const {
    reports,
    selectedReport,
    selectedReportId,
    setSelectedReportId,
    inlineError,
    clearInlineError,
    isLoading,
    isCreating,
    createReport,
  } = useDeepAnalysisReports(spaceId, active);
  const hasActiveReport = isCreating || (!isLoading && reports.some(
    (report) => !TERMINAL_REPORT_STATUSES.has(report.status),
  ));

  useEffect(() => {
    const cleanup = selectedReport?.preview?.duplicateCleanup;
    if (!selectedReport || !cleanup || (cleanup.status !== "COMPLETED" && cleanup.status !== "FAILED")) {
      return;
    }

    const signature = [
      selectedReport.id,
      cleanup.status,
      cleanup.completedAt ?? "",
      cleanup.deletedCount,
      cleanup.failedCount,
    ].join(":");

    if (handledCleanupSignatureRef.current === signature) {
      return;
    }

    handledCleanupSignatureRef.current = signature;
    setDeleteFeedback(null);
    if (cleanup.status === "FAILED") {
      setDeleteError(
        cleanup.errorMessage
          ? `${t("deep_analysis.quality.delete_failed")} ${cleanup.errorMessage}`
          : t("deep_analysis.quality.delete_failed"),
      );
      return;
    }

    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["space", spaceId, "memories"] }),
      queryClient.invalidateQueries({ queryKey: ["space", spaceId, "stats"] }),
      queryClient.invalidateQueries({ queryKey: getSourceMemoriesQueryKey(spaceId) }),
    ]);
  }, [queryClient, selectedReport, spaceId, t]);

  const handleCreateReport = async () => {
    clearInlineError();
    await createReport({
      lang: i18n.language || "zh-CN",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
  };

  const handleDownloadDuplicates = async () => {
    if (!selectedReport) {
      return;
    }

    setDownloadError(null);
    setDeleteError(null);
    setDeleteFeedback(null);
    setDownloadingReportId(selectedReport.id);
    try {
      const blob = await analysisApi.downloadDeepAnalysisDuplicatesCsv(spaceId, selectedReport.id);
      triggerBlobDownload(blob, `deep-analysis-${selectedReport.id}-duplicate-cleanup.csv`);
    } catch (error) {
      setDownloadError(
        error instanceof AnalysisApiError
          ? error.message
          : t("deep_analysis.quality.download_failed"),
      );
    } finally {
      setDownloadingReportId(null);
    }
  };

  const handleDeleteDuplicates = async () => {
    if (!selectedReport) {
      return;
    }

    setDeleteDuplicatesTarget(selectedReport.id);
  };

  const confirmDeleteDuplicates = async (reportId: string) => {
    setDeleteError(null);
    setDeleteFeedback(null);
    setDownloadError(null);
    setDeleteDuplicatesTarget(null);
    setDeletingReportId(reportId);
    try {
      const result = await analysisApi.deleteDeepAnalysisDuplicates(spaceId, reportId);
      setDeleteFeedback(
        result.duplicateCleanup.status === "COMPLETED"
          ? t("deep_analysis.quality.delete_success", {
            count: result.duplicateCleanup.deletedCount,
          })
          : t("deep_analysis.quality.delete_started", {
            count: result.duplicateCleanup.totalCount,
          }),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["space", spaceId, "deepAnalysis", "reports"] }),
        queryClient.invalidateQueries({ queryKey: ["space", spaceId, "deepAnalysis", "report", reportId] }),
      ]);
    } catch (error) {
      setDeleteError(
        error instanceof AnalysisApiError
          ? error.message
          : t("deep_analysis.quality.delete_failed"),
      );
    } finally {
      setDeletingReportId((current) => (current === reportId ? null : current));
    }
  };

  const confirmDeleteReport = async (reportId: string) => {
    setDeleteReportTarget(null);
    setDeleteError(null);
    setDeleteFeedback(null);
    setDownloadError(null);
    setDeletingWholeReportId(reportId);
    try {
      await analysisApi.deleteDeepAnalysisReport(spaceId, reportId);
      const nextReportId = reports.find((report) => report.id !== reportId)?.id ?? null;
      if (selectedReportId === reportId) {
        setSelectedReportId(nextReportId);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["space", spaceId, "deepAnalysis", "reports"] }),
        queryClient.invalidateQueries({ queryKey: ["space", spaceId, "deepAnalysis", "report", reportId] }),
      ]);
    } catch (error) {
      toast.error(
        error instanceof AnalysisApiError
          ? error.message
          : t("deep_analysis.report_actions.delete_failed"),
      );
    } finally {
      setDeletingWholeReportId(null);
    }
  };

  // The empty-state card below already surfaces a primary "Create report" CTA
  // when there are no reports yet, so we hide the redundant header CTA in that
  // case to avoid duplicate prompts.
  const showHeaderCreateButton = reports.length > 0;

  return (
    <div className="space-y-4">
      <DeepAnalysisOverlay active={hasActiveReport} />
      <div className="surface-card flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="size-4 text-primary" />
            <div className="text-lg font-semibold text-foreground">
              {t("deep_analysis.title")}
            </div>
          </div>
          <p className="mt-2 text-sm text-soft-foreground">
            {t("deep_analysis.subtitle")}
          </p>
        </div>
        {showHeaderCreateButton && (
          <Button
            onClick={() => {
              void handleCreateReport();
            }}
            disabled={isCreating || hasActiveReport}
            className="gap-2"
          >
            {isCreating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {t("deep_analysis.create")}
          </Button>
        )}
      </div>

      {inlineError && (
        <div className="surface-card flex items-start gap-3 px-4 py-4 text-sm sm:px-6">
          <AlertTriangle className="mt-0.5 size-4 text-amber-500" />
          <p className="text-foreground/90">{inlineError}</p>
        </div>
      )}

      {isLoading && reports.length === 0 && (
        <div className="surface-card flex items-center gap-3 px-4 py-6 sm:px-6">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span className="text-sm text-soft-foreground">{t("deep_analysis.loading")}</span>
        </div>
      )}

      {!isLoading && reports.length === 0 && (
        <div className="surface-card px-4 py-10 text-center sm:px-6">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-popover/70">
            <Clock3 className="size-5 text-soft-foreground" />
          </div>
          <div className="mt-4 text-lg font-semibold text-foreground">
            {t("deep_analysis.empty_title")}
          </div>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-soft-foreground">
            {t("deep_analysis.empty_body")}
          </p>
          <Button
            onClick={() => {
              void handleCreateReport();
            }}
            disabled={isCreating || hasActiveReport}
            className="mt-5 gap-2"
          >
            {isCreating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {t("deep_analysis.create")}
          </Button>
        </div>
      )}

      {reports.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {reports.map((report) => {
              const selected = report.id === selectedReportId;
              const allowDelete = TERMINAL_REPORT_STATUSES.has(report.status);
              const duplicateCleanupPending = isDuplicateCleanupPending(report.preview?.duplicateCleanup);
              return (
                <div
                  key={report.id}
                  className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
                    selected
                      ? "surface-card-selected border-primary/30"
                      : "border-border/50 bg-card/60 hover:bg-secondary/60 cursor-pointer"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDownloadError(null);
                      setDeleteError(null);
                      setDeleteFeedback(null);
                      setSelectedReportId(report.id);
                    }}
                    className="text-left"
                  >
                    <div className="text-sm font-semibold text-foreground whitespace-nowrap">
                      {formatDateTime(report.requestedAt, i18n.language)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-soft-foreground whitespace-nowrap">
                      {report.memoryCount} {t("deep_analysis.memories_suffix")}
                    </div>
                  </button>
                  {!report.completedAt && (
                    <div className="w-16">
                      <Progress value={report.progressPercent} />
                    </div>
                  )}
                  {allowDelete && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setDeleteReportTarget(report.id);
                      }}
                      disabled={deletingWholeReportId === report.id || duplicateCleanupPending}
                      aria-label={t("deep_analysis.report_actions.delete")}
                      className="size-7 shrink-0 text-soft-foreground hover:text-destructive"
                    >
                      {deletingWholeReportId === report.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {selectedReport && (
            <div className="space-y-4">
              {selectedReport.report ? (
                <ReportDetail
                  report={selectedReport}
                  removedDuplicateIds={selectedReport.preview?.duplicateCleanup?.deletedMemoryIds ?? []}
                  onDownloadDuplicates={handleDownloadDuplicates}
                  onDeleteDuplicates={handleDeleteDuplicates}
                  isDownloadingDuplicates={downloadingReportId === selectedReport.id}
                  isDeletingDuplicates={deletingReportId === selectedReport.id}
                  downloadError={downloadError}
                  deleteError={deleteError}
                  deleteFeedback={deleteFeedback}
                  onEntitySearch={onEntitySearch}
                />
              ) : (
                <div className="surface-card px-4 py-8 text-center sm:px-6">
                  {selectedReport.status !== "FAILED" && (
                    <div className="mx-auto mt-4 max-w-xl">
                      <Progress value={selectedReport.progressPercent} />
                    </div>
                  )}
                  <p className="mt-4 text-sm text-soft-foreground">
                    {selectedReport.status === "FAILED"
                      ? t("deep_analysis.failed_body")
                      : t("deep_analysis.loading")}
                  </p>
                  {selectedReport.errorMessage && (
                    <div className="mx-auto mt-4 max-w-2xl rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-foreground/85">
                      {selectedReport.errorMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Dialog open={deleteReportTarget !== null} onOpenChange={(open) => { if (!open) setDeleteReportTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deep_analysis.report_actions.delete")}</DialogTitle>
            <DialogDescription>
              {t("deep_analysis.report_actions.delete_confirm")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteReportTarget(null)}
            >
              {t("delete.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (deleteReportTarget) {
                  void confirmDeleteReport(deleteReportTarget);
                }
              }}
            >
              {t("delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDuplicatesTarget !== null} onOpenChange={(open) => { if (!open) setDeleteDuplicatesTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deep_analysis.quality.delete_duplicates")}</DialogTitle>
            <DialogDescription>
              {t("deep_analysis.quality.delete_confirm")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteDuplicatesTarget(null)}
            >
              {t("delete.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (deleteDuplicatesTarget) {
                  void confirmDeleteDuplicates(deleteDuplicatesTarget);
                }
              }}
            >
              {t("delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
