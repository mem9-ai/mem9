export type TimeRangePreset = "7d" | "30d" | "90d" | "all";

export interface TimeRangeParams {
  updated_from?: string;
  updated_to?: string;
}

export interface TimelineSelection {
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;

export function presetToParams(preset: TimeRangePreset): TimeRangeParams {
  if (preset === "all") return {};
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  return {
    updated_from: new Date(Date.now() - days * DAY_MS).toISOString(),
  };
}

export function isValidTimelineSelection(
  selection: TimelineSelection | null | undefined,
): selection is TimelineSelection {
  if (!selection) return false;

  const from = Date.parse(selection.from);
  const to = Date.parse(selection.to);
  return Number.isFinite(from) && Number.isFinite(to) && from <= to;
}
