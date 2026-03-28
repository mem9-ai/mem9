import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { analysisApi, AnalysisApiError } from "./analysis-client";
import type {
  CreateDeepAnalysisReportRequest,
  DeepAnalysisReportDetail,
  DeepAnalysisReportListItem,
} from "@/types/analysis";

const TERMINAL_REPORT_STATUSES = new Set(["COMPLETED", "FAILED"]);

export function getDeepAnalysisReportsQueryKey(spaceId: string): string[] {
  return ["space", spaceId, "deepAnalysis", "reports"];
}

export function getDeepAnalysisReportDetailQueryKey(
  spaceId: string,
  reportId: string | null,
): Array<string | null> {
  return ["space", spaceId, "deepAnalysis", "report", reportId];
}

function shouldPollReports(reports: DeepAnalysisReportListItem[]): boolean {
  return reports.some((report) => !TERMINAL_REPORT_STATUSES.has(report.status));
}

export function useDeepAnalysisReports(spaceId: string, active: boolean) {
  const queryClient = useQueryClient();
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: getDeepAnalysisReportsQueryKey(spaceId),
    queryFn: () => analysisApi.listDeepAnalysisReports(spaceId, 20, 0),
    enabled: !!spaceId,
    refetchInterval: (query) => {
      if (!active) return false;
      const data = query.state.data;
      return data && shouldPollReports(data.reports) ? 3000 : false;
    },
  });

  const reports = listQuery.data?.reports ?? [];

  useEffect(() => {
    if (reports.length === 0) {
      setSelectedReportId(null);
      return;
    }

    if (!selectedReportId || !reports.some((report) => report.id === selectedReportId)) {
      setSelectedReportId(reports[0]!.id);
    }
  }, [reports, selectedReportId]);

  const detailQuery = useQuery({
    queryKey: getDeepAnalysisReportDetailQueryKey(spaceId, selectedReportId),
    queryFn: () => analysisApi.getDeepAnalysisReport(spaceId, selectedReportId!),
    enabled: !!spaceId && !!selectedReportId,
    refetchInterval: (query) => {
      if (!active) return false;
      const data = query.state.data;
      return data && !TERMINAL_REPORT_STATUSES.has(data.status) ? 3000 : false;
    },
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateDeepAnalysisReportRequest) =>
      analysisApi.createDeepAnalysisReport(spaceId, input),
    onSuccess: async (result) => {
      setInlineError(null);
      setSelectedReportId(result.reportId);
      await queryClient.invalidateQueries({
        queryKey: getDeepAnalysisReportsQueryKey(spaceId),
      });
      await queryClient.invalidateQueries({
        queryKey: getDeepAnalysisReportDetailQueryKey(spaceId, result.reportId),
      });
    },
    onError: async (error) => {
      const message =
        error instanceof AnalysisApiError
          ? error.message
          : "Failed to create deep analysis report";
      setInlineError(message);
      const reportId =
        error instanceof AnalysisApiError
          ? String(error.details?.reportId ?? "")
          : "";

      if (reportId) {
        setSelectedReportId(reportId);
      }

      await queryClient.invalidateQueries({
        queryKey: getDeepAnalysisReportsQueryKey(spaceId),
      });
    },
  });

  const selectedReport = useMemo<DeepAnalysisReportDetail | null>(() => {
    if (detailQuery.data && detailQuery.data.id === selectedReportId) {
      return detailQuery.data;
    }

    const listItem = reports.find((report) => report.id === selectedReportId);
    if (!listItem) {
      return null;
    }

    return {
      ...listItem,
      report: null,
    };
  }, [detailQuery.data, reports, selectedReportId]);

  return {
    reports,
    selectedReport,
    selectedReportId,
    setSelectedReportId,
    inlineError,
    clearInlineError: () => setInlineError(null),
    isLoading: listQuery.isLoading,
    isCreating: createMutation.isPending,
    createReport: createMutation.mutateAsync,
  };
}
