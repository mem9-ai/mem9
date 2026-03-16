import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PulseTrendBucket } from "@/lib/memory-pulse";

function formatBucketLabel(
  locale: string,
  start: number,
  end: number,
): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const startLabel = formatter.format(start);
  const endLabel = formatter.format(end);

  if (startLabel === endLabel) {
    return startLabel;
  }

  return `${startLabel} - ${endLabel}`;
}

export function MemoryRhythmChart({
  buckets,
  maxCount,
  locale,
}: {
  buckets: PulseTrendBucket[];
  maxCount: number;
  locale: string;
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
  const activeBucket = buckets[activeIndex];

  useEffect(() => {
    setActiveIndex(defaultIndex);
  }, [defaultIndex]);

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
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.22em] text-ring">
            {t("memory_pulse.rhythm.title")}
          </p>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {t("memory_pulse.rhythm.caption")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-semibold tracking-[-0.05em] text-foreground">
            {activeBucket?.count ?? 0}
          </div>
          <div className="text-[11px] text-soft-foreground">
            {activeBucket
              ? formatBucketLabel(locale, activeBucket.start, activeBucket.end)
              : ""}
          </div>
        </div>
      </div>

      <div className="mt-5">
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
            return (
              <rect
                key={`bar-${point.start}-${point.end}`}
                x={point.x}
                y={point.y}
                width={point.width}
                height={point.height}
                rx={Math.min(point.width / 2, 8)}
                fill={isActive ? "var(--type-insight)" : "var(--foreground)"}
                opacity={isActive ? 0.9 : 0.16}
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
            return (
              <rect
                key={`hover-${point.start}-${point.end}`}
                className="cursor-pointer"
                x={point.x}
                y={0}
                width={point.width}
                height={geometry.height}
                fill="transparent"
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
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
