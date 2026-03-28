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
  origin?: "raw" | "derived" | "mixed";
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

export const DEEP_ANALYSIS_REPORT_STATUSES = [
  "QUEUED",
  "PREPARING",
  "ANALYZING",
  "SYNTHESIZING",
  "COMPLETED",
  "FAILED",
] as const;

export type DeepAnalysisReportStatus =
  (typeof DEEP_ANALYSIS_REPORT_STATUSES)[number];

export const DEEP_ANALYSIS_REPORT_STAGES = [
  "FETCH_SOURCE",
  "PREPROCESS",
  "CHUNK_ANALYSIS",
  "GLOBAL_SYNTHESIS",
  "VALIDATE",
  "COMPLETE",
] as const;

export type DeepAnalysisReportStage =
  (typeof DEEP_ANALYSIS_REPORT_STAGES)[number];

export interface DeepAnalysisReportPreview {
  generatedAt: string;
  summary: string;
  topThemes: string[];
  keyRecommendations: string[];
}

export interface DeepAnalysisThemeItem {
  name: string;
  count: number;
  description: string;
}

export interface DeepAnalysisEntityGroup {
  label: string;
  count: number;
  evidenceMemoryIds: string[];
}

export interface DeepAnalysisEvidenceHighlight {
  title: string;
  detail: string;
  memoryIds: string[];
}

export interface DeepAnalysisRelationship {
  source: string;
  relation: string;
  target: string;
  confidence: number;
  evidenceMemoryIds: string[];
  evidenceExcerpts: string[];
}

export interface DeepAnalysisDiscoveryCard {
  id: string;
  kind: "focus_area" | "collaborator" | "routine" | "decision" | "hygiene" | "opportunity";
  title: string;
  summary: string;
  confidence: number;
  evidenceMemoryIds: string[];
}

export interface DeepAnalysisReportDocument {
  overview: {
    memoryCount: number;
    deduplicatedMemoryCount: number;
    generatedAt: string;
    lang: string;
    timeSpan: {
      start: string | null;
      end: string | null;
    };
  };
  persona: {
    summary: string;
    workingStyle?: string[];
    goals?: string[];
    preferences?: string[];
    constraints?: string[];
    decisionSignals?: string[];
    notableRoutines?: string[];
    contradictionsOrTensions?: string[];
    evidenceHighlights?: DeepAnalysisEvidenceHighlight[];
    habits?: string[];
  };
  themeLandscape: {
    highlights: DeepAnalysisThemeItem[];
  };
  entities: {
    people: DeepAnalysisEntityGroup[];
    teams: DeepAnalysisEntityGroup[];
    projects: DeepAnalysisEntityGroup[];
    tools: DeepAnalysisEntityGroup[];
    places: DeepAnalysisEntityGroup[];
  };
  relationships: DeepAnalysisRelationship[];
  discoveries?: DeepAnalysisDiscoveryCard[];
  quality: {
    duplicateRatio: number;
    duplicateMemoryCount?: number;
    noisyMemoryCount: number;
    duplicateClusters: Array<{
      canonicalMemoryId: string;
      duplicateMemoryIds: string[];
    }>;
    lowQualityExamples: Array<{
      memoryId: string;
      reason: string;
    }>;
    coverageGaps: string[];
  };
  recommendations: string[];
  productSignals: {
    candidateNodes: Array<{
      label: string;
      kind: string;
      count: number;
    }>;
    candidateEdges: Array<{
      source: string;
      relation: string;
      target: string;
      confidence: number;
    }>;
    searchSeeds: string[];
  };
}

export interface DeepAnalysisDuplicateExportRow {
  duplicateMemoryId: string;
  clusterIndex: number;
  canonicalPreview: string;
  duplicatePreview: string;
  reason: string;
}

export interface DeleteDeepAnalysisDuplicatesResponse {
  reportId: string;
  deletedCount: number;
  deletedMemoryIds: string[];
  failedMemoryIds: string[];
}

export interface DeleteDeepAnalysisReportResponse {
  reportId: string;
}

export interface DeepAnalysisReportListItem {
  id: string;
  status: DeepAnalysisReportStatus;
  stage: DeepAnalysisReportStage;
  progressPercent: number;
  lang: string;
  timezone: string;
  memoryCount: number;
  requestedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  preview: DeepAnalysisReportPreview | null;
}

export interface DeepAnalysisReportDetail extends DeepAnalysisReportListItem {
  report: DeepAnalysisReportDocument | null;
}

export interface CreateDeepAnalysisReportRequest {
  lang: string;
  timezone: string;
}

export interface CreateDeepAnalysisReportResponse {
  reportId: string;
  status: DeepAnalysisReportStatus;
  stage: DeepAnalysisReportStage;
  progressPercent: number;
  requestedAt: string;
  memoryCount: number;
}

export interface DeepAnalysisReportListResponse {
  reports: DeepAnalysisReportListItem[];
  total: number;
  limit: number;
  offset: number;
}
