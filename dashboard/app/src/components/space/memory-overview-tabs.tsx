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
      <div className="mb-0 flex items-end px-1">
        <TabsList
          className="inline-flex h-auto gap-1 rounded-none border-0 bg-transparent p-0 shadow-none"
          data-testid="memory-overview-tablist"
        >
          <TabsTrigger
            value="pulse"
            className={cn(
              "relative -mb-px rounded-t-[1rem] border border-transparent border-b-0 bg-transparent px-4 py-2.5 text-sm tracking-[-0.02em] text-foreground/52 transition-colors",
              "data-[state=active]:border-foreground/10 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none",
            )}
          >
            {t("memory_overview.tabs.pulse")}
          </TabsTrigger>
          <TabsTrigger
            value="insight"
            className={cn(
              "relative -mb-px rounded-t-[1rem] border border-transparent border-b-0 bg-transparent px-4 py-2.5 text-sm tracking-[-0.02em] text-foreground/52 transition-colors",
              "data-[state=active]:border-foreground/10 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none",
            )}
          >
            {t("memory_overview.tabs.insight")}
          </TabsTrigger>
          <TabsTrigger
            value="analysis"
            className={cn(
              "relative -mb-px rounded-t-[1rem] border border-transparent border-b-0 bg-transparent px-4 py-2.5 text-sm tracking-[-0.02em] text-foreground/52 transition-colors",
              "data-[state=active]:border-foreground/10 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none",
            )}
          >
            {t("memory_overview.tabs.analysis")}
          </TabsTrigger>
        </TabsList>
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

      <TabsContent value="analysis" className="-mt-px mt-0">
        <DeepAnalysisTab spaceId={spaceId} active={tab === "analysis"} />
      </TabsContent>
    </Tabs>
  );
}
