import type { TFunction } from "i18next";
import { toast } from "sonner";
import { Bookmark, Sparkles, Copy, X, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Memory, MemoryFacet } from "@/types/memory";
import { FacetBadge } from "./topic-strip";
import { features } from "@/config/features";

export function DetailPanel({
  memory: m,
  onClose,
  onDelete,
  onEdit,
  t,
}: {
  memory: Memory;
  onClose: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  t: TFunction;
}) {
  return (
    <div
      className="w-full shrink-0 py-8 xl:order-3 xl:w-[390px]"
      style={{ animation: "slide-in-right 0.2s cubic-bezier(0.16,1,0.3,1)" }}
    >
      <div className="surface-card sticky top-[calc(3.5rem+2rem)] overflow-hidden">
        <DetailPanelContent
          memory={m}
          onClose={onClose}
          onDelete={onDelete}
          onEdit={onEdit}
          t={t}
          className="flex min-h-0 flex-col"
          scrollAreaClassName="max-h-[60vh] overflow-y-auto px-5 py-4"
        />
      </div>
    </div>
  );
}

export function DetailPanelContent({
  memory: m,
  onClose,
  onDelete,
  onEdit,
  className,
  scrollAreaClassName,
  t,
}: {
  memory: Memory;
  onClose: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  className?: string;
  scrollAreaClassName?: string;
  t: TFunction;
}) {
  const isPinned = m.memory_type === "pinned";
  const tags = m.tags ?? [];
  const facet = features.enableFacet
    ? ((m.metadata as Record<string, unknown> | null)?.facet as
        | MemoryFacet
        | undefined)
    : undefined;

  function handleCopy() {
    navigator.clipboard.writeText(m.content);
    toast.success(t("list.copied"));
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <div
        className={`h-1 ${isPinned ? "bg-type-pinned" : "bg-type-insight"}`}
      />

      <div className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <div
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${
              isPinned
                ? "bg-type-pinned/10 text-type-pinned"
                : "bg-type-insight/10 text-type-insight"
            }`}
          >
            {isPinned ? (
              <Bookmark className="size-3" />
            ) : (
              <Sparkles className="size-3" />
            )}
            {t(`detail.type.${m.memory_type}`)}
          </div>
          {facet && <FacetBadge facet={facet} t={t} />}
        </div>
        <div className="flex items-center gap-1">
          {isPinned && onEdit && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onEdit}
              className="text-soft-foreground hover:text-foreground"
              title={t("detail.edit")}
            >
              <Pencil className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleCopy}
            className="text-soft-foreground hover:text-foreground"
            title="Copy content"
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label={t("detail.close")}
            title={t("detail.close")}
            className="text-soft-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div
        data-testid="detail-scroll-area"
        className={cn("px-5 py-4", scrollAreaClassName)}
      >
        <p className="whitespace-pre-wrap text-sm leading-[1.8] text-foreground">
          {m.content}
        </p>

        <div className="mt-5 space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <MetaCell
              label={t("detail.updated")}
              value={new Date(m.updated_at).toLocaleDateString()}
            />
            <MetaCell
              label={t("detail.created")}
              value={new Date(m.created_at).toLocaleDateString()}
            />
            {m.source && (
              <MetaCell label={t("detail.source")} value={m.source} />
            )}
          </div>

          {tags.length > 0 && (
            <div>
              <p className="text-xs text-soft-foreground">
                {t("detail.tags")}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end border-t px-5 py-2.5">
        <Button
          variant="ghost"
          size="xs"
          onClick={onDelete}
          className="gap-1 text-xs text-destructive/70 hover:text-destructive"
        >
          <Trash2 className="size-3" />
          {t("detail.delete")}
        </Button>
      </div>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-soft-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground/80">{value}</dd>
    </div>
  );
}
