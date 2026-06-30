import { useMutation, useQuery } from "@tanstack/react-query";

const ANALYSIS_API_BASE =
  import.meta.env.VITE_ANALYSIS_API_BASE || "/your-memory/analysis-api";

export type MemoryAnalysisReportType =
  | "focus_area"
  | "long_term_goal"
  | "emotion"
  | "preference_signal"
  | "growth_signal";

export type MemorySignalDimension =
  | "long_term_goal"
  | "focus_area"
  | "emotion"
  | "preference_signal"
  | "growth_signal";

export interface MemoryAnalysisReport {
  report_id: number;
  template_id: string;
  report_content: string;
  generated_at: string;
  render_status: MemoryAnalysisReportStatus;
  report_stage: MemoryAnalysisReportStage;
  fail_reason: string | null;
  memory_count: number;
  startTime: string;
  endTime: string;
}

export type MemoryAnalysisReportStatus = "queued" | "running" | "success" | "fail";
export type MemoryAnalysisReportStage = "queued" | "fetch_source" | "period_summary" | "aggregation" | "save_result" | "complete" | "failed";

export interface MemoryAnalysisReportListResponse {
  reports: MemoryAnalysisReport[];
}

export interface MemoryAnalysisChangeEvidence {
  evidenceId: string;
  quote: string;
  correctness: string;
  edited: boolean;
  review?: Record<string, unknown> | null;
}

export interface MemoryAnalysisChangePeriod {
  start: string;
  end: string;
}

export interface MemoryAnalysisChange {
  title: string;
  summary: string;
  period: MemoryAnalysisChangePeriod;
  evidence: MemoryAnalysisChangeEvidence[];
}

export interface MemoryAnalysisChangeDimensionGroup {
  dimension: MemorySignalDimension;
  summary: string;
  changes: MemoryAnalysisChange[];
}

export interface AnalyzeMemorySourceResponse {
  total: number;
  memoryCount: number;
  model: string;
  dimensions: MemoryAnalysisChangeDimensionGroup[];
}

export interface AnalyzeMemorySourceInput {
  createdAfter: string;
  createdBefore: string;
}

export interface GenerateMemoryAnalysisReportInput {
  analysisRange: AnalyzeMemorySourceInput;
}

export interface GenerateMemoryAnalysisReportResult {
  report: MemoryAnalysisReport;
  analysis: AnalyzeMemorySourceResponse | null;
  renderStatus: MemoryAnalysisReportStatus;
  memoryCount: number;
  failReason: string | null;
}

export interface AnalyzeMemorySourceQueryOptions {
  enabled?: boolean;
}

export interface LatestCompletedMemoryAnalysisResult {
  report: MemoryAnalysisReport | null;
  analysis: AnalyzeMemorySourceResponse;
}

export interface EditSessionMessageInput {
  messageId: string;
  content: string;
  reason?: string;
}

export interface EditSessionMessageResult {
  content: string;
  metadata: Record<string, unknown> | null;
}

export interface MarkSessionMessageInput {
  messageId: string;
  correctness: "correct" | "incorrect";
}

export interface MarkSessionMessageResult {
  metadata: Record<string, unknown> | null;
}

async function requestMemoryAnalysisReports(
  spaceId: string,
  type?: MemoryAnalysisReportType,
): Promise<MemoryAnalysisReportListResponse> {
  const params = type ? `?${new URLSearchParams({ type })}` : "";
  const response = await fetch(`${ANALYSIS_API_BASE}/v1/memory-analysis/report/list${params}`, {
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

async function requestAnalyzeMemorySource(
  spaceId: string,
  input: AnalyzeMemorySourceInput,
  signal?: AbortSignal,
): Promise<AnalyzeMemorySourceResponse> {
  const params = new URLSearchParams({
    createdAfter: input.createdAfter,
    createdBefore: input.createdBefore,
  });
  const response = await fetch(`${ANALYSIS_API_BASE}/v1/memory-analysis?${params}`, {
    method: "POST",
    signal,
    headers: {
      "x-mem9-api-key": spaceId.trim(),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(body?.message || body?.error || `Memory analysis API error ${response.status}`);
  }

  const body = await response.json() as Partial<MemoryAnalysisReport> | null;
  const initialReport = normalizeReport(body ?? {});
  const completedReport = await waitForMemoryAnalysisReport(spaceId, initialReport, signal);

  if (completedReport.render_status === "fail") {
    throw new Error(completedReport.fail_reason || "Memory analysis generation failed");
  }

  return parseAnalyzeMemorySourceReport(completedReport) ?? normalizeAnalyzeMemorySourceResponse(null);
}

async function requestCreateMemoryAnalysisReport(
  spaceId: string,
  input: AnalyzeMemorySourceInput,
): Promise<MemoryAnalysisReport> {
  const params = new URLSearchParams({
    createdAfter: input.createdAfter,
    createdBefore: input.createdBefore,
  });
  const response = await fetch(`${ANALYSIS_API_BASE}/v1/memory-analysis/report?${params}`, {
    method: "POST",
    headers: {
      "x-mem9-api-key": spaceId.trim(),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(body?.message || body?.error || `Memory analysis report API error ${response.status}`);
  }

  const body = await response.json() as Partial<MemoryAnalysisReport> | null;
  return normalizeReport(body ?? {});
}

async function requestGenerateMemoryAnalysisReport(
  spaceId: string,
  input: GenerateMemoryAnalysisReportInput,
): Promise<GenerateMemoryAnalysisReportResult> {
  const report = await requestCreateMemoryAnalysisReport(spaceId, input.analysisRange);
  const analysis = parseAnalyzeMemorySourceReport(report);

  return {
    report,
    analysis,
    renderStatus: report.render_status,
    memoryCount: report.memory_count,
    failReason: report.fail_reason,
  };
}

async function requestMemoryAnalysisReport(
  spaceId: string,
  reportId: string,
  signal?: AbortSignal,
): Promise<MemoryAnalysisReport | null> {
  const response = await fetch(`${ANALYSIS_API_BASE}/v1/memory-analysis/report/${encodeURIComponent(reportId)}`, {
    signal,
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

async function requestLatestCompletedMemoryAnalysis(
  spaceId: string,
): Promise<LatestCompletedMemoryAnalysisResult> {
  const { reports } = await requestMemoryAnalysisReports(spaceId);
  const report = reports.find(isDisplayableCompletedReport) ?? null;

  return {
    report,
    analysis: report
      ? parseAnalyzeMemorySourceReport(report) ?? normalizeAnalyzeMemorySourceResponse(null)
      : normalizeAnalyzeMemorySourceResponse(null),
  };
}

async function waitForMemoryAnalysisReport(
  spaceId: string,
  initialReport: MemoryAnalysisReport,
  signal?: AbortSignal,
): Promise<MemoryAnalysisReport> {
  let report = initialReport;

  while (!isCompletedMemoryAnalysisReportStatus(report.render_status)) {
    if (!report.report_id) {
      throw new Error("Memory analysis report did not include a report_id");
    }

    await sleep(2 * 1000, signal);
    const nextReport = await requestMemoryAnalysisReport(spaceId, String(report.report_id), signal);
    if (!nextReport) {
      throw new Error(`Memory analysis report ${report.report_id} was not found`);
    }
    report = nextReport;
  }

  return report;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      reject(signal.reason);
    }, { once: true });
  });
}

async function requestEditSessionMessage(
  spaceId: string,
  input: EditSessionMessageInput,
): Promise<EditSessionMessageResult> {
  const response = await fetch(`${ANALYSIS_API_BASE}/v1/memory-analysis/session-messages/${encodeURIComponent(input.messageId)}/edit`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-mem9-api-key": spaceId.trim(),
    },
    body: JSON.stringify({
      content: input.content,
      reason: input.reason,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(body?.message || body?.error || `Session message edit API error ${response.status}`);
  }

  const body = await response.json().catch(() => null) as { content?: unknown; metadata?: unknown } | null;
  return {
    content: typeof body?.content === "string" ? body.content : input.content,
    metadata: toCamelCaseRecord(body?.metadata),
  };
}

async function requestMarkSessionMessage(
  spaceId: string,
  input: MarkSessionMessageInput,
): Promise<MarkSessionMessageResult> {
  const response = await fetch(`${ANALYSIS_API_BASE}/v1/memory-analysis/session-messages/${encodeURIComponent(input.messageId)}/mark`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-mem9-api-key": spaceId.trim(),
    },
    body: JSON.stringify({
      correctness: input.correctness,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(body?.message || body?.error || `Session message mark API error ${response.status}`);
  }

  const body = await response.json().catch(() => null) as { metadata?: unknown } | null;
  return {
    metadata: toCamelCaseRecord(body?.metadata) ?? { correctness: input.correctness },
  };
}

function normalizeReport(report: Partial<MemoryAnalysisReport>): MemoryAnalysisReport {
  const rawReport = report as Partial<MemoryAnalysisReport> & {
    start_time?: unknown;
    end_time?: unknown;
  };

  return {
    report_id: Number.isFinite(Number(report.report_id)) ? Number(report.report_id) : 0,
    template_id: typeof report.template_id === "string" ? report.template_id : "",
    report_content: typeof report.report_content === "string" ? report.report_content : "",
    generated_at: typeof report.generated_at === "string" ? report.generated_at : "",
    render_status: isMemoryAnalysisReportStatus(report.render_status) ? report.render_status : "queued",
    report_stage: isMemoryAnalysisReportStage(report.report_stage)
      ? report.report_stage
      : report.render_status === "success" ? "complete" : "queued",
    fail_reason: typeof report.fail_reason === "string" ? report.fail_reason : null,
    memory_count: Number.isFinite(Number(report.memory_count)) ? Number(report.memory_count) : 0,
    startTime: typeof report.startTime === "string"
      ? report.startTime
      : typeof rawReport.start_time === "string" ? rawReport.start_time : "",
    endTime: typeof report.endTime === "string"
      ? report.endTime
      : typeof rawReport.end_time === "string" ? rawReport.end_time : "",
  };
}

function parseAnalyzeMemorySourceReport(report: MemoryAnalysisReport): AnalyzeMemorySourceResponse | null {
  if (!report.report_content) {
    return null;
  }

  try {
    const parsed = JSON.parse(report.report_content) as Partial<AnalyzeMemorySourceResponse> | null;
    return normalizeAnalyzeMemorySourceResponse(parsed);
  } catch {
    return null;
  }
}

function normalizeAnalyzeMemorySourceResponse(
  response: Partial<AnalyzeMemorySourceResponse> | null,
): AnalyzeMemorySourceResponse {
  return {
    total: Number.isFinite(Number(response?.total)) ? Number(response?.total) : 0,
    memoryCount: Number.isFinite(Number(response?.memoryCount)) ? Number(response?.memoryCount) : 0,
    model: typeof response?.model === "string" ? response.model : "",
    dimensions: Array.isArray(response?.dimensions)
      ? response.dimensions.map(normalizeDimensionGroup).filter((group) => group.changes.length > 0)
      : [],
  };
}

function normalizeDimensionGroup(
  group: Partial<MemoryAnalysisChangeDimensionGroup>,
): MemoryAnalysisChangeDimensionGroup {
  return {
    dimension: isMemorySignalDimension(group.dimension) ? group.dimension : "focus_area",
    summary: typeof group.summary === "string" ? group.summary : "",
    changes: Array.isArray(group.changes) ? group.changes.map(normalizeChange) : [],
  };
}

function normalizeChange(change: Partial<MemoryAnalysisChange>): MemoryAnalysisChange {
  return {
    title: typeof change.title === "string" ? change.title : "",
    summary: typeof change.summary === "string" ? change.summary : "",
    period: {
      start: typeof change.period?.start === "string" ? change.period.start : "",
      end: typeof change.period?.end === "string" ? change.period.end : "",
    },
    evidence: Array.isArray(change.evidence) ? change.evidence.map(normalizeEvidence) : [],
  };
}

function normalizeEvidence(evidence: Partial<MemoryAnalysisChangeEvidence>): MemoryAnalysisChangeEvidence {
  return {
    evidenceId: typeof evidence.evidenceId === "string" ? evidence.evidenceId : "",
    quote: typeof evidence.quote === "string" ? evidence.quote : "",
    correctness: typeof evidence.correctness === "string" ? evidence.correctness : "",
    edited: evidence.edited === true,
    ...(
      Object.prototype.hasOwnProperty.call(evidence, "review")
        ? { review: toRecordOrNull(evidence.review) }
        : {}
    ),
  };
}

function toCamelCaseRecord(value: unknown): Record<string, unknown> | null {
  const converted = camelizeKeys(value);
  return toRecordOrNull(converted);
}

function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(camelizeKeys);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      snakeToCamel(key),
      camelizeKeys(nestedValue),
    ]),
  );
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase());
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function analyzeMemorySourceQueryKey(
  spaceId: string,
  input: AnalyzeMemorySourceInput,
) {
  return ["space", spaceId, "memoryAnalysisSource", input.createdAfter, input.createdBefore] as const;
}

export function latestCompletedMemoryAnalysisQueryKey(spaceId: string) {
  return ["space", spaceId, "memoryAnalysisLatestCompleted"] as const;
}

function isMemorySignalDimension(value: unknown): value is MemorySignalDimension {
  return value === "long_term_goal"
    || value === "focus_area"
    || value === "emotion"
    || value === "preference_signal"
    || value === "growth_signal";
}

function isMemoryAnalysisReportStatus(value: unknown): value is MemoryAnalysisReportStatus {
  return value === "queued"
    || value === "running"
    || value === "success"
    || value === "fail";
}

function isMemoryAnalysisReportStage(value: unknown): value is MemoryAnalysisReportStage {
  return value === "queued"
    || value === "fetch_source"
    || value === "period_summary"
    || value === "aggregation"
    || value === "save_result"
    || value === "complete"
    || value === "failed";
}

function isCompletedMemoryAnalysisReportStatus(status: MemoryAnalysisReportStatus): boolean {
  return status === "success" || status === "fail";
}

function isDisplayableCompletedReport(report: MemoryAnalysisReport): boolean {
  return report.render_status === "success"
    && report.report_stage === "complete"
    && report.report_content.trim().length > 0;
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

export function useAllMemoryAnalysisReports(spaceId: string) {
  return useQuery({
    queryKey: ["space", spaceId, "memoryAnalysisReports", "all"],
    queryFn: () => requestMemoryAnalysisReports(spaceId),
    enabled: !!spaceId,
    refetchInterval: (query) => {
      const reports = query.state.data?.reports ?? [];
      return reports.some((report) => !isCompletedMemoryAnalysisReportStatus(report.render_status)) ? 2 * 1000 : false;
    },
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

export function useAnalyzeMemorySource(
  spaceId: string,
  input: AnalyzeMemorySourceInput,
  options: AnalyzeMemorySourceQueryOptions = {},
) {
  return useQuery({
    queryKey: analyzeMemorySourceQueryKey(spaceId, input),
    queryFn: ({ signal }) => requestAnalyzeMemorySource(spaceId, input, signal),
    enabled: (options.enabled ?? true) && !!spaceId && !!input.createdAfter && !!input.createdBefore,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

export function useLatestCompletedMemoryAnalysis(
  spaceId: string,
  options: AnalyzeMemorySourceQueryOptions = {},
) {
  return useQuery({
    queryKey: latestCompletedMemoryAnalysisQueryKey(spaceId),
    queryFn: () => requestLatestCompletedMemoryAnalysis(spaceId),
    enabled: (options.enabled ?? true) && !!spaceId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useGenerateMemoryAnalysisReport(spaceId: string) {
  return useMutation({
    mutationFn: (input: GenerateMemoryAnalysisReportInput) =>
      requestGenerateMemoryAnalysisReport(spaceId, input),
  });
}

export function useEditSessionMessage(spaceId: string) {
  return useMutation({
    mutationFn: (input: EditSessionMessageInput) => requestEditSessionMessage(spaceId, input),
  });
}

export function useMarkSessionMessage(spaceId: string) {
  return useMutation({
    mutationFn: (input: MarkSessionMessageInput) => requestMarkSessionMessage(spaceId, input),
  });
}
