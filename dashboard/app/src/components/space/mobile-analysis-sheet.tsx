import type { TFunction } from "i18next";
import { AnalysisPanelBody } from "@/components/space/analysis-panel";
import { MobilePanelShell } from "@/components/space/mobile-panel-shell";
import type {
  AnalysisCategory,
  AnalysisCategoryCard,
  AnalysisFacetStat,
  SpaceAnalysisState,
  TaxonomyResponse,
} from "@/types/analysis";

export function MobileAnalysisSheet({
  open,
  onOpenChange,
  state,
  sourceCount,
  sourceLoading,
  taxonomy,
  taxonomyUnavailable,
  cards,
  activeCategory,
  activeTag,
  tagStats,
  onSelectCategory,
  onSelectTag,
  onRetry,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: SpaceAnalysisState;
  sourceCount: number;
  sourceLoading: boolean;
  taxonomy: TaxonomyResponse | null;
  taxonomyUnavailable: boolean;
  cards: AnalysisCategoryCard[];
  activeCategory?: AnalysisCategory;
  activeTag?: string;
  tagStats?: AnalysisFacetStat[];
  onSelectCategory: (category: AnalysisCategory | undefined) => void;
  onSelectTag: (tag: string | undefined) => void;
  onRetry: () => void;
  t: TFunction;
}) {
  return (
    <MobilePanelShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("analysis.title")}
      description={t("analysis.cards")}
      closeLabel={t("detail.close")}
      bodyClassName="space-y-4 px-4 py-4"
    >
      <AnalysisPanelBody
        state={state}
        sourceCount={sourceCount}
        sourceLoading={sourceLoading}
        taxonomy={taxonomy}
        taxonomyUnavailable={taxonomyUnavailable}
        cards={cards}
        activeCategory={activeCategory}
        activeTag={activeTag}
        tagStats={tagStats}
        onSelectCategory={onSelectCategory}
        onSelectTag={onSelectTag}
        onRetry={onRetry}
        t={t}
      />
    </MobilePanelShell>
  );
}
