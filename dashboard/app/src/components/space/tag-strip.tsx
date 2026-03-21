import type { TFunction } from "i18next";
import type { DerivedTagOrigin } from "@/lib/memory-derived-signals";

export interface TagSummary {
  tag: string;
  count: number;
  origin?: DerivedTagOrigin;
}

export function TagStrip({
  tags,
  activeTag,
  onSelect,
  t,
}: {
  tags: TagSummary[];
  activeTag?: string;
  onSelect: (tag: string | undefined) => void;
  t: TFunction;
}) {
  if (tags.length === 0) return null;

  return (
    <div>
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {t("tag_strip.label")}
      </div>
      <div className="flex flex-wrap gap-2">
        {tags.map(({ tag, count, origin }) => {
          const isActive = activeTag === tag;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onSelect(isActive ? undefined : tag)}
              data-mp-event="Dashboard/Tag/SelectClicked"
              data-mp-page-name="space"
              data-mp-tag={tag}
              aria-label={t("tag_strip.filter_label", { tag, count })}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-all ${
                isActive
                  ? "border-foreground/20 bg-foreground/[0.05] text-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-foreground/15 hover:text-foreground"
              }`}
            >
              <span className="font-medium">#{tag}</span>
              {origin === "derived" && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
                  {t("tag_strip.derived_badge")}
                </span>
              )}
              <span className="text-xs text-soft-foreground">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
