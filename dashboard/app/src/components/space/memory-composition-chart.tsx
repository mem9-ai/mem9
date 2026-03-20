import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PulseCompositionSegment } from "@/lib/memory-pulse";
import { cn } from "@/lib/utils";
import type { MemoryType } from "@/types/memory";

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

interface RingSegment extends PulseCompositionSegment {
  startAngle: number;
  endAngle: number;
  radius: number;
  strokeWidth: number;
}

function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number,
) {
  const angle = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angle),
    y: centerY + radius * Math.sin(angle),
  };
}

function describeArc(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  if (Math.abs(endAngle - startAngle) >= 359.99) {
    return [
      `M ${centerX} ${centerY - radius}`,
      `A ${radius} ${radius} 0 1 1 ${centerX} ${centerY + radius}`,
      `A ${radius} ${radius} 0 1 1 ${centerX} ${centerY - radius}`,
    ].join(" ");
  }

  const start = polarToCartesian(centerX, centerY, radius, endAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
  ].join(" ");
}

function buildRingSegments(
  segments: PulseCompositionSegment[],
  radius: number,
  strokeWidth: number,
  gapDegrees: number,
): RingSegment[] {
  if (segments.length === 0) {
    return [];
  }

  if (segments.length === 1) {
    const segment = segments[0];
    if (!segment) {
      return [];
    }

    return [
      {
        ...segment,
        startAngle: 0,
        endAngle: 360,
        radius,
        strokeWidth,
      },
    ];
  }

  const totalGap = gapDegrees * segments.length;
  const availableSweep = 360 - totalGap;
  let currentAngle = -90;

  return segments.map((segment) => {
    const sweep = Math.max(8, segment.ratio * availableSweep);
    const startAngle = currentAngle;
    const endAngle = startAngle + sweep;
    currentAngle = endAngle + gapDegrees;

    return {
      ...segment,
      startAngle,
      endAngle,
      radius,
      strokeWidth,
    };
  });
}

export function MemoryCompositionChart({
  total,
  outer,
  inner,
  innerKind,
  activeType,
  onTypeSelect,
}: {
  total: number;
  outer: PulseCompositionSegment[];
  inner: PulseCompositionSegment[];
  innerKind: "analysis" | "facet" | "none";
  activeType?: MemoryType;
  onTypeSelect: (type: MemoryType) => void;
}) {
  const { t } = useTranslation();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const outerRing = useMemo(() => buildRingSegments(outer.filter(s => s.value > 0), 78, 18, 8), [outer]);
  const innerRing = useMemo(() => buildRingSegments(inner.filter(s => s.value > 0), 54, 12, 6), [inner]);
  const hovered =
    outer.find((segment) => segment.key === activeKey) ??
    inner.find((segment) => segment.key === activeKey) ??
    null;
  const innerLabel =
    innerKind === "analysis"
      ? t("memory_pulse.composition.by_analysis")
      : innerKind === "facet"
        ? t("memory_pulse.composition.by_facets")
        : "";

  return (
    <section className="min-w-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ring">
            {t("memory_pulse.composition.title")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {innerLabel || t("memory_pulse.composition.total")}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col items-center justify-center">
        <div className="relative flex h-[220px] w-[220px] items-center justify-center">
          <svg viewBox="0 0 220 220" className="h-full w-full overflow-visible">
            {outerRing.map((segment) => (
              <path
                key={segment.key}
                d={describeArc(110, 110, segment.radius, segment.startAngle, segment.endAngle)}
                fill="none"
                stroke={`var(${segment.colorToken})`}
                strokeWidth={segment.strokeWidth}
                strokeLinecap="round"
                opacity={activeKey === null || activeKey === segment.key ? 0.95 : 0.28}
                className="cursor-pointer transition-opacity duration-200"
                onMouseEnter={() => setActiveKey(segment.key)}
                onMouseLeave={() => setActiveKey(null)}
                onFocus={() => setActiveKey(segment.key)}
                onBlur={() => setActiveKey(null)}
                onClick={() => {
                  if (segment.memoryType) {
                    onTypeSelect(segment.memoryType);
                  }
                }}
              />
            ))}

            {innerRing.map((segment) => (
              <path
                key={segment.key}
                d={describeArc(110, 110, segment.radius, segment.startAngle, segment.endAngle)}
                fill="none"
                stroke={`var(${segment.colorToken})`}
                strokeWidth={segment.strokeWidth}
                strokeLinecap="round"
                opacity={activeKey === null || activeKey === segment.key ? 0.82 : 0.2}
                className="transition-opacity duration-200"
                onMouseEnter={() => setActiveKey(segment.key)}
                onMouseLeave={() => setActiveKey(null)}
                onFocus={() => setActiveKey(segment.key)}
                onBlur={() => setActiveKey(null)}
              />
            ))}
          </svg>

          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {hovered ? (
              <>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-soft-foreground">
                  {t(hovered.labelKey)}
                </div>
                <div className="mt-1 text-3xl font-semibold tracking-[-0.06em] text-foreground">
                  {compactFormatter.format(hovered.value)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {`${Math.round(hovered.ratio * 100)}%`}
                </div>
              </>
            ) : (
              <div className="text-3xl font-semibold tracking-[-0.06em] text-foreground">
                {compactFormatter.format(total)}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
          {inner.map((segment) => {
            const isActive = activeType === segment.memoryType;
            return (
              <button
                key={segment.key}
                type="button"
                onClick={() => {
                  if (segment.memoryType) {
                    onTypeSelect(segment.memoryType);
                  }
                }}
                onMouseEnter={() => setActiveKey(segment.key)}
                onMouseLeave={() => setActiveKey(null)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-left transition-colors min-w-0 overflow-hidden",
                  isActive
                    ? "border-foreground/12 bg-foreground/[0.04]"
                    : "border-transparent bg-secondary/45 hover:border-foreground/8 hover:bg-secondary/70",
                )}
              >
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <span className="inline-flex min-w-0 items-center gap-2 text-xs text-foreground">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: `var(${segment.colorToken})` }}
                    />
                    <span className="truncate">{t(segment.labelKey)}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-soft-foreground">
                    {compactFormatter.format(segment.value)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
