import type {
  AnalysisApiErrorPayload,
  AnalysisJobSnapshotResponse,
  AnalysisJobUpdatesResponse,
  CreateAnalysisJobRequest,
  CreateAnalysisJobResponse,
  FinalizeAnalysisJobResponse,
  TaxonomyResponse,
  UploadBatchRequest,
  UploadBatchResponse,
} from "@/types/analysis";

const ANALYSIS_API_BASE =
  import.meta.env.VITE_ANALYSIS_API_BASE || "/your-memory/analysis-api";

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

  const body = await readJson<T>(response);
  if (body === null) {
    throw new AnalysisApiError(
      "Analysis API returned an empty or invalid JSON response",
      response.status,
    );
  }
  return body as T;
}

export const analysisApi = {
  createJob(
    spaceId: string,
    input: CreateAnalysisJobRequest,
  ): Promise<CreateAnalysisJobResponse> {
    return request(spaceId, "/v1/analysis-jobs", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  uploadBatch(
    spaceId: string,
    jobId: string,
    batchIndex: number,
    input: UploadBatchRequest,
  ): Promise<UploadBatchResponse> {
    return request(spaceId, `/v1/analysis-jobs/${jobId}/batches/${batchIndex}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  finalizeJob(
    spaceId: string,
    jobId: string,
  ): Promise<FinalizeAnalysisJobResponse> {
    return request(spaceId, `/v1/analysis-jobs/${jobId}/finalize`, {
      method: "POST",
    });
  },

  getSnapshot(
    spaceId: string,
    jobId: string,
  ): Promise<AnalysisJobSnapshotResponse> {
    return request(spaceId, `/v1/analysis-jobs/${jobId}`);
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
};
