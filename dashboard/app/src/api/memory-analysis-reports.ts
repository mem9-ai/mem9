import { useQuery } from "@tanstack/react-query";

const ANALYSIS_API_BASE =
  import.meta.env.VITE_ANALYSIS_API_BASE || "/your-memory/analysis-api";

export type MemoryAnalysisReportType = "focus_area" | "long_term_goal" | "emotion";

export interface MemoryAnalysisReport {
  report_id: number;
  template_id: string;
  report_content: string;
  generated_at: string;
  render_status: "success" | "fail";
  fail_reason: string | null;
  memory_count: number;
}

export interface MemoryAnalysisReportListResponse {
  reports: MemoryAnalysisReport[];
}

async function requestMemoryAnalysisReports(
  spaceId: string,
  type: MemoryAnalysisReportType,
): Promise<MemoryAnalysisReportListResponse> {
  const params = new URLSearchParams({ type });
  const response = await fetch(`${ANALYSIS_API_BASE}/v1/memory-analysis/report/list?${params}`, {
    headers: {
      "x-mem9-api-key": spaceId.trim(),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(body?.message || body?.error || `Memory analysis report API error ${response.status}`);
  }

  const body = await response.json() as Partial<MemoryAnalysisReportListResponse> | Partial<MemoryAnalysisReport>[];
  const reports = Array.isArray(body) ? body : body.reports;
  return {
    reports: Array.isArray(reports) ? reports.map(normalizeReport) : [],
  };
}

async function requestMemoryAnalysisReport(
  spaceId: string,
  reportId: string,
): Promise<MemoryAnalysisReport | null> {
  const response = await fetch(`${ANALYSIS_API_BASE}/v1/memory-analysis/report/${encodeURIComponent(reportId)}`, {
    headers: {
      "x-mem9-api-key": spaceId.trim(),
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(body?.message || body?.error || `Memory analysis report API error ${response.status}`);
  }

  const body = await response.json() as Partial<MemoryAnalysisReport> | null;
  return body ? normalizeReport(body) : null;
}

function normalizeReport(report: Partial<MemoryAnalysisReport>): MemoryAnalysisReport {
  return {
    report_id: Number.isFinite(Number(report.report_id)) ? Number(report.report_id) : 0,
    template_id: typeof report.template_id === "string" ? report.template_id : "",
    report_content: typeof report.report_content === "string" ? report.report_content : "",
    generated_at: typeof report.generated_at === "string" ? report.generated_at : "",
    render_status: report.render_status === "fail" ? "fail" : "success",
    fail_reason: typeof report.fail_reason === "string" ? report.fail_reason : null,
    memory_count: Number.isFinite(Number(report.memory_count)) ? Number(report.memory_count) : 0,
  };
}

export function useMemoryAnalysisReports(
  spaceId: string,
  type: MemoryAnalysisReportType | null,
) {
  return useQuery({
    queryKey: ["space", spaceId, "memoryAnalysisReports", type],
    queryFn: () => requestMemoryAnalysisReports(spaceId, type!),
    enabled: !!spaceId && !!type,
  });
}

export function useMemoryAnalysisReport(
  spaceId: string | null,
  reportId: string | null,
) {
  return useQuery({
    queryKey: ["space", spaceId, "memoryAnalysisReport", reportId],
    queryFn: () => requestMemoryAnalysisReport(spaceId!, reportId!),
    enabled: !!spaceId && !!reportId,
  });
}
