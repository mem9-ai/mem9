import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { analysisApi } from "@/api/analysis-client";
import { readCachedAnalysisResult } from "@/api/local-cache";
import {
  buildPixelFarmNpcDialogCatalog,
  type PixelFarmNpcDialogCatalog,
} from "@/lib/pixel-farm/npc-dialog-content";
import type {
  AnalysisJobSnapshotResponse,
  DeepAnalysisReportDetail,
  DeepAnalysisReportListItem,
} from "@/types/analysis";

function pickLatestCompletedReport(
  reports: DeepAnalysisReportListItem[],
): DeepAnalysisReportListItem | null {
  return [...reports]
    .filter((report) => report.status === "COMPLETED")
    .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))[0] ?? null;
}

export interface PixelFarmNpcDialogContentState {
  catalog: PixelFarmNpcDialogCatalog;
  deepReport: DeepAnalysisReportDetail | null;
  lightSnapshot: AnalysisJobSnapshotResponse | null;
}

export function usePixelFarmNpcDialogContent(
  spaceId: string,
): PixelFarmNpcDialogContentState {
  const { t } = useTranslation();

  const lightQuery = useQuery({
    queryKey: ["space", spaceId, "pixelFarm", "npcDialog", "light"],
    queryFn: async () => {
      const cached = await readCachedAnalysisResult(spaceId, "all");
      return cached?.snapshot ?? null;
    },
    enabled: !!spaceId,
    staleTime: 60_000,
    retry: false,
  });

  const reportListQuery = useQuery({
    queryKey: ["space", spaceId, "pixelFarm", "npcDialog", "deepList"],
    queryFn: () => analysisApi.listDeepAnalysisReports(spaceId, 20, 0),
    enabled: !!spaceId,
    staleTime: 60_000,
    retry: false,
  });

  const latestCompletedReport = useMemo(
    () => pickLatestCompletedReport(reportListQuery.data?.reports ?? []),
    [reportListQuery.data?.reports],
  );

  const deepDetailQuery = useQuery({
    queryKey: [
      "space",
      spaceId,
      "pixelFarm",
      "npcDialog",
      "deepDetail",
      latestCompletedReport?.id ?? null,
    ],
    queryFn: () => analysisApi.getDeepAnalysisReport(spaceId, latestCompletedReport!.id),
    enabled: !!spaceId && !!latestCompletedReport,
    staleTime: 60_000,
    retry: false,
  });

  const deepReport = deepDetailQuery.data?.status === "COMPLETED"
    ? deepDetailQuery.data
    : null;
  const lightSnapshot = lightQuery.data ?? null;

  return {
    catalog: buildPixelFarmNpcDialogCatalog({
      deepReport,
      lightSnapshot,
      t: (key, vars) => t(key, vars),
    }),
    deepReport,
    lightSnapshot,
  };
}
