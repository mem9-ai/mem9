import type { TFunction } from "i18next";

export interface TagSummary {
  tag: string;
  count: number;
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
        {tags.map(({ tag, count }) => {
          const isActive = activeTag === tag;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onSelect(isActive ? undefined : tag)}
              aria-label={t("tag_strip.filter_label", { tag, count })}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-all ${
                isActive
                  ? "border-foreground/20 bg-foreground/[0.05] text-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-foreground/15 hover:text-foreground"
              }`}
            >
              <span className="font-medium">#{tag}</span>
              <span className="text-xs text-soft-foreground">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
