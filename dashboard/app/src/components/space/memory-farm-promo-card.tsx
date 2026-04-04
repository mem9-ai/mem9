import type { MemoryFarmEntryStatus } from "./use-memory-farm-entry-state";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function MemoryFarmPromoCard({
  status,
  onAction,
}: {
  status: MemoryFarmEntryStatus;
  onAction: () => void;
}) {
  const { t } = useTranslation();
  let statusText = "";
  let ctaLabel = "";

  if (status === "ready") {
    statusText = t("memory_farm_preview.status.ready");
    ctaLabel = t("memory_farm_preview.cta.ready");
  } else if (status === "preparing") {
    statusText = t("memory_farm_preview.status.preparing");
    ctaLabel = t("memory_farm_preview.cta.preparing");
  } else {
    statusText = t("memory_farm_preview.status.unavailable");
    ctaLabel = t("memory_farm_preview.cta.unavailable");
  }

  const ctaClassName = `flex shrink-0 items-center gap-1.5 border-2 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all active:translate-y-[2px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
    status === "ready"
      ? "border-primary bg-primary text-primary-foreground shadow-[2px_2px_0px_0px_rgba(0,0,0,0.2)] hover:opacity-90"
      : "border-border bg-muted text-foreground shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)] hover:bg-accent"
  }`;

  // Use a fallback if the image doesn't exist, though spec says to use a committed static image
  const promoImageUrl = new URL("../../assets/promo/memory-farm-preview-card.png", import.meta.url).href;

  return (
    <div
      className="mb-4 overflow-hidden rounded-md border-[4px] border-border bg-card shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)] dark:shadow-[4px_4px_0px_0px_rgba(0,0,0,0.4)]"
      style={{ fontFamily: '"Ark Pixel Mono", monospace' }}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted border-b-[4px] border-border">
        <img
          src={promoImageUrl}
          alt={t("memory_farm_preview.title")}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ imageRendering: "pixelated" }}
          onError={(e) => {
            // Optional fallback if image isn't built yet
            e.currentTarget.style.display = 'none';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/30 to-transparent" />
        <div className="absolute left-3 top-3 border-2 border-border bg-destructive px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,0.2)]">
          Preview
        </div>
      </div>
      <div className="p-4">
        <h3 className="text-base font-bold text-foreground tracking-wide">{t("memory_farm_preview.title")}</h3>
        <p className="mt-1 text-xs font-medium leading-relaxed text-foreground/80">
          {t("memory_farm_preview.description")}
        </p>
        <p className="mt-1.5 text-[10px] leading-relaxed text-soft-foreground">
          {t("memory_farm_preview.sub_description")}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-soft-foreground">
              {statusText}
            </p>
          </div>
          <button
            type="button"
            onClick={onAction}
            data-mp-event="Dashboard/MemoryFarm/EnterClicked"
            data-mp-page-name="space"
            data-mp-entry-point="promo-card"
            data-mp-status={status}
            className={ctaClassName}
          >
            {status === "preparing" && <Loader2 className="size-3 animate-spin" />}
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
