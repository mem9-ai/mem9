import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const dayMs = 24 * 60 * 60 * 1000;
const maxRangeDays = 13;

export interface AnalysisDateRange {
  createdAfter: string;
  createdBefore: string;
}

export function DateRangePicker({
  value,
  onChange,
  label,
  startLabel,
  endLabel,
  className,
  buttonClassName,
}: {
  value: AnalysisDateRange;
  onChange: (value: AnalysisDateRange) => void;
  label: string;
  startLabel: string;
  endLabel: string;
  className?: string;
  buttonClassName?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<"start" | "end">("start");
  const [rangeAnchor, setRangeAnchor] = useState<Date | null>(null);
  const startDate = useMemo(() => dateKeyToLocalDate(isoToDateKey(value.createdAfter)), [value.createdAfter]);
  const endDate = useMemo(() => dateKeyToLocalDate(isoToDateKey(value.createdBefore)), [value.createdBefore]);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(endDate));
  const weeks = useMemo(() => buildCalendarWeeks(visibleMonth), [visibleMonth]);
  const rangeLabel = formatRangeLabel(value.createdAfter, value.createdBefore);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    setVisibleMonth(startOfMonth(endDate));
  }, [endDate]);

  const selectDate = (date: Date) => {
    if (editing === "end" && rangeAnchor) {
      onChange(normalizeDateRange(rangeAnchor, date, "range"));
      setRangeAnchor(null);
      setEditing("start");
      return;
    }

    setRangeAnchor(date);
    onChange(normalizeDateRange(date, date, "start"));
    setEditing("end");
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={`${label}: ${rangeLabel}`}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border border-foreground/8 bg-background/35 px-3 py-2 text-sm transition-colors hover:border-foreground/18 hover:bg-background/50",
          buttonClassName,
        )}
      >
        <CalendarDays className="size-4 text-soft-foreground" />
        <strong className="tabular-nums">{rangeLabel}</strong>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-foreground/10 bg-popover p-3 text-popover-foreground shadow-xl">
          <div className="grid grid-cols-2 gap-2">
            <RangeEndpointButton
              active={editing === "start"}
              label={startLabel}
              value={formatDate(startDate)}
              onClick={() => {
                setRangeAnchor(null);
                setEditing("start");
              }}
            />
            <RangeEndpointButton
              active={editing === "end"}
              label={endLabel}
              value={formatDate(endDate)}
              onClick={() => {
                setRangeAnchor(startDate);
                setEditing("end");
              }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={() => setVisibleMonth((month) => addMonths(month, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <p className="text-sm font-semibold">{formatMonth(visibleMonth)}</p>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={() => setVisibleMonth((month) => addMonths(month, 1))}
              disabled={isSameMonth(visibleMonth, new Date())}
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-soft-foreground">
            {weekdayLabels().map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {weeks.map((date) => {
              const outside = !isSameMonth(date, visibleMonth);
              const disabled = isOutsideSelectableRange(date, editing, startDate, endDate);
              const selectedStart = isSameDay(date, startDate);
              const selectedEnd = isSameDay(date, endDate);
              const inRange = dateOnlyTimestamp(date) > dateOnlyTimestamp(startDate)
                && dateOnlyTimestamp(date) < dateOnlyTimestamp(endDate);
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  disabled={disabled}
                  onClick={() => selectDate(date)}
                  className={cn(
                    "h-8 rounded-md text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-30",
                    outside ? "text-soft-foreground/45" : "text-foreground",
                    inRange ? "bg-blue-500/10 text-blue-500" : "hover:bg-foreground/6",
                    (selectedStart || selectedEnd) && "bg-blue-500 text-white hover:bg-blue-500",
                  )}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RangeEndpointButton({
  active,
  label,
  value,
  onClick,
}: {
  active: boolean;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border px-3 py-2 text-left transition-colors",
        active ? "border-blue-500/65 bg-blue-500/10" : "border-foreground/10 bg-background/35 hover:border-foreground/18",
      )}
    >
      <span className="block text-[11px] text-soft-foreground">{label}</span>
      <span className="mt-1 block text-sm font-semibold tabular-nums">{value}</span>
    </button>
  );
}

export function buildDefaultAnalysisRange(): AnalysisDateRange {
  const createdBefore = new Date();
  const createdAfter = addDays(createdBefore, -maxRangeDays);
  return {
    createdAfter: createdAfter.toISOString(),
    createdBefore: createdBefore.toISOString(),
  };
}

function normalizeDateRange(start: Date, end: Date, changedField: "start" | "range"): AnalysisDateRange {
  const today = startOfDay(new Date());
  let nextStart = clampMaxDate(startOfDay(start), today);
  let nextEnd = clampMaxDate(startOfDay(end), today);

  if (changedField === "start") {
    if (nextStart.getTime() > today.getTime()) {
      nextStart = today;
    }
    if (nextStart.getTime() > nextEnd.getTime()) {
      nextEnd = nextStart;
    }
    if (dateDiffDays(nextStart, nextEnd) > maxRangeDays) {
      nextEnd = addDays(nextStart, maxRangeDays);
      if (nextEnd.getTime() > today.getTime()) {
        nextEnd = today;
        nextStart = addDays(nextEnd, -maxRangeDays);
      }
    }
  } else {
    if (nextEnd.getTime() < nextStart.getTime()) {
      const previousStart = nextStart;
      nextStart = nextEnd;
      nextEnd = previousStart;
    }
    if (dateDiffDays(nextStart, nextEnd) > maxRangeDays) {
      nextStart = addDays(nextEnd, -maxRangeDays);
    }
  }

  return {
    createdAfter: applyCurrentTime(nextStart).toISOString(),
    createdBefore: applyCurrentTime(nextEnd).toISOString(),
  };
}

function isOutsideSelectableRange(
  date: Date,
  editing: "start" | "end",
  startDate: Date,
  endDate: Date,
): boolean {
  const timestamp = dateOnlyTimestamp(date);
  const todayTimestamp = dateOnlyTimestamp(new Date());

  if (timestamp > todayTimestamp) {
    return true;
  }

  if (editing === "start") {
    const minStartTimestamp = dateOnlyTimestamp(addDays(endDate, -maxRangeDays));
    const maxStartTimestamp = dateOnlyTimestamp(endDate);
    return timestamp < minStartTimestamp || timestamp > maxStartTimestamp;
  }

  const minEndTimestamp = dateOnlyTimestamp(startDate);
  const maxEndTimestamp = Math.min(
    dateOnlyTimestamp(addDays(startDate, maxRangeDays)),
    todayTimestamp,
  );
  return timestamp < minEndTimestamp || timestamp > maxEndTimestamp;
}

function clampMaxDate(date: Date, maxDate: Date): Date {
  if (date.getTime() > maxDate.getTime()) {
    return maxDate;
  }
  return date;
}

function buildCalendarWeeks(month: Date): Date[] {
  const first = startOfMonth(month);
  const startOffset = (first.getDay() + 6) % 7;
  const start = addDays(first, -startOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function isoToDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return isoToDateKey(new Date().toISOString());
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyToLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

function applyCurrentTime(date: Date): Date {
  const now = new Date();
  const next = new Date(date);
  next.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  if (isSameDay(next, now) && next.getTime() > now.getTime()) {
    return now;
  }
  return next;
}

function formatRangeLabel(start: string, end: string): string {
  return `${formatShortDate(new Date(start))} - ${formatShortDate(new Date(end))}`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
  }).format(date);
}

function formatMonth(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
  }).format(date);
}

function weekdayLabels(): string[] {
  const monday = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, index) => (
    new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(addDays(monday, index))
  ));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function dateOnlyTimestamp(date: Date): number {
  return startOfDay(date).getTime();
}

function dateDiffDays(start: Date, end: Date): number {
  return Math.round((dateOnlyTimestamp(end) - dateOnlyTimestamp(start)) / dayMs);
}

function isSameDay(left: Date, right: Date): boolean {
  return dateOnlyTimestamp(left) === dateOnlyTimestamp(right);
}

function isSameMonth(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}
