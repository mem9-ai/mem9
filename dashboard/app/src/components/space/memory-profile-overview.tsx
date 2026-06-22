import { Brain, ShieldCheck, UserRound } from "lucide-react";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { Memory, MemoryStats } from "@/types/memory";

const CONFIDENCE_SEGMENTS = [
  {
    key: "confirmed",
    value: 44,
    className: "bg-[var(--type-pinned)]",
    color: "var(--type-pinned)",
  },
  {
    key: "high",
    value: 38,
    className: "bg-[var(--type-insight)]",
    color: "var(--type-insight)",
  },
  {
    key: "medium",
    value: 14,
    className: "bg-ring",
    color: "var(--ring)",
  },
  {
    key: "pending",
    value: 4,
    className: "bg-foreground/30",
    color: "color-mix(in srgb, var(--foreground) 30%, transparent)",
  },
] as const;

export function MemoryProfileOverview({
  stats,
  memories,
  loading,
  className,
}: {
  stats: MemoryStats | undefined;
  memories: Memory[];
  loading: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const companionDays = useMemo(() => {
    const timestamps = memories
      .map((memory) => Date.parse(memory.created_at))
      .filter((timestamp) => Number.isFinite(timestamp));

    if (timestamps.length === 0) {
      return 0;
    }

    const earliest = Math.min(...timestamps);
    const elapsed = Date.now() - earliest;
    return Math.max(1, Math.ceil(elapsed / 86_400_000));
  }, [memories]);

  const memoryCount = stats?.total ?? memories.length;

  if (loading && !stats && memories.length === 0) {
    return (
      <section
        data-testid="memory-profile-skeleton"
        className={cn("mt-5 grid gap-4 xl:grid-cols-3", className)}
      >
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="surface-card min-h-[240px] animate-pulse rounded-2xl px-5 py-5"
          >
            <div className="h-4 w-24 rounded bg-foreground/10" />
            <div className="mt-5 h-10 w-32 rounded-md bg-foreground/10" />
            <div className="mt-5 space-y-2">
              <div className="h-3 w-full rounded bg-foreground/8" />
              <div className="h-3 w-4/5 rounded bg-foreground/8" />
            </div>
          </div>
        ))}
      </section>
    );
  }

  return (
    <section
      data-testid="memory-profile-overview"
      className={cn("mt-5 grid gap-4 xl:grid-cols-3", className)}
      style={{ animation: "slide-up 0.45s cubic-bezier(0.16,1,0.3,1)" }}
    >
      <ProfileCard
        icon={<UserRound className="size-5" aria-hidden />}
        eyebrow={t("memory_profile.personal.eyebrow")}
        title={t("memory_profile.personal.title")}
      >
        <div className="mt-5 flex items-center gap-3">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-foreground/[0.04] text-lg font-semibold text-foreground">
            {t("memory_profile.personal.avatar")}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold tracking-[-0.04em] text-foreground">
              {t("memory_profile.personal.name")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("memory_profile.personal.role")}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <MetricTile
            label={t("memory_profile.personal.companion_duration")}
            value={t("memory_profile.personal.days", { count: companionDays })}
          />
          <MetricTile
            label={t("memory_profile.personal.memory_count")}
            value={t("memory_profile.personal.memories", { count: memoryCount })}
          />
        </div>
      </ProfileCard>

      <ProfileCard
        icon={<Brain className="size-5" aria-hidden />}
        eyebrow={t("memory_profile.current_understanding.eyebrow")}
        title={t("memory_profile.current_understanding.title")}
        accent="insight"
      >
        <p className="mt-5 text-sm leading-7 text-foreground/78">
          {t("memory_profile.current_understanding.description")}
        </p>
      </ProfileCard>

      <ProfileCard
        icon={<ShieldCheck className="size-5" aria-hidden />}
        eyebrow={t("memory_profile.confidence.eyebrow")}
        title={t("memory_profile.confidence.title")}
        accent="trust"
      >
        <div className="mt-5 grid items-center gap-5 sm:grid-cols-[150px_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[150px_minmax(0,1fr)]">
          <ConfidencePie />
          <div className="space-y-3">
            {CONFIDENCE_SEGMENTS.map((segment) => (
              <div key={segment.key} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                  <span className={cn("size-2.5 rounded-full", segment.className)} />
                  <span className="truncate">
                    {t(`memory_profile.confidence.segments.${segment.key}`)}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {segment.value}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </ProfileCard>
    </section>
  );
}

function ProfileCard({
  icon,
  eyebrow,
  title,
  accent = "profile",
  children,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  accent?: "profile" | "insight" | "trust";
  children: ReactNode;
}) {
  const accentBackground =
    accent === "insight"
      ? "radial-gradient(circle at 80% 0%, color-mix(in srgb, var(--type-insight) 14%, transparent), transparent 36%)"
      : accent === "trust"
        ? "radial-gradient(circle at 80% 0%, color-mix(in srgb, var(--ring) 13%, transparent), transparent 36%)"
        : "radial-gradient(circle at 80% 0%, color-mix(in srgb, var(--type-pinned) 12%, transparent), transparent 36%)";

  return (
    <article
      className="surface-card relative min-h-[250px] overflow-hidden rounded-2xl px-5 py-5"
      style={{
        background: `${accentBackground}, linear-gradient(180deg, color-mix(in srgb, var(--card) 96%, transparent), color-mix(in srgb, var(--card) 92%, transparent))`,
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--foreground)_14%,transparent),transparent)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ring">
              {eyebrow}
            </p>
            <h2 className="mt-2 text-lg font-semibold tracking-[-0.04em] text-foreground">
              {title}
            </h2>
          </div>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-foreground/8 bg-background/55 text-foreground/72">
            {icon}
          </span>
        </div>
        {children}
      </div>
    </article>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-foreground/8 bg-background/45 px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-[-0.04em] text-foreground">
        {value}
      </p>
    </div>
  );
}

function ConfidencePie() {
  const { t } = useTranslation();
  const gradientStops = CONFIDENCE_SEGMENTS.reduce<{
    stops: string[];
    offset: number;
  }>(
    (state, segment) => {
      const nextOffset = state.offset + segment.value;
      return {
        stops: [
          ...state.stops,
          `${segment.color} ${state.offset}% ${nextOffset}%`,
        ],
        offset: nextOffset,
      };
    },
    { stops: [], offset: 0 },
  ).stops.join(", ");

  return (
    <div
      className="relative mx-auto flex size-[150px] items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
      style={{ background: `conic-gradient(${gradientStops})` }}
      role="img"
      aria-label={t("memory_profile.confidence.chart_label")}
    >
      <div className="flex size-[86px] flex-col items-center justify-center rounded-full border border-foreground/8 bg-card text-center shadow-sm">
        <span className="text-2xl font-semibold tracking-[-0.06em] text-foreground">
          82%
        </span>
        <span className="text-[11px] text-muted-foreground">
          {t("memory_profile.confidence.trusted")}
        </span>
      </div>
    </div>
  );
}
