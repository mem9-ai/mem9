import type { TimeRangePreset } from "@/types/time-range";

interface AnalysisCacheEntry {
  fingerprint: string;
  jobId: string;
  updatedAt: string;
}

const CACHE_PREFIX = "mem9-analysis-cache";

function getCacheKey(spaceId: string, range: TimeRangePreset): string {
  return `${CACHE_PREFIX}:${spaceId}:${range}`;
}

export function readAnalysisCache(
  spaceId: string,
  range: TimeRangePreset,
): AnalysisCacheEntry | null {
  try {
    const raw = sessionStorage.getItem(getCacheKey(spaceId, range));
    if (!raw) return null;
    return JSON.parse(raw) as AnalysisCacheEntry;
  } catch {
    return null;
  }
}

export function writeAnalysisCache(
  spaceId: string,
  range: TimeRangePreset,
  entry: AnalysisCacheEntry,
): void {
  sessionStorage.setItem(getCacheKey(spaceId, range), JSON.stringify(entry));
}

export function clearAnalysisCache(
  spaceId: string,
  range: TimeRangePreset,
): void {
  sessionStorage.removeItem(getCacheKey(spaceId, range));
}
