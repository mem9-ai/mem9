export type TimeRangePreset = "7d" | "30d" | "90d" | "all";

export interface TimeRangeParams {
  updated_from?: string;
  updated_to?: string;
}

const DAY_MS = 86_400_000;

export function presetToParams(preset: TimeRangePreset): TimeRangeParams {
  if (preset === "all") return {};
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  return {
    updated_from: new Date(Date.now() - days * DAY_MS).toISOString(),
  };
}
