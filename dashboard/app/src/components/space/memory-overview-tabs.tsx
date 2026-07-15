import { useState } from "react";
import { Monitor, Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DeepAnalysisTab } from "@/components/space/deep-analysis-tab";
import { MemoryInsightWorkspace } from "@/components/space/memory-insight-workspace";
import { MemoryProfileOverview } from "@/components/space/memory-profile-overview";
import { ReportManageOverview } from "@/components/space/report-manage-overview";
import { PeriodicObservationOverview } from "@/components/space/periodic-observation-overview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsLargeViewport } from "@/components/space/space-view-utils";
import { cn } from "@/lib/utils";
import type { MemoryInsightTab } from "@/lib/memory-insight";
import type {
  AnalysisCategory,
  AnalysisCategoryCard,
  AnalysisJobSnapshotResponse,
  MemoryAnalysisMatch,
} from "@/types/analysis";
import type { Memory, MemoryStats, MemoryType, TopicSummary } from "@/types/memory";
import type { TimeRangePreset, TimelineSelection } from "@/types/time-range";

export type OverviewMemorySelectionSource = "list" | "insight";

const TAB_VALUES = ["profile", "periodic", "reports", "insight", "pulse", "analysis"] as const;
const VISIBLE_TAB_VALUES = TAB_VALUES.filter((value) => value !== "analysis");

export function MemoryOverviewTabs({
  spaceId,
  stats,
  pulseMemories,
  profileFacetData,
  insightMemories,
  cards,
  snapshot,
  range,
  loading,
  compact,
  activeCategory,
  activeTag,
  matchMap,
  onMemorySelect,
  onEntitySearch,
  onTabChange,
}: {
  spaceId: string;
  stats: MemoryStats | undefined;
  pulseMemories: Memory[];
  profileFacetData?: TopicSummary;
  insightMemories: Memory[];
  cards: AnalysisCategoryCard[];
  snapshot: AnalysisJobSnapshotResponse | null;
  range: TimeRangePreset;
  loading: boolean;
  compact: boolean;
  activeType?: MemoryType;
  activeCategory?: AnalysisCategory;
  activeTag?: string;
  selectedTimeline?: TimelineSelection;
  matchMap: Map<string, MemoryAnalysisMatch>;
  onTypeSelect?: (type: MemoryType) => void;
  onTagSelect?: (tag: string | undefined) => void;
  onMemorySelect: (memory: Memory, source?: OverviewMemorySelectionSource) => void;
  onTimelineSelect?: (selection: TimelineSelection) => void;
  onTimelineClear?: () => void;
  onEntitySearch?: (query: string) => void;
  onTabChange?: (tab: MemoryInsightTab) => void;
}) {
  // Memory Insight only needs a wide canvas to lay out the relations bubbles
  // legibly — it doesn't depend on the full three-column desktop layout. Gating
  // it on the *large* breakpoint (1024px / Tailwind `lg`) instead of the desktop
  // breakpoint (1280px) lets every iPad in landscape orientation render the
  // workspace, while phones and iPads in portrait still get the redirect hint.
  const isLargeViewport = useIsLargeViewport();
  const [tab, setTab] = useState<MemoryInsightTab>("profile");
  const [hasVisitedAnalysisTab, setHasVisitedAnalysisTab] = useState(false);
  const [insightResetToken, setInsightResetToken] = useState(0);

  // Below the large breakpoint we replace the workspace with a redirect hint,
  // but keep the tab reachable so users can still discover the surface and
  // learn how to access it.
  const insightUnavailableOnDevice = !isLargeViewport;

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = value as MemoryInsightTab;
        if (next === "analysis") {
          setHasVisitedAnalysisTab(true);
        }
        if (tab === "insight" && next !== "insight") {
          setInsightResetToken((current) => current + 1);
        }
        setTab(next);
        onTabChange?.(next);
      }}
      className="mt-5"
      data-testid="memory-overview-tabs"
    >
      {isLargeViewport ? (
        <DesktopOverviewTabsList />
      ) : (
        <MobileOverviewTabsList />
      )}

      <TabsContent value="pulse" className="mt-0" />

      <TabsContent value="profile" className="-mt-px mt-0">
        <MemoryProfileOverview
          spaceId={spaceId}
          stats={stats}
          memories={pulseMemories}
          cards={cards}
          snapshot={snapshot}
          range={range}
          matchMap={matchMap}
          facetSummary={profileFacetData}
          loading={loading}
          className="!mt-0"
        />
      </TabsContent>

      <TabsContent value="reports" className="-mt-px mt-0">
        <ReportManageOverview spaceId={spaceId} className="!mt-0" />
      </TabsContent>

      <TabsContent
        value="periodic"
        className="-mt-px mt-0 data-[state=inactive]:hidden"
        forceMount
      >
        <PeriodicObservationOverview spaceId={spaceId} active={tab === "periodic"} />
      </TabsContent>

      <TabsContent value="insight" className="-mt-px mt-0">
        {insightUnavailableOnDevice ? (
          <MemoryInsightDesktopOnlyHint />
        ) : (
          <MemoryInsightWorkspace
            cards={cards}
            memories={insightMemories}
            matchMap={matchMap}
            compact={compact}
            resetToken={insightResetToken}
            activeCategory={activeCategory}
            activeTag={activeTag}
            onMemorySelect={(memory) => onMemorySelect(memory, "insight")}
          />
        )}
      </TabsContent>

      {hasVisitedAnalysisTab && (
        <TabsContent
          value="analysis"
          className="-mt-px mt-0 data-[state=inactive]:hidden"
          forceMount
        >
          <DeepAnalysisTab
            spaceId={spaceId}
            active={tab === "analysis"}
            onEntitySearch={onEntitySearch}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}

function DesktopOverviewTabsList() {
  const { t } = useTranslation();

  return (
    <div className="relative mb-0 flex items-end px-1">
      <TabsList
        className="inline-flex h-auto gap-0 rounded-none border-0 bg-transparent p-0 shadow-none"
        data-testid="memory-overview-tablist"
      >
        {VISIBLE_TAB_VALUES.map((value) => (
          <TabsTrigger
            key={value}
            value={value}
            className={cn(
              "relative z-10 -mb-px rounded-t-md rounded-b-none border border-transparent border-b-border bg-transparent px-5 py-2.5 text-sm font-medium tracking-[-0.02em] text-foreground/40 transition-colors hover:text-foreground/70",
              "data-[state=active]:border-border data-[state=active]:border-b-transparent data-[state=active]:bg-card data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
            )}
          >
            {t(`memory_overview.tabs.${value}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="absolute bottom-0 left-0 right-0 h-px bg-border" />
    </div>
  );
}

function MobileOverviewTabsList() {
  const { t } = useTranslation();

  // Use shadcn's default segmented control look (rounded-lg muted bar + rounded-md
  // chip on the active trigger). Stretching the list to the full row width with
  // `grid w-full` keeps each trigger evenly sized and avoids the
  // horizontal overflow we saw with the long "Memory ___" labels.
  return (
    <TabsList
      className="grid w-full"
      style={{ gridTemplateColumns: `repeat(${VISIBLE_TAB_VALUES.length}, minmax(0, 1fr))` }}
      data-testid="memory-overview-tablist"
    >
      {VISIBLE_TAB_VALUES.map((value) => (
        <TabsTrigger
          key={value}
          value={value}
          data-testid={`memory-overview-tab-${value}`}
          aria-label={t(`memory_overview.tabs.${value}`)}
          className="min-w-0 px-2"
        >
          <span className="block truncate">
            {t(`memory_overview.tabs_short.${value}`)}
          </span>
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

function MemoryInsightDesktopOnlyHint() {
  const { t } = useTranslation();

  return (
    <section
      data-testid="memory-insight-desktop-only-hint"
      className="surface-card mt-5 flex flex-col items-center gap-4 rounded-2xl px-5 py-8 text-center"
    >
      <span className="relative flex size-14 items-center justify-center rounded-2xl bg-foreground/[0.04] text-foreground/70">
        <Network className="size-7" aria-hidden />
        <span className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full border border-border bg-background text-foreground/80 shadow-sm">
          <Monitor className="size-3.5" aria-hidden />
        </span>
      </span>
      <div className="space-y-1.5">
        <p className="text-base font-semibold tracking-tight text-foreground">
          {t("memory_overview.desktop_only.title")}
        </p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {t("memory_overview.desktop_only.body")}
        </p>
      </div>
      <p className="text-xs text-soft-foreground">
        {t("memory_overview.desktop_only.hint")}
      </p>
    </section>
  );
}
