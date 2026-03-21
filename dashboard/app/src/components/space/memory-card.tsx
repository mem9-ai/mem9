import type { TFunction } from "i18next";
import { toast } from "sonner";
import { Bookmark, Copy, Trash2, Sparkles } from "lucide-react";
import { formatRelativeTime } from "@/lib/time";
import type { Memory, MemoryFacet, SessionMessage } from "@/types/memory";
import { FacetBadge } from "./topic-strip";
import { CardSessionPreview } from "./session-preview";
import { features } from "@/config/features";

export function MemoryCard({
  memory: m,
  derivedTags = [],
  sessionPreview,
  isSelected,
  onClick,
  onDelete,
  t,
  delay,
}: {
  memory: Memory;
  derivedTags?: string[];
  sessionPreview: SessionMessage[];
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
  t: TFunction;
  delay: number;
}) {
  const isPinned = m.memory_type === "pinned";
  const tags = m.tags ?? [];
  const facet = features.enableFacet
    ? ((m.metadata as Record<string, unknown> | null)?.facet as
        | MemoryFacet
        | undefined)
    : undefined;

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(m.content);
    toast.success(t("list.copied"));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onClick();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={`group relative w-full text-left transition-all duration-300 cursor-pointer rounded-2xl border bg-card p-0 ${
        isSelected
          ? "border-primary/20 shadow-sm ring-1 ring-primary/10 bg-primary/[0.02]"
          : "border-border/30 shadow-sm hover:border-border/60 hover:shadow-md hover:-translate-y-[1px]"
      }`}
      style={{
        animation: `slide-up 0.3s cubic-bezier(0.16,1,0.3,1) ${delay}ms both`,
      }}
    >
      <div className="flex items-start gap-4 p-5">
        <div
          className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl ${
            isPinned
              ? "bg-type-pinned/10 text-type-pinned ring-1 ring-type-pinned/20"
              : "bg-type-insight/10 text-type-insight ring-1 ring-type-insight/20"
          }`}
        >
          {isPinned ? (
            <Bookmark className="size-4" />
          ) : (
            <Sparkles className="size-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 text-sm leading-relaxed text-foreground/90 font-medium">
            {m.content}
          </p>
          <CardSessionPreview messages={sessionPreview} t={t} />
          <div className="mt-3 flex flex-wrap items-center gap-2.5 text-xs text-soft-foreground">
            <span>{formatRelativeTime(t, m.updated_at)}</span>
            {m.source && (
              <span className="rounded-md bg-secondary/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground group-hover:bg-secondary/70">
                {m.source}
              </span>
            )}
            {facet && <FacetBadge facet={facet} t={t} />}
            {tags.length > 0 &&
              tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-secondary/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors group-hover:bg-secondary/80 group-hover:text-foreground"
                >
                  #{tag}
                </span>
              ))}
            {tags.length > 3 && (
              <span className="rounded-md bg-secondary/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground group-hover:bg-secondary/60">
                +{tags.length - 3}
              </span>
            )}
          </div>
          {derivedTags.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold uppercase tracking-[0.08em] text-primary">
                {t("detail.derived_badge")}
              </span>
              {derivedTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-primary/8 px-2 py-0.5 font-medium text-primary/80"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={handleCopy}
            data-mp-event="Dashboard/MemoryCard/CopyClicked"
            data-mp-page-name="space"
            data-mp-memory-id={m.id}
            className="flex size-7 items-center justify-center rounded-md text-soft-foreground hover:bg-secondary hover:text-foreground"
            title="Copy"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            data-mp-event="Dashboard/MemoryCard/DeleteClicked"
            data-mp-page-name="space"
            data-mp-memory-id={m.id}
            className="flex size-7 items-center justify-center rounded-md text-soft-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
