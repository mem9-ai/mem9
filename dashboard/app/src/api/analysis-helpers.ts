import type {
  AggregateSnapshot,
  AnalysisCategory,
  AnalysisJobSnapshotResponse,
  AnalysisJobUpdatesResponse,
  AnalysisMemoryInput,
  BatchSummary,
  CreateAnalysisJobRequest,
  CreateAnalysisJobResponse,
  JobStatus,
} from "@/types/analysis";
import type { Memory } from "@/types/memory";
import type { TimeRangeParams } from "@/types/time-range";

export const TERMINAL_JOB_STATUSES: JobStatus[] = [
  "COMPLETED",
  "PARTIAL_FAILED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
];

export const DEFAULT_TAXONOMY_VERSION = "v2";

const EMPTY_AGGREGATE: AggregateSnapshot = {
  categoryCounts: {
    identity: 0,
    emotion: 0,
    preference: 0,
    experience: 0,
    activity: 0,
  },
  tagCounts: {},
  topicCounts: {},
  summarySnapshot: [],
  resultVersion: 0,
};

export function getAnalysisBatchSize(): number {
  const raw = Number(import.meta.env.VITE_ANALYSIS_BATCH_SIZE ?? 100);
  return Number.isFinite(raw) && raw > 0 ? raw : 100;
}

export function getDefaultPollMs(): number {
  const raw = Number(import.meta.env.VITE_ANALYSIS_POLL_MS ?? 1500);
  return Number.isFinite(raw) && raw > 0 ? raw : 1500;
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export function toAnalysisMemoryInput(memory: Memory): AnalysisMemoryInput {
  return {
    id: memory.id,
    content: memory.content,
    createdAt: memory.created_at,
    metadata: (memory.metadata ?? {}) as Record<string, unknown>,
  };
}

export function chunkAnalysisMemories<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function dateRangeFromMemories(
  memories: Memory[],
  params?: TimeRangeParams,
): { start: string; end: string } {
  const timestamps = memories.flatMap((memory) =>
    [memory.created_at, memory.updated_at].filter(Boolean),
  );
  const sorted = timestamps
    .map((value) => new Date(value).toISOString())
    .sort((left, right) => left.localeCompare(right));

  return {
    start: params?.updated_from ?? sorted[0] ?? new Date().toISOString(),
    end:
      params?.updated_to ??
      sorted[sorted.length - 1] ??
      new Date().toISOString(),
  };
}

export function buildCreateJobRequest(
  memories: Memory[],
  batchSize: number,
  params?: TimeRangeParams,
): CreateAnalysisJobRequest {
  const dateRange = dateRangeFromMemories(memories, params);
  const expectedTotalBatches = Math.max(
    1,
    Math.ceil(memories.length / batchSize),
  );

  return {
    dateRange,
    expectedTotalMemories: memories.length,
    expectedTotalBatches,
    batchSize,
    options: {
      lang: "zh-CN",
      taxonomyVersion: DEFAULT_TAXONOMY_VERSION,
      llmEnabled: true,
      includeItems: true,
      includeSummary: true,
    },
  };
}

function makeBatchSummaries(
  batchSize: number,
  memories: Memory[],
): BatchSummary[] {
  return chunkAnalysisMemories(memories, batchSize).map((batch, offset) => ({
    batchIndex: offset + 1,
    status: "EXPECTED",
    memoryCount: batch.length,
    processedMemories: 0,
    topCategories: [],
    topTags: [],
  }));
}

export function createPendingSnapshot(
  response: CreateAnalysisJobResponse,
  input: CreateAnalysisJobRequest,
  memories: Memory[],
): AnalysisJobSnapshotResponse {
  return {
    jobId: response.jobId,
    status: response.status,
    expectedTotalMemories: input.expectedTotalMemories,
    expectedTotalBatches: input.expectedTotalBatches,
    batchSize: input.batchSize,
    pipelineVersion: "v1",
    taxonomyVersion: input.options.taxonomyVersion,
    llmEnabled: input.options.llmEnabled,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    progress: {
      expectedTotalBatches: input.expectedTotalBatches,
      uploadedBatches: 0,
      completedBatches: 0,
      failedBatches: 0,
      processedMemories: 0,
      resultVersion: 0,
    },
    aggregate: EMPTY_AGGREGATE,
    aggregateCards: [],
    topTags: [],
    topTopics: [],
    batchSummaries: makeBatchSummaries(input.batchSize, memories),
  };
}

export function applyUploadedBatch(
  snapshot: AnalysisJobSnapshotResponse,
  batchIndex: number,
): AnalysisJobSnapshotResponse {
  const batchSummaries = snapshot.batchSummaries.map((summary) =>
    summary.batchIndex === batchIndex
      ? {
          ...summary,
          status: "QUEUED" as const,
        }
      : summary,
  );

  return {
    ...snapshot,
    batchSummaries,
    progress: {
      ...snapshot.progress,
      uploadedBatches: Math.max(snapshot.progress.uploadedBatches, batchIndex),
    },
  };
}

function toAggregateCards(
  aggregate: AggregateSnapshot,
  processedMemories: number,
) {
  return Object.entries(aggregate.categoryCounts)
    .map(([category, count]) => ({
      category: category as AnalysisCategory,
      count,
      confidence:
        processedMemories === 0
          ? 0
          : Number((count / processedMemories).toFixed(2)),
    }))
    .sort((left, right) => right.count - left.count);
}

function mergeBatchSummaries(
  base: BatchSummary[],
  completed: BatchSummary[],
): BatchSummary[] {
  const merged = new Map<number, BatchSummary>();
  for (const summary of base) {
    merged.set(summary.batchIndex, summary);
  }
  for (const summary of completed) {
    merged.set(summary.batchIndex, summary);
  }
  return [...merged.values()].sort((left, right) => left.batchIndex - right.batchIndex);
}

export function mergeSnapshotWithUpdates(
  snapshot: AnalysisJobSnapshotResponse,
  updates: AnalysisJobUpdatesResponse,
): AnalysisJobSnapshotResponse {
  return {
    ...snapshot,
    progress: updates.progress,
    aggregate: updates.aggregate,
    aggregateCards: toAggregateCards(
      updates.aggregate,
      updates.progress.processedMemories,
    ),
    topTags: Object.entries(updates.aggregate.tagCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([tag]) => tag),
    topTopics: Object.entries(updates.aggregate.topicCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([topic]) => topic),
    batchSummaries: mergeBatchSummaries(
      snapshot.batchSummaries,
      updates.completedBatchResults,
    ),
  };
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function createMemoryFingerprint(
  memories: Memory[],
): Promise<string> {
  const canonical = memories
    .map((memory) => ({
      id: memory.id,
      updated_at: memory.updated_at,
      version: memory.version,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return sha256Hex(JSON.stringify(canonical));
}

export async function createBatchHash(
  memories: AnalysisMemoryInput[],
): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      memoryCount: memories.length,
      memories: memories.map((memory) => ({
        id: memory.id,
        content: memory.content,
        createdAt: memory.createdAt,
        metadata: memory.metadata,
      })),
    }),
  );
}

export function isDegradedAnalysisError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("apikeysubject") ||
    message.includes("invalid `prisma.") ||
    message.includes("does not exist in the current database") ||
    message.includes("internal_server_error") ||
    message.includes("analysis api error 5")
  );
}
