import type {
  AnalysisApiErrorPayload,
  AnalysisJobSnapshotResponse,
  AnalysisJobUpdatesResponse,
  CreateDeepAnalysisReportRequest,
  CreateDeepAnalysisReportResponse,
  DeleteDeepAnalysisDuplicatesResponse,
  DeleteDeepAnalysisReportResponse,
  CreateAnalysisJobRequest,
  CreateAnalysisJobResponse,
  DeepAnalysisReportDetail,
  DeepAnalysisReportListResponse,
  FinalizeAnalysisJobResponse,
  TaxonomyResponse,
  UploadBatchRequest,
  UploadBatchResponse,
  UserProfileResponse,
} from "@/types/analysis";

const ANALYSIS_API_BASE =
  import.meta.env.VITE_ANALYSIS_API_BASE || "/your-memory/analysis-api";
const MAX_MINUTE_RATE_LIMIT_RETRIES = 20;
const RATE_LIMIT_RETRY_PADDING_MS = 250;

export class AnalysisApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;
  details?: Record<string, unknown>;

  public constructor(
    message: string,
    status: number,
    payload?: Partial<AnalysisApiErrorPayload>,
  ) {
    super(message);
    this.name = "AnalysisApiError";
    this.status = status;
    this.code = payload?.code;
    this.requestId = payload?.requestId;
    this.details = payload?.details;
  }
}

async function readJson<T>(response: Response): Promise<T | null> {
  if (response.status === 204) return null;
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function request<T>(
  spaceId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await requestResponse(spaceId, path, init);
  const body = await readJson<T>(response);
  if (body === null) {
    throw new AnalysisApiError(
      "Analysis API returned an empty or invalid JSON response",
      response.status,
    );
  }
  return body as T;
}

async function requestResponse(
  spaceId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-mem9-api-key", spaceId.trim());

  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${ANALYSIS_API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = await readJson<AnalysisApiErrorPayload>(response);
    throw new AnalysisApiError(
      payload?.message || `Analysis API error ${response.status}`,
      response.status,
      payload ?? undefined,
    );
  }

  return response;
}

function getMinuteRateLimitRetryDelayMs(error: unknown): number | null {
  if (
    !(error instanceof AnalysisApiError) ||
    error.status !== 429 ||
    error.code !== "RATE_LIMIT_EXCEEDED" ||
    error.details?.limit === "day"
  ) {
    return null;
  }

  const retryAfterSeconds = Number(error.details?.retryAfterSeconds);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1_000 + RATE_LIMIT_RETRY_PADDING_MS;
  }

  const now = Date.now();
  return 60_000 - (now % 60_000) + RATE_LIMIT_RETRY_PADDING_MS;
}

async function wait(ms: number): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function withMinuteRateLimitRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let rateLimitRetries = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      const retryDelayMs = getMinuteRateLimitRetryDelayMs(error);
      if (
        retryDelayMs === null ||
        rateLimitRetries >= MAX_MINUTE_RATE_LIMIT_RETRIES
      ) {
        throw error;
      }

      rateLimitRetries += 1;
      await wait(retryDelayMs);
    }
  }
}

export const analysisApi = {
  async createJob(
    spaceId: string,
    input: CreateAnalysisJobRequest,
  ): Promise<CreateAnalysisJobResponse> {
    return withMinuteRateLimitRetry(() =>
      request(spaceId, "/v1/analysis-jobs", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  },

  async createJobFromSource(
    spaceId: string,
    input: CreateAnalysisJobRequest,
  ): Promise<CreateAnalysisJobResponse> {
    return withMinuteRateLimitRetry(() =>
      request(spaceId, "/v1/analysis-jobs/from-source", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  },

  async uploadBatch(
    spaceId: string,
    jobId: string,
    batchIndex: number,
    input: UploadBatchRequest,
  ): Promise<UploadBatchResponse> {
    return withMinuteRateLimitRetry(() =>
      request(
        spaceId,
        `/v1/analysis-jobs/${jobId}/batches/${batchIndex}`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      ),
    );
  },

  async finalizeJob(
    spaceId: string,
    jobId: string,
  ): Promise<FinalizeAnalysisJobResponse> {
    return withMinuteRateLimitRetry(() =>
      request(spaceId, `/v1/analysis-jobs/${jobId}/finalize`, {
        method: "POST",
      }),
    );
  },

  async getSnapshot(
    spaceId: string,
    jobId: string,
  ): Promise<AnalysisJobSnapshotResponse> {
    return withMinuteRateLimitRetry(() =>
      request(spaceId, `/v1/analysis-jobs/${jobId}`),
    );
  },

  getUpdates(
    spaceId: string,
    jobId: string,
    cursor: number,
  ): Promise<AnalysisJobUpdatesResponse> {
    const params = new URLSearchParams({ cursor: String(cursor) });
    return request(spaceId, `/v1/analysis-jobs/${jobId}/updates?${params}`);
  },

  getTaxonomy(spaceId: string, version?: string): Promise<TaxonomyResponse> {
    const params = new URLSearchParams();
    if (version) params.set("version", version);
    const suffix = params.size > 0 ? `?${params}` : "";
    return request(spaceId, `/v1/taxonomy${suffix}`);
  },

  getUserProfile(spaceId: string): Promise<UserProfileResponse> {
    return request(spaceId, "/v1/user-profile");
  },

  createDeepAnalysisReport(
    spaceId: string,
    input: CreateDeepAnalysisReportRequest,
  ): Promise<CreateDeepAnalysisReportResponse> {
    return request(spaceId, "/v1/deep-analysis/reports", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  listDeepAnalysisReports(
    spaceId: string,
    limit = 20,
    offset = 0,
  ): Promise<DeepAnalysisReportListResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    return request(spaceId, `/v1/deep-analysis/reports?${params.toString()}`);
  },

  getDeepAnalysisReport(
    spaceId: string,
    reportId: string,
  ): Promise<DeepAnalysisReportDetail> {
    return request(spaceId, `/v1/deep-analysis/reports/${reportId}`);
  },

  async downloadDeepAnalysisDuplicatesCsv(
    spaceId: string,
    reportId: string,
  ): Promise<Blob> {
    const response = await requestResponse(
      spaceId,
      `/v1/deep-analysis/reports/${reportId}/duplicates.csv`,
    );
    return response.blob();
  },

  deleteDeepAnalysisDuplicates(
    spaceId: string,
    reportId: string,
  ): Promise<DeleteDeepAnalysisDuplicatesResponse> {
    return request(spaceId, `/v1/deep-analysis/reports/${reportId}/delete-duplicates`, {
      method: "POST",
    });
  },

  deleteDeepAnalysisReport(
    spaceId: string,
    reportId: string,
  ): Promise<DeleteDeepAnalysisReportResponse> {
    return request(spaceId, `/v1/deep-analysis/reports/${reportId}`, {
      method: "DELETE",
    });
  },
};
