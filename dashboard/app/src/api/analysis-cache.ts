import {
  clearCachedAnalysisResult,
  readCachedAnalysisResult,
  writeCachedAnalysisResult,
} from "./local-cache";
import type { AnalysisJobSnapshotResponse } from "@/types/analysis";
import type { TimeRangePreset } from "@/types/time-range";

export interface AnalysisCacheEntry {
  fingerprint: string;
  jobId: string;
  updatedAt: string;
  taxonomyVersion: string;
  snapshot: AnalysisJobSnapshotResponse | null;
}

export function readAnalysisCache(
  spaceId: string,
  range: TimeRangePreset,
): Promise<AnalysisCacheEntry | null> {
  return readCachedAnalysisResult(spaceId, range);
}

export function writeAnalysisCache(
  spaceId: string,
  range: TimeRangePreset,
  entry: AnalysisCacheEntry,
): Promise<void> {
  return writeCachedAnalysisResult(spaceId, range, entry);
}

export function clearAnalysisCache(
  spaceId: string,
  range: TimeRangePreset,
): Promise<void> {
  return clearCachedAnalysisResult(spaceId, range);
}
