import type { TFunction } from "i18next";
import type { MemoryFacet, TopicSummary } from "@/types/memory";

const FACET_STYLES: Record<MemoryFacet, string> = {
  about_you: "bg-facet-about-you/10 text-facet-about-you border-facet-about-you/20",
  preferences: "bg-facet-preferences/10 text-facet-preferences border-facet-preferences/20",
  important_people: "bg-facet-people/10 text-facet-people border-facet-people/20",
  experiences: "bg-facet-experiences/10 text-facet-experiences border-facet-experiences/20",
  plans: "bg-facet-plans/10 text-facet-plans border-facet-plans/20",
  routines: "bg-facet-routines/10 text-facet-routines border-facet-routines/20",
  constraints: "bg-facet-constraints/10 text-facet-constraints border-facet-constraints/20",
  other: "bg-facet-other/10 text-facet-other border-facet-other/20",
};

const FACET_ACTIVE: Record<MemoryFacet, string> = {
  about_you: "ring-facet-about-you/30",
  preferences: "ring-facet-preferences/30",
  important_people: "ring-facet-people/30",
  experiences: "ring-facet-experiences/30",
  plans: "ring-facet-plans/30",
  routines: "ring-facet-routines/30",
  constraints: "ring-facet-constraints/30",
  other: "ring-facet-other/30",
};

export function TopicStrip({
  data,
  activeFacet,
  onSelect,
  t,
}: {
  data: TopicSummary;
  activeFacet?: MemoryFacet;
  onSelect: (facet: MemoryFacet | undefined) => void;
  t: TFunction;
}) {
  if (data.topics.length === 0) return null;

  return (
    <div>
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {t("topics.label")}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {data.topics.map(({ facet, count }) => {
          const isActive = activeFacet === facet;
          return (
            <button
              key={facet}
              onClick={() => onSelect(isActive ? undefined : facet)}
              className={`rounded-xl border px-3 py-2 text-left transition-all ${FACET_STYLES[facet]} ${
                isActive
                  ? `ring-2 ${FACET_ACTIVE[facet]}`
                  : "opacity-80 hover:opacity-100"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">
                  {t(`facet.${facet}`)}
                </span>
                <span className="text-xs opacity-60">{count}</span>
              </div>
              <div className="mt-0.5 text-[10px] leading-snug opacity-70">
                {t(`facet_desc.${facet}`)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FacetBadge({
  facet,
  t,
}: {
  facet: MemoryFacet;
  t: TFunction;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none ${FACET_STYLES[facet]}`}
    >
      {t(`facet.${facet}`)}
    </span>
  );
}
