import type { TFunction } from "i18next";
import { toast } from "sonner";
import { Bookmark, Sparkles, Copy, Trash2 } from "lucide-react";
import { formatRelativeTime } from "@/lib/time";
import type { Memory } from "@/types/memory";

export function MemoryCard({
  memory: m,
  isSelected,
  onClick,
  onDelete,
  t,
  delay,
}: {
  memory: Memory;
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
  t: TFunction;
  delay: number;
}) {
  const isPinned = m.memory_type === "pinned";
  const tags = m.tags ?? [];

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(m.content);
    toast.success(t("list.copied"));
  }

  return (
    <button
      onClick={onClick}
      className={`surface-card group relative w-full text-left transition-all duration-150 hover:shadow-md ${
        isSelected
          ? "ring-2 ring-primary/25 shadow-md"
          : ""
      }`}
      style={{
        animation: `slide-up 0.3s cubic-bezier(0.16,1,0.3,1) ${delay}ms both`,
      }}
    >
      <div
        className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-[1rem] ${
          isPinned ? "bg-type-pinned" : "bg-type-insight"
        }`}
      />

      <div className="flex items-start gap-3.5 p-4 pl-5">
        <div
          className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${
            isPinned
              ? "bg-type-pinned/10 text-type-pinned"
              : "bg-type-insight/10 text-type-insight"
          }`}
        >
          {isPinned ? (
            <Bookmark className="size-4" />
          ) : (
            <Sparkles className="size-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 text-sm leading-relaxed text-foreground">
            {m.content}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-soft-foreground">
            <span>{formatRelativeTime(t, m.updated_at)}</span>
            {m.source && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {m.source}
              </span>
            )}
            {tags.length > 0 &&
              tags.map((tag) => (
                <span key={tag} className="text-soft-foreground">
                  #{tag}
                </span>
              ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={handleCopy}
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
            className="flex size-7 items-center justify-center rounded-md text-soft-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </button>
  );
}
