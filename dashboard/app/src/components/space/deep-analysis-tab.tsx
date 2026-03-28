import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  Sparkles,
} from "lucide-react";
import { analysisApi, AnalysisApiError } from "@/api/analysis-client";
import { useDeepAnalysisReports } from "@/api/deep-analysis-queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type {
  DeepAnalysisDiscoveryCard,
  DeepAnalysisEntityGroup,
  DeepAnalysisEvidenceHighlight,
  DeepAnalysisRelationship,
  DeepAnalysisReportDetail,
  DeepAnalysisReportListItem,
} from "@/types/analysis";

function formatDateTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusVariant(status: DeepAnalysisReportListItem["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "COMPLETED") return "default";
  if (status === "FAILED") return "destructive";
  if (status === "QUEUED") return "outline";
  return "secondary";
}

function countDuplicateMemories(report: DeepAnalysisReportDetail): number {
  if (typeof report.report?.quality.duplicateMemoryCount === "number") {
    return report.report.quality.duplicateMemoryCount;
  }
  return (report.report?.quality.duplicateClusters ?? []).reduce(
    (sum, cluster) => sum + cluster.duplicateMemoryIds.length,
    0,
  );
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
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="surface-card px-4 py-5 sm:px-6">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-soft-foreground">
        {title}
      </div>
      {children}
    </section>
  );
}

function EntityGroupList({
  label,
  items,
}: {
  label: string;
  items: DeepAnalysisEntityGroup[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-foreground/80">{label}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <div
            key={`${label}-${item.label}`}
            className="rounded-xl border border-border/70 bg-popover/70 px-3 py-2"
          >
            <div className="text-sm font-medium text-foreground">{item.label}</div>
            <div className="mt-1 text-[11px] text-soft-foreground">
              {item.count} memories
            </div>
          </div>
        ))}
      </div>
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

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={`${item.source}-${item.target}-${index}`} className="rounded-xl border border-border/70 bg-popover/70 px-3 py-3">
          <div className="text-sm font-medium text-foreground">
            {item.source} <span className="text-soft-foreground">{item.relation}</span> {item.target}
          </div>
          <div className="mt-1 text-[11px] text-soft-foreground">
            Confidence {Math.round(item.confidence * 100)}%
          </div>
          {item.evidenceExcerpts.length > 0 && (
            <div className="mt-2 text-sm text-foreground/85">
              {item.evidenceExcerpts[0]}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PersonaList({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-foreground/80">{title}</div>
      <div className="space-y-2 text-sm text-foreground/85">
        {items.map((item) => (
          <p key={item}>{item}</p>
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
      <div className="space-y-3">
        {items.map((item) => (
          <div key={`${item.title}-${item.detail}`} className="rounded-xl border border-border/70 bg-popover/70 px-3 py-3">
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
        <div key={item.id} className="rounded-xl border border-border/70 bg-popover/70 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm font-semibold text-foreground">{item.title}</div>
            <Badge variant="outline">{Math.round(item.confidence * 100)}%</Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-foreground/85">{item.summary}</p>
        </div>
      ))}
    </div>
  );
}

function ReportDetail({
  report,
  onDownloadDuplicates,
  isDownloadingDuplicates,
  downloadError,
}: {
  report: DeepAnalysisReportDetail;
  onDownloadDuplicates: () => Promise<void>;
  isDownloadingDuplicates: boolean;
  downloadError: string | null;
}) {
  const { t, i18n } = useTranslation();
  const duplicateCount = countDuplicateMemories(report);

  return (
    <div className="space-y-4">
      <ReportSection title={t("deep_analysis.sections.overview")}>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border/70 bg-popover/70 px-3 py-3">
            <div className="text-xl font-semibold text-foreground">
              {report.memoryCount}
            </div>
            <div className="mt-1 text-[11px] text-soft-foreground">
              {t("deep_analysis.metrics.memories")}
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-popover/70 px-3 py-3">
            <div className="text-xl font-semibold text-foreground">
              {report.report?.overview.deduplicatedMemoryCount ?? report.memoryCount}
            </div>
            <div className="mt-1 text-[11px] text-soft-foreground">
              {t("deep_analysis.metrics.deduplicated")}
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-popover/70 px-3 py-3">
            <div className="text-sm font-semibold text-foreground">
              {report.report?.overview.timeSpan.start
                ? formatDateTime(report.report.overview.timeSpan.start, i18n.language)
                : "—"}
            </div>
            <div className="mt-1 text-[11px] text-soft-foreground">
              {t("deep_analysis.metrics.start")}
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-popover/70 px-3 py-3">
            <div className="text-sm font-semibold text-foreground">
              {report.report?.overview.timeSpan.end
                ? formatDateTime(report.report.overview.timeSpan.end, i18n.language)
                : "—"}
            </div>
            <div className="mt-1 text-[11px] text-soft-foreground">
              {t("deep_analysis.metrics.end")}
            </div>
          </div>
        </div>
      </ReportSection>

      <ReportSection title={t("deep_analysis.sections.persona")}>
        <p className="text-sm leading-6 text-foreground/90">
          {report.report?.persona.summary ?? report.preview?.summary ?? t("deep_analysis.pending")}
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <PersonaList
            title={t("deep_analysis.persona.working_style")}
            items={report.report?.persona.workingStyle ?? []}
          />
          <PersonaList
            title={t("deep_analysis.persona.preferences")}
            items={report.report?.persona.preferences ?? []}
          />
          <PersonaList
            title={t("deep_analysis.persona.goals")}
            items={report.report?.persona.goals ?? []}
          />
          <PersonaList
            title={t("deep_analysis.persona.constraints")}
            items={report.report?.persona.constraints ?? []}
          />
          <PersonaList
            title={t("deep_analysis.persona.decision_signals")}
            items={report.report?.persona.decisionSignals ?? []}
          />
          <PersonaList
            title={t("deep_analysis.persona.notable_routines")}
            items={report.report?.persona.notableRoutines ?? report.report?.persona.habits ?? []}
          />
          <PersonaList
            title={t("deep_analysis.persona.contradictions")}
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
          {(report.report?.themeLandscape.highlights ?? []).map((item) => (
            <div key={item.name} className="rounded-xl border border-border/70 bg-popover/70 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">{item.name}</div>
                <Badge variant="outline">{item.count}</Badge>
              </div>
              <p className="mt-2 text-sm text-soft-foreground">{item.description}</p>
            </div>
          ))}
        </div>
      </ReportSection>

      <ReportSection title={t("deep_analysis.sections.entities")}>
        <div className="space-y-4">
          <EntityGroupList label={t("deep_analysis.entities.people")} items={report.report?.entities.people ?? []} />
          <EntityGroupList label={t("deep_analysis.entities.teams")} items={report.report?.entities.teams ?? []} />
          <EntityGroupList label={t("deep_analysis.entities.projects")} items={report.report?.entities.projects ?? []} />
          <EntityGroupList label={t("deep_analysis.entities.tools")} items={report.report?.entities.tools ?? []} />
          <EntityGroupList label={t("deep_analysis.entities.places")} items={report.report?.entities.places ?? []} />
        </div>
      </ReportSection>

      <ReportSection title={t("deep_analysis.sections.relationships")}>
        <RelationshipList items={report.report?.relationships ?? []} />
      </ReportSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <ReportSection title={t("deep_analysis.sections.quality")}>
          <div className="space-y-3 text-sm text-foreground/85">
            <p>
              {t("deep_analysis.quality.duplicate_ratio")}:{" "}
              {Math.round((report.report?.quality.duplicateRatio ?? 0) * 100)}%
            </p>
            <p>
              {t("deep_analysis.quality.duplicate_count")}: {duplicateCount}
            </p>
            <p>
              {t("deep_analysis.quality.noisy_memories")}:{" "}
              {report.report?.quality.noisyMemoryCount ?? 0}
            </p>
            {(report.report?.quality.coverageGaps ?? []).map((item) => (
              <p key={item} className="text-soft-foreground">{item}</p>
            ))}
            {duplicateCount > 0 && (
              <div className="pt-1">
                <Button
                  variant="outline"
                  onClick={() => {
                    void onDownloadDuplicates();
                  }}
                  disabled={isDownloadingDuplicates}
                  className="gap-2"
                >
                  {isDownloadingDuplicates ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {t("deep_analysis.quality.download_cleanup")}
                </Button>
                <p className="mt-2 text-xs leading-5 text-soft-foreground">
                  {t("deep_analysis.quality.download_hint")}
                </p>
                {downloadError && (
                  <p className="mt-2 text-xs text-destructive">{downloadError}</p>
                )}
              </div>
            )}
          </div>
        </ReportSection>

        <ReportSection title={t("deep_analysis.sections.recommendations")}>
          <div className="space-y-2 text-sm text-foreground/85">
            {(report.report?.recommendations ?? []).map((item) => (
              <p key={item}>{item}</p>
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
}: {
  spaceId: string;
  active: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
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

  return (
    <div className="space-y-4">
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
        <Button
          onClick={() => {
            void handleCreateReport();
          }}
          disabled={isCreating}
          className="gap-2"
        >
          {isCreating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {t("deep_analysis.create")}
        </Button>
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
            disabled={isCreating}
            className="mt-5 gap-2"
          >
            {isCreating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {t("deep_analysis.create")}
          </Button>
        </div>
      )}

      {reports.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3">
            {reports.map((report) => {
              const selected = report.id === selectedReportId;
              return (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => {
                    setDownloadError(null);
                    setSelectedReportId(report.id);
                  }}
                  className={`surface-card w-full px-4 py-4 text-left transition-colors sm:px-5 ${
                    selected ? "ring-1 ring-primary/35" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        {formatDateTime(report.requestedAt, i18n.language)}
                      </div>
                      <div className="mt-1 text-xs text-soft-foreground">
                        {report.memoryCount} {t("deep_analysis.memories_suffix")}
                      </div>
                    </div>
                    <Badge variant={statusVariant(report.status)}>{t(`deep_analysis.status.${report.status}`)}</Badge>
                  </div>

                  {report.preview?.summary && (
                    <p className="mt-3 text-sm leading-6 text-foreground/85">
                      {report.preview.summary}
                    </p>
                  )}

                  {!report.completedAt && (
                    <div className="mt-3">
                      <Progress value={report.progressPercent} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {selectedReport && (
            <div className="space-y-4">
              <div className="surface-card px-4 py-5 sm:px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-semibold text-foreground">
                        {t("deep_analysis.detail_title")}
                      </h3>
                      {selectedReport.status === "COMPLETED" && (
                        <CheckCircle2 className="size-4 text-emerald-500" />
                      )}
                    </div>
                    <p className="mt-2 text-sm text-soft-foreground">
                      {t("deep_analysis.generated_at", {
                        value: formatDateTime(selectedReport.requestedAt, i18n.language),
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(selectedReport.status)}>
                      {t(`deep_analysis.status.${selectedReport.status}`)}
                    </Badge>
                    <Badge variant="outline">
                      {t(`deep_analysis.stage.${selectedReport.stage}`)}
                    </Badge>
                  </div>
                </div>

                {selectedReport.status !== "COMPLETED" && (
                  <div className="mt-4">
                    <Progress value={selectedReport.progressPercent} />
                    <p className="mt-2 text-xs text-soft-foreground">
                      {t("deep_analysis.processing")}
                    </p>
                  </div>
                )}

                {selectedReport.errorMessage && (
                  <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-foreground/85">
                    {selectedReport.errorMessage}
                  </div>
                )}
              </div>

              {selectedReport.report ? (
                <ReportDetail
                  report={selectedReport}
                  onDownloadDuplicates={handleDownloadDuplicates}
                  isDownloadingDuplicates={downloadingReportId === selectedReport.id}
                  downloadError={downloadError}
                />
              ) : (
                <div className="surface-card px-4 py-8 text-center sm:px-6">
                  <p className="text-sm text-soft-foreground">
                    {selectedReport.status === "FAILED"
                      ? t("deep_analysis.failed_body")
                      : t("deep_analysis.pending")}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
