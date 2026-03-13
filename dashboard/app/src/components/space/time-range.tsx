import type { TFunction } from "i18next";
import type { TimeRangePreset } from "@/types/time-range";

const PRESETS: TimeRangePreset[] = ["7d", "30d", "90d", "all"];

export function TimeRangeSelector({
  value,
  onChange,
  t,
}: {
  value: TimeRangePreset;
  onChange: (preset: TimeRangePreset) => void;
  t: TFunction;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-secondary/60 p-0.5">
      {PRESETS.map((preset) => (
        <button
          key={preset}
          onClick={() => onChange(preset)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
            value === preset
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t(`time_range.${preset}`)}
        </button>
      ))}
    </div>
  );
}
