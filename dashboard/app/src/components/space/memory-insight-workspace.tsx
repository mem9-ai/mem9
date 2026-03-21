import { useState } from "react";
import { Network, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MemoryInsightOverview } from "@/components/space/memory-insight-overview";
import { MemoryInsightRelations } from "@/components/space/memory-insight-relations";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { MemoryInsightViewMode } from "@/lib/memory-insight";
import type { AnalysisCategory, AnalysisCategoryCard, MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

export function MemoryInsightWorkspace({
  cards,
  memories,
  matchMap,
  compact,
  resetToken,
  activeCategory,
  activeTag,
  onMemorySelect,
}: {
  cards: AnalysisCategoryCard[];
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
  compact: boolean;
  resetToken: number;
  activeCategory?: AnalysisCategory;
  activeTag?: string;
  onMemorySelect: (memory: Memory) => void;
}) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<MemoryInsightViewMode>("browse");

  return (
    <Tabs
      value={viewMode}
      onValueChange={(value) => setViewMode(value as MemoryInsightViewMode)}
      className="mt-0"
      data-testid="memory-insight-workspace"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ring">
            {t("memory_insight.layer_eyebrow")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("memory_insight.layer_helper")}
          </p>
        </div>
        <TabsList
          variant="line"
          className="inline-flex h-auto gap-1 rounded-full border border-foreground/8 bg-background/70 p-1"
        >
          <TabsTrigger
            value="browse"
            className={cn(
              "rounded-full px-3 py-1.5 text-xs",
              "data-[state=active]:bg-card data-[state=active]:shadow-sm",
            )}
          >
            <Sparkles className="size-3.5" />
            {t("memory_insight.view_mode.browse")}
          </TabsTrigger>
          <TabsTrigger
            value="relations"
            className={cn(
              "rounded-full px-3 py-1.5 text-xs",
              "data-[state=active]:bg-card data-[state=active]:shadow-sm",
            )}
          >
            <Network className="size-3.5" />
            {t("memory_insight.view_mode.relations")}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="browse" className="mt-0">
        <MemoryInsightOverview
          cards={cards}
          memories={memories}
          matchMap={matchMap}
          compact={compact}
          resetToken={resetToken}
          onMemorySelect={onMemorySelect}
        />
      </TabsContent>

      <TabsContent value="relations" className="mt-0">
        <MemoryInsightRelations
          cards={cards}
          memories={memories}
          matchMap={matchMap}
          compact={compact}
          resetToken={resetToken}
          activeCategory={activeCategory}
          activeTag={activeTag}
          onMemorySelect={onMemorySelect}
        />
      </TabsContent>
    </Tabs>
  );
}
