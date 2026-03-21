import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PulseTrendBucket } from "@/lib/memory-pulse";
import type { TimelineSelection } from "@/types/time-range";

function formatBucketLabel(
  locale: string,
  start: number,
  end: number,
): string {
  const duration = end - start;
  const formatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const startDate = new Date(start);
  const endDate = new Date(end);
  const startLabel = formatter.format(startDate);
  const endLabel = formatter.format(endDate);

  if (duration < 86_400_000) {
    const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const timeFormatter = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    });

    if (startLabel === endLabel) {
      return `${startLabel}, ${timeFormatter.format(startDate)} - ${timeFormatter.format(endDate)}`;
    }

    return `${dateTimeFormatter.format(startDate)} - ${dateTimeFormatter.format(endDate)}`;
  }

  if (startLabel === endLabel) {
    return startLabel;
  }

  return `${startLabel} - ${endLabel}`;
}

export function MemoryRhythmChart({
  buckets,
  maxCount,
  locale,
  selectedTimeline,
  onBucketSelect,
  onBucketClear,
}: {
  buckets: PulseTrendBucket[];
  maxCount: number;
  locale: string;
  selectedTimeline?: TimelineSelection;
  onBucketSelect?: (selection: TimelineSelection) => void;
  onBucketClear?: () => void;
}) {
  const { t } = useTranslation();
  const chartId = useId();
  const defaultIndex = useMemo(() => {
    let lastActive = -1;

    for (let index = buckets.length - 1; index >= 0; index -= 1) {
      if ((buckets[index]?.count ?? 0) > 0) {
        lastActive = index;
        break;
      }
    }

    return lastActive >= 0 ? lastActive : Math.max(buckets.length - 1, 0);
  }, [buckets]);
  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const selectedIndex = useMemo(() => {
    if (!selectedTimeline) return -1;

    return buckets.findIndex((bucket) =>
      new Date(bucket.start).toISOString() === selectedTimeline.from &&
      new Date(bucket.end).toISOString() === selectedTimeline.to,
    );
  }, [buckets, selectedTimeline]);

  useEffect(() => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : defaultIndex);
  }, [defaultIndex, selectedIndex]);
  const displayedIndex = selectedIndex >= 0 ? selectedIndex : activeIndex;
  const displayedBucket = buckets[displayedIndex];

  const geometry = useMemo(() => {
    const height = 168;
    const width = 320;
    const count = Math.max(buckets.length, 1);
    const gap = count > 10 ? 5 : 7;
    const barWidth = (width - gap * (count - 1)) / count;
    const safeMax = Math.max(maxCount, 1);
    const baseY = height - 12;
    const points = buckets.map((bucket, index) => {
      const normalized = bucket.count / safeMax;
      const barHeight = Math.max(10, normalized * 104);
      const x = index * (barWidth + gap);
      const y = baseY - barHeight;

      return {
        ...bucket,
        x,
        y,
        width: barWidth,
        height: barHeight,
        centerX: x + barWidth / 2,
      };
    });
    const linePoints = points.map((point) => `${point.centerX},${point.y}`).join(" ");
    const areaPath = points.length === 0
      ? ""
      : [
          `M ${points[0]?.centerX ?? 0} ${baseY}`,
          ...points.map((point) => `L ${point.centerX} ${point.y}`),
          `L ${points[points.length - 1]?.centerX ?? 0} ${baseY}`,
          "Z",
        ].join(" ");

    return {
      baseY,
      barWidth,
      points,
      linePoints,
      areaPath,
      width,
      height,
    };
  }, [buckets, maxCount]);
  const tickIndexes = [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1]
    .filter((index, position, items) => index >= 0 && items.indexOf(index) === position);

  if (buckets.length === 0) {
    return (
      <section className="min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ring">
              {t("memory_pulse.rhythm.title")}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("memory_pulse.rhythm.empty")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="min-w-0">
      <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-start gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.22em] text-ring">
              {t("memory_pulse.rhythm.title")}
            </p>
            <span className="inline-flex items-center rounded-full border border-foreground/10 bg-background/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-foreground/75">
              {t("memory_pulse.rhythm.timeline_badge")}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {t("memory_pulse.rhythm.caption")}
          </p>
          <p className="mt-1 text-xs text-foreground/70">
            {selectedIndex >= 0
              ? t("memory_pulse.rhythm.selected_hint")
              : t("memory_pulse.rhythm.helper")}
          </p>
        </div>
        <div className="w-[8.5rem] text-right">
          <div className="text-2xl font-semibold tracking-[-0.05em] text-foreground tabular-nums">
            {displayedBucket?.count ?? 0}
          </div>
          <div className="whitespace-nowrap text-[11px] text-soft-foreground tabular-nums">
            {displayedBucket
              ? formatBucketLabel(locale, displayedBucket.start, displayedBucket.end)
              : ""}
          </div>
        </div>
      </div>

      {selectedIndex >= 0 && displayedBucket ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-type-insight/20 bg-type-insight/10 px-3 py-1 text-xs text-foreground">
            <span className="size-2 rounded-full bg-type-insight" />
            {t("memory_pulse.rhythm.selected_range", {
              range: formatBucketLabel(locale, displayedBucket.start, displayedBucket.end),
            })}
          </span>
          <button
            type="button"
            onClick={onBucketClear}
            className="inline-flex items-center rounded-full border border-foreground/10 bg-background/70 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
          >
            {t("memory_pulse.rhythm.clear")}
          </button>
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl border border-foreground/8 bg-background/45 px-3 py-3 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
        <svg
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          className="h-44 w-full overflow-visible"
          aria-labelledby={`${chartId}-title`}
          role="img"
        >
          <title id={`${chartId}-title`}>
            {t("memory_pulse.rhythm.caption")}
          </title>
          <defs>
            <linearGradient id={`${chartId}-area`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--type-insight)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--type-insight)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${chartId}-line`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="var(--foreground)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--type-insight)" stopOpacity="0.9" />
            </linearGradient>
          </defs>

          <path
            d={geometry.areaPath}
            fill={`url(#${chartId}-area)`}
          />

          {geometry.points.map((point, index) => {
            const isActive = index === activeIndex;
            const isSelected = index === selectedIndex;
            return (
              <rect
                key={`bar-${point.start}-${point.end}`}
                x={point.x}
                y={point.y}
                width={point.width}
                height={point.height}
                rx={Math.min(point.width / 2, 8)}
                fill={
                  isSelected || isActive
                    ? "var(--type-insight)"
                    : "var(--foreground)"
                }
                opacity={isSelected ? 1 : isActive ? 0.9 : 0.16}
                stroke={isSelected ? "var(--foreground)" : "transparent"}
                strokeWidth={isSelected ? 1.25 : 0}
              />
            );
          })}

          <polyline
            fill="none"
            points={geometry.linePoints}
            stroke={`url(#${chartId}-line)`}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {geometry.points.map((point, index) => {
            const isActive = index === activeIndex;
            const isSelected = index === selectedIndex;
            const selection = {
              from: new Date(point.start).toISOString(),
              to: new Date(point.end).toISOString(),
            };

            return (
              <rect
                key={`hover-${point.start}-${point.end}`}
                className="cursor-pointer"
                x={point.x}
                y={0}
                width={point.width}
                height={geometry.height}
                fill={
                  isSelected
                    ? "color-mix(in srgb, var(--type-insight) 16%, transparent)"
                    : isActive
                      ? "color-mix(in srgb, var(--foreground) 7%, transparent)"
                      : "transparent"
                }
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => onBucketSelect?.(selection)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onBucketSelect?.(selection);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={t("memory_pulse.rhythm.bucket_label", {
                  range: formatBucketLabel(locale, point.start, point.end),
                  count: point.count,
                })}
                data-timeline-bucket-index={index}
              />
            );
          })}
        </svg>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-soft-foreground">
        {tickIndexes.map((index) => {
          const bucket = buckets[index];
          if (!bucket) {
            return null;
          }

          return (
            <span key={bucket.start}>
              {formatBucketLabel(locale, bucket.start, bucket.end)}
            </span>
          );
        })}
      </div>
    </section>
  );
}
