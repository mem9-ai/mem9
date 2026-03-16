import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { PulseSignalItem } from "@/lib/memory-pulse";

export function MemorySignalStack({
  items,
  activeTag,
  onTagSelect,
}: {
  items: PulseSignalItem[];
  activeTag?: string;
  onTagSelect: (tag: string | undefined) => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="min-w-0">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ring">
          {t("memory_pulse.signals.title")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("memory_pulse.signals.caption")}
        </p>
      </div>

      <div className="mt-5 space-y-2">
        {items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-foreground/10 px-4 py-5 text-sm text-muted-foreground">
            {t("memory_pulse.signals.empty")}
          </div>
        )}

        {items.map((item, index) => {
          const isActive = activeTag === item.value;

          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onTagSelect(isActive ? undefined : item.value)}
              className={cn(
                "group relative flex w-full items-center justify-between overflow-hidden rounded-2xl border px-4 py-3 text-left transition-colors",
                isActive
                  ? "border-foreground/12 bg-foreground/[0.04]"
                  : "border-transparent bg-secondary/42 hover:border-foreground/8 hover:bg-secondary/70",
              )}
              style={{
                animation: `slide-up 0.35s cubic-bezier(0.16,1,0.3,1) ${index * 40}ms both`,
              }}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-r-[1.25rem] bg-[linear-gradient(90deg,rgba(176,141,87,0.16),rgba(109,143,165,0.14))] transition-[width] duration-300"
                style={{ width: `${Math.max(item.ratio * 100, 14)}%` }}
              />
              <div className="relative min-w-0">
                <div className="text-sm font-medium text-foreground">
                  #{item.value}
                </div>
                <div className="mt-1 text-[11px] text-soft-foreground">
                  {t("memory_pulse.signals.count", { count: item.count })}
                </div>
              </div>
              <div className="relative font-mono text-xs text-muted-foreground">
                {item.count}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
