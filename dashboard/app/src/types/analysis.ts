export type AnalysisCategory = string;

export const JOB_STATUSES = [
  "CREATED",
  "UPLOADING",
  "PROCESSING",
  "PARTIAL",
  "COMPLETED",
  "PARTIAL_FAILED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const BATCH_STATUSES = [
  "EXPECTED",
  "UPLOADED",
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "RETRYING",
  "DLQ",
] as const;

export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const ANALYSIS_EVENT_TYPES = [
  "job_created",
  "batch_uploaded",
  "batch_started",
  "batch_completed",
  "batch_failed",
  "job_finalized",
  "job_cancelled",
] as const;

export type AnalysisEventType = (typeof ANALYSIS_EVENT_TYPES)[number];

export interface DateRange {
  start: string;
  end: string;
}

export interface AnalysisOptions {
  lang: string;
  taxonomyVersion: string;
  llmEnabled: boolean;
  includeItems: boolean;
  includeSummary: boolean;
}

export interface CreateAnalysisJobRequest {
  dateRange: DateRange;
  expectedTotalMemories: number;
  expectedTotalBatches: number;
  batchSize: number;
  options: AnalysisOptions;
}

export interface CreateAnalysisJobResponse {
  jobId: string;
  status: JobStatus;
  expectedTotalBatches: number;
  uploadConcurrency: number;
  pollAfterMs: number;
}

export interface AnalysisMemoryInput {
  id: string;
  content: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface UploadBatchRequest {
  batchHash?: string;
  memoryCount: number;
  memories: AnalysisMemoryInput[];
}

export interface UploadBatchResponse {
  jobId: string;
  batchIndex: number;
  status: BatchStatus;
  payloadObjectKey: string;
  payloadHash: string;
  queuedAt: string;
}

export interface AnalysisCategoryCard {
  category: AnalysisCategory;
  count: number;
  confidence: number;
}

export interface AnalysisFacetStat {
  value: string;
  count: number;
}

export interface MemoryAnalysisMatch {
  memoryId: string;
  categories: AnalysisCategory[];
  categoryScores: Partial<Record<AnalysisCategory, number>>;
}

export interface BatchSummary {
  batchIndex: number;
  status: BatchStatus;
  memoryCount: number;
  processedMemories: number;
  topCategories: AnalysisCategoryCard[];
  topTags: string[];
  startedAt?: string;
  completedAt?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface JobProgressSnapshot {
  expectedTotalBatches: number;
  uploadedBatches: number;
  completedBatches: number;
  failedBatches: number;
  processedMemories: number;
  resultVersion: number;
}

export interface AggregateSnapshot {
  categoryCounts: Record<AnalysisCategory, number>;
  tagCounts: Record<string, number>;
  topicCounts: Record<string, number>;
  summarySnapshot: string[];
  resultVersion: number;
}

export interface AnalysisJobSnapshotResponse {
  jobId: string;
  status: JobStatus;
  expectedTotalMemories: number;
  expectedTotalBatches: number;
  batchSize: number;
  pipelineVersion: string;
  taxonomyVersion: string;
  llmEnabled: boolean;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  expiresAt?: string | null;
  progress: JobProgressSnapshot;
  aggregate: AggregateSnapshot;
  aggregateCards: AnalysisCategoryCard[];
  topTagStats?: AnalysisFacetStat[];
  topTopicStats?: AnalysisFacetStat[];
  topTags: string[];
  topTopics: string[];
  batchSummaries: BatchSummary[];
}

export interface AnalysisEvent {
  version: number;
  type: AnalysisEventType;
  timestamp: string;
  jobId: string;
  batchIndex?: number;
  status?: JobStatus | BatchStatus;
  message: string;
  delta?: {
    processedMemories?: number;
    completedBatches?: number;
    failedBatches?: number;
  };
}

export interface AnalysisJobUpdatesResponse {
  cursor: number;
  nextCursor: number;
  events: AnalysisEvent[];
  completedBatchResults: BatchSummary[];
  aggregate: AggregateSnapshot;
  progress: JobProgressSnapshot;
}

export interface FinalizeAnalysisJobResponse {
  jobId: string;
  status: JobStatus;
  uploadedBatches: number;
  expectedTotalBatches: number;
}

export interface TaxonomyRuleDefinition {
  id: string;
  version: string;
  category: AnalysisCategory;
  label: string;
  lang: string;
  matchType: "keyword" | "regex" | "phrase";
  pattern: string;
  weight: number;
  enabled: boolean;
}

export interface TaxonomyResponse {
  version: string;
  updatedAt: string;
  categories: AnalysisCategory[];
  rules: TaxonomyRuleDefinition[];
}

export interface AnalysisApiErrorPayload {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
}

export type AnalysisPhase =
  | "idle"
  | "creating"
  | "uploading"
  | "processing"
  | "completed"
  | "degraded"
  | "failed";

export interface SpaceAnalysisState {
  phase: AnalysisPhase;
  snapshot: AnalysisJobSnapshotResponse | null;
  events: AnalysisEvent[];
  cursor: number;
  error: string | null;
  warning: string | null;
  jobId: string | null;
  fingerprint: string | null;
  pollAfterMs: number;
  isRetrying: boolean;
}
