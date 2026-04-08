import { useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bookmark,
  Copy,
  X,
  Trash2,
  Pencil,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Memory, MemoryFacet, SessionMessage } from "@/types/memory";
import { FacetBadge } from "./topic-strip";
import { DetailSessionPreview } from "./session-preview";
import { features } from "@/config/features";

export const DetailPanel = ({
  memory: m,
  derivedTags = [],
  sessionMessages,
  sessionMessagesLoading,
  onClose,
  onDelete,
  onEdit,
  t,
}: {
  memory: Memory;
  derivedTags?: string[];
  sessionMessages: SessionMessage[];
  sessionMessagesLoading: boolean;
  onClose: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  t: TFunction;
}) => {
  return (
    <div
      className="w-full shrink-0 py-8 xl:order-3 xl:w-[390px]"
      style={{ animation: "slide-in-right 0.3s cubic-bezier(0.16,1,0.3,1)" }}
    >
      <div className="sticky top-[calc(3.5rem+2rem)] overflow-hidden rounded-2xl border border-border/30 bg-card shadow-lg ring-1 ring-border/5">
        <DetailPanelContent
          memory={m}
          derivedTags={derivedTags}
          sessionMessages={sessionMessages}
          sessionMessagesLoading={sessionMessagesLoading}
          onClose={onClose}
          onDelete={onDelete}
          onEdit={onEdit}
          t={t}
          compactSessionPreview={false}
          className="flex max-h-[calc(100vh-10rem)] min-h-[400px] flex-col"
          scrollAreaClassName="flex-1 overflow-y-auto px-7 py-6"
        />
      </div>
    </div>
  );
};

export const DetailPanelContent = ({
  memory: m,
  derivedTags = [],
  sessionMessages,
  sessionMessagesLoading,
  onClose,
  onDelete,
  onEdit,
  compactSessionPreview = false,
  className,
  scrollAreaClassName,
  t,
}: {
  memory: Memory;
  derivedTags?: string[];
  sessionMessages: SessionMessage[];
  sessionMessagesLoading: boolean;
  onClose: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  compactSessionPreview?: boolean;
  className?: string;
  scrollAreaClassName?: string;
  t: TFunction;
}) => {
  const isPinned = m.memory_type === "pinned";
  const tags = m.tags ?? [];
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const autoScrolledMemoryIDRef = useRef<string | null>(null);
  const facet = features.enableFacet
    ? ((m.metadata as Record<string, unknown> | null)?.facet as
        | MemoryFacet
        | undefined)
    : undefined;

  const handleCopy = () => {
    navigator.clipboard.writeText(m.content);
    toast.success(t("list.copied"));
  };

  const scrollSessionTo = (
    top: number,
    behavior: ScrollBehavior = "smooth",
  ) => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) {
      return;
    }

    if (typeof scrollArea.scrollTo === "function") {
      scrollArea.scrollTo({ top, behavior });
    } else {
      scrollArea.scrollTop = top;
    }
  };

  const handleJumpToTop = () => {
    scrollSessionTo(0);
  };

  const handleJumpToLatest = () => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) {
      return;
    }

    scrollSessionTo(scrollArea.scrollHeight);
  };

  useEffect(() => {
    autoScrolledMemoryIDRef.current = null;
  }, [m.id]);

  useEffect(() => {
    if (sessionMessagesLoading || sessionMessages.length === 0) {
      return;
    }
    if (autoScrolledMemoryIDRef.current === m.id) {
      return;
    }

    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) {
      return;
    }

    if (typeof scrollArea.scrollTo === "function") {
      scrollArea.scrollTo({ top: scrollArea.scrollHeight });
    } else {
      scrollArea.scrollTop = scrollArea.scrollHeight;
    }
    autoScrolledMemoryIDRef.current = m.id;
  }, [m.id, sessionMessages, sessionMessagesLoading]);

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col bg-background/50 backdrop-blur-sm", className)}>
      <div className="flex items-center justify-between border-b border-border/40 bg-secondary/30 px-6 py-4">
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
              data-mp-event="Dashboard/Detail/EditClicked"
              data-mp-page-name="space"
              data-mp-memory-id={m.id}
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
            data-mp-event="Dashboard/Detail/CopyClicked"
            data-mp-page-name="space"
            data-mp-memory-id={m.id}
            className="text-soft-foreground hover:text-foreground"
            title="Copy content"
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            data-mp-event="Dashboard/Detail/CloseClicked"
            data-mp-page-name="space"
            data-mp-memory-id={m.id}
            aria-label={t("detail.close")}
            title={t("detail.close")}
            className="text-soft-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollAreaRef}
        data-testid="detail-scroll-area"
        className={cn("flex-1 overflow-y-auto px-7 py-6", scrollAreaClassName)}
      >
        <div className="space-y-6">
          {/* Memory Insight */}
          <div>
            <div className="flex items-center gap-2 mb-3 text-[11px] font-semibold uppercase tracking-wider text-type-insight">
              <Sparkles className="size-3.5" />
              {t("detail.metadata", { defaultValue: "Extracted Memory" })}
            </div>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90 font-medium">
              {m.content}
            </p>
          </div>

          <div className="space-y-4">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-secondary/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
          {derivedTags.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                {t("detail.derived_tags")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {derivedTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border/40 bg-secondary/20 p-4">
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
          </div>

          {(sessionMessagesLoading || sessionMessages.length > 0) && (
            <>
              <div className="w-full h-px bg-border/40" />

              {/* Session Context */}
              <div data-testid="detail-session-section" className="pt-2">
                <DetailSessionPreview
                  messages={sessionMessages}
                  loading={sessionMessagesLoading}
                  compactMetadata={compactSessionPreview}
                  t={t}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div
        className={cn(
          "flex flex-wrap items-center gap-2 border-t px-5 py-2.5",
          sessionMessages.length > 0 ? "justify-between" : "justify-end",
        )}
      >
        {sessionMessages.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="xs"
              onClick={handleJumpToTop}
              className="gap-1.5"
            >
              <ArrowUpToLine className="size-3" />
              {t("session_preview.jump_to_start")}
            </Button>
            <Button
              variant="secondary"
              size="xs"
              onClick={handleJumpToLatest}
              className="gap-1.5"
            >
              <ArrowDownToLine className="size-3" />
              {t("session_preview.jump_to_latest")}
            </Button>
          </div>
        ) : null}
        <Button
          variant="ghost"
          size="xs"
          onClick={onDelete}
          aria-label={t("detail.delete_button_label")}
          data-mp-event="Dashboard/Detail/DeleteClicked"
          data-mp-page-name="space"
          data-mp-memory-id={m.id}
          className="gap-1 text-xs text-destructive/70 hover:text-destructive"
        >
          <Trash2 className="size-3" />
          {t("detail.delete")}
        </Button>
      </div>
    </div>
  );
};

const MetaCell = ({ label, value }: { label: string; value: string }) => {
  return (
    <div>
      <dt className="text-xs text-soft-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground/80">{value}</dd>
    </div>
  );
};
