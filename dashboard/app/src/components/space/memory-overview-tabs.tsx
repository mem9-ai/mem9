import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DeepAnalysisTab } from "@/components/space/deep-analysis-tab";
import { MemoryInsightWorkspace } from "@/components/space/memory-insight-workspace";
import { MemoryPulseOverview } from "@/components/space/memory-pulse-overview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { MemoryInsightTab } from "@/lib/memory-insight";
import type {
  AnalysisCategory,
  AnalysisCategoryCard,
  AnalysisJobSnapshotResponse,
  MemoryAnalysisMatch,
} from "@/types/analysis";
import type { Memory, MemoryStats, MemoryType } from "@/types/memory";
import type { TimeRangePreset, TimelineSelection } from "@/types/time-range";

export type OverviewMemorySelectionSource = "list" | "insight";

export function MemoryOverviewTabs({
  spaceId,
  stats,
  pulseMemories,
  insightMemories,
  cards,
  snapshot,
  range,
  loading,
  compact,
  activeType,
  activeCategory,
  activeTag,
  selectedTimeline,
  matchMap,
  onTypeSelect,
  onTagSelect,
  onMemorySelect,
  onTimelineSelect,
  onTimelineClear,
  onEntitySearch,
}: {
  spaceId: string;
  stats: MemoryStats | undefined;
  pulseMemories: Memory[];
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
  onTypeSelect: (type: MemoryType) => void;
  onTagSelect: (tag: string | undefined) => void;
  onMemorySelect: (memory: Memory, source?: OverviewMemorySelectionSource) => void;
  onTimelineSelect: (selection: TimelineSelection) => void;
  onTimelineClear?: () => void;
  onEntitySearch?: (query: string) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<MemoryInsightTab>("pulse");
  const [insightResetToken, setInsightResetToken] = useState(0);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = value as MemoryInsightTab;
        if (tab === "insight" && next !== "insight") {
          setInsightResetToken((current) => current + 1);
        }
        setTab(next);
      }}
      className="mt-5"
      data-testid="memory-overview-tabs"
    >
      <div className="relative mb-0 flex items-end px-1">
        <TabsList
          className="inline-flex h-auto gap-0 rounded-none border-0 bg-transparent p-0 shadow-none"
          data-testid="memory-overview-tablist"
        >
          {(["pulse", "insight", "analysis"] as const).map((value) => (
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

      <TabsContent value="pulse" className="-mt-px mt-0">
        <MemoryPulseOverview
          stats={stats}
          memories={pulseMemories}
          cards={cards}
          snapshot={snapshot}
          range={range}
          loading={loading}
          compact={compact}
          className="!mt-0"
          activeType={activeType}
          activeTag={activeTag}
          selectedTimeline={selectedTimeline}
          onTypeSelect={onTypeSelect}
          onTagSelect={onTagSelect}
          onTimelineSelect={onTimelineSelect}
          onTimelineClear={onTimelineClear}
        />
      </TabsContent>

      <TabsContent value="insight" className="-mt-px mt-0">
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
      </TabsContent>

      <TabsContent
        value="analysis"
        className="-mt-px mt-0 data-[state=inactive]:hidden"
        forceMount
      >
        <DeepAnalysisTab spaceId={spaceId} active={tab === "analysis"} onEntitySearch={onEntitySearch} />
      </TabsContent>
    </Tabs>
  );
}
