import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MemoryCompositionChart } from "@/components/space/memory-composition-chart";
import { MemoryRhythmChart } from "@/components/space/memory-rhythm-chart";
import { MemorySignalStack } from "@/components/space/memory-signal-stack";
import { buildMemoryPulseData } from "@/lib/memory-pulse";
import { cn } from "@/lib/utils";
import type { AnalysisCategoryCard, AnalysisJobSnapshotResponse } from "@/types/analysis";
import type { Memory, MemoryStats, MemoryType } from "@/types/memory";
import type { TimeRangePreset } from "@/types/time-range";

function PulseOverviewSkeleton() {
  return (
    <section className="surface-card relative mt-5 overflow-hidden px-4 py-5 sm:px-6">
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--foreground)_14%,transparent),transparent)]" />
      <div className="relative animate-pulse">
        <div className="flex flex-col gap-3 border-b border-foreground/6 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="h-3 w-16 rounded bg-foreground/10" />
            <div className="mt-3 h-8 w-48 rounded-md bg-foreground/10" />
            <div className="mt-3 h-4 w-64 max-w-full rounded bg-foreground/10" />
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-foreground/8 bg-background/55 px-3 py-1.5 backdrop-blur-sm">
            <span className="size-1.5 rounded-full bg-foreground/30" />
            <div className="h-3 w-24 rounded bg-foreground/10" />
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.95fr)_minmax(0,1fr)] xl:gap-6">
          <div className="xl:border-r xl:border-foreground/6 xl:pr-6">
            <div className="flex items-end justify-between">
              <div>
                <div className="h-3 w-12 rounded bg-foreground/10" />
                <div className="mt-2 h-4 w-24 rounded bg-foreground/10" />
              </div>
              <div className="flex flex-col items-end">
                <div className="h-6 w-8 rounded bg-foreground/10" />
                <div className="mt-2 h-3 w-16 rounded bg-foreground/10" />
              </div>
            </div>
            <div className="mt-5 h-44 w-full rounded-md bg-foreground/5" />
            <div className="mt-3 flex justify-between">
              <div className="h-3 w-10 rounded bg-foreground/10" />
              <div className="h-3 w-10 rounded bg-foreground/10" />
              <div className="h-3 w-10 rounded bg-foreground/10" />
            </div>
          </div>

          <div className="border-t border-foreground/6 pt-5 xl:border-t-0 xl:border-r xl:border-foreground/6 xl:pt-0 xl:pr-6">
            <div>
              <div className="h-3 w-16 rounded bg-foreground/10" />
              <div className="mt-2 h-4 w-20 rounded bg-foreground/10" />
            </div>
            <div className="mt-5 flex flex-col items-center justify-center">
              <div className="h-[220px] w-[220px] rounded-full border-[18px] border-foreground/5" />
              <div className="mt-5 grid w-full grid-cols-2 gap-2">
                <div className="h-[54px] rounded-xl bg-foreground/5" />
                <div className="h-[54px] rounded-xl bg-foreground/5" />
                <div className="h-[54px] rounded-xl bg-foreground/5" />
                <div className="h-[54px] rounded-xl bg-foreground/5" />
              </div>
            </div>
          </div>

          <div className="border-t border-foreground/6 pt-5 xl:border-t-0 xl:pt-0">
            <div>
              <div className="h-3 w-20 rounded bg-foreground/10" />
              <div className="mt-2 h-4 w-32 rounded bg-foreground/10" />
            </div>
            <div className="mt-5 space-y-2">
              <div className="h-[62px] rounded-2xl bg-foreground/5" />
              <div className="h-[62px] rounded-2xl bg-foreground/5" />
              <div className="h-[62px] rounded-2xl bg-foreground/5" />
              <div className="h-[62px] rounded-2xl bg-foreground/5" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function MemoryPulseOverview({
  stats,
  memories,
  cards,
  snapshot,
  range,
  loading,
  activeType,
  activeTag,
  onTypeSelect,
  onTagSelect,
}: {
  stats: MemoryStats | undefined;
  memories: Memory[];
  cards: AnalysisCategoryCard[];
  snapshot: AnalysisJobSnapshotResponse | null;
  range: TimeRangePreset;
  loading: boolean;
  activeType?: MemoryType;
  activeTag?: string;
  onTypeSelect: (type: MemoryType) => void;
  onTagSelect: (tag: string | undefined) => void;
}) {
  const { t, i18n } = useTranslation();
  const pulse = useMemo(() => {
    if (!stats) {
      return null;
    }

    return buildMemoryPulseData({
      stats,
      memories,
      cards,
      snapshot,
      range,
    });
  }, [cards, memories, range, snapshot, stats]);

  if (!stats) {
    return loading ? <PulseOverviewSkeleton /> : null;
  }

  if (stats.total === 0 || pulse === null) {
    return null;
  }

  return (
    <section
      className={cn(
        "surface-card relative mt-5 overflow-hidden px-4 py-5 sm:px-6 transition-opacity duration-300",
        loading && "pointer-events-none opacity-50",
      )}
      style={{
        animation: "slide-up 0.45s cubic-bezier(0.16,1,0.3,1)",
        background:
          "radial-gradient(circle at top left, color-mix(in srgb, var(--type-pinned) 14%, transparent) 0%, transparent 34%), radial-gradient(circle at 85% 20%, color-mix(in srgb, var(--type-insight) 16%, transparent) 0%, transparent 32%), linear-gradient(180deg, color-mix(in srgb, var(--card) 96%, transparent), color-mix(in srgb, var(--card) 92%, transparent))",
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--foreground)_14%,transparent),transparent)]" />

      <div className="relative">
        <div className="flex flex-col gap-3 border-b border-foreground/6 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ring">
              {t("memory_pulse.eyebrow")}
            </p>
            <h2 className="mt-2 text-[clamp(1.45rem,2vw,1.85rem)] font-semibold tracking-[-0.06em] text-foreground">
              {t("memory_pulse.title")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("memory_pulse.subtitle")}
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-foreground/8 bg-background/55 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
            <span className="size-1.5 rounded-full bg-foreground/30" />
            {t("memory_pulse.range", { range: t(`time_range.${range}`) })}
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.95fr)_minmax(0,1fr)] xl:gap-6">
          <div className={cn("xl:border-r xl:border-foreground/6 xl:pr-6")}>
            <MemoryRhythmChart
              buckets={pulse.trend.buckets}
              maxCount={pulse.trend.maxCount}
              locale={i18n.language}
            />
          </div>

          <div className={cn("border-t border-foreground/6 pt-5 xl:border-t-0 xl:border-r xl:border-foreground/6 xl:pt-0 xl:pr-6")}>
            <MemoryCompositionChart
              total={pulse.composition.total}
              outer={pulse.composition.outer}
              inner={pulse.composition.inner}
              innerKind={pulse.composition.innerKind}
              activeType={activeType}
              onTypeSelect={onTypeSelect}
            />
          </div>

          <div className="border-t border-foreground/6 pt-5 xl:border-t-0 xl:pt-0">
            <MemorySignalStack
              items={pulse.signals.items}
              activeTag={activeTag}
              onTagSelect={onTagSelect}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
