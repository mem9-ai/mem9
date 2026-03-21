import type {
  AnalysisCategory,
  AnalysisJobSnapshotResponse,
  MemoryAnalysisMatch,
} from "@/types/analysis";
import type { Memory } from "@/types/memory";
import type { TimeRangePreset } from "@/types/time-range";

const DB_NAME = "mem9-dashboard-cache";
const DB_VERSION = 1;

const MEMORIES_STORE = "memories";
const ANALYSIS_RESULTS_STORE = "analysis_results";
const ANALYSIS_MATCHES_STORE = "analysis_matches";
const SYNC_STATE_STORE = "sync_state";

interface CachedMemoryRecord {
  key: string;
  spaceId: string;
  memoryId: string;
  updatedAt: string;
  version: number;
  memory: Memory;
}

interface CachedAnalysisResultRecord {
  key: string;
  spaceId: string;
  range: TimeRangePreset;
  fingerprint: string;
  jobId: string;
  updatedAt: string;
  taxonomyVersion: string;
  snapshot: AnalysisJobSnapshotResponse | null;
}

interface CachedAnalysisMatchRecord {
  key: string;
  spaceId: string;
  range: TimeRangePreset;
  memoryId: string;
  categories: AnalysisCategory[];
  categoryScores: Partial<Record<AnalysisCategory, number>>;
  updatedAt: string;
}

export interface SyncStateRecord {
  spaceId: string;
  hasFullCache: boolean;
  lastSyncedAt: string | null;
  incrementalCursor: string | null;
  incrementalTodo: string | null;
}

export interface CachedAnalysisResultEntry {
  fingerprint: string;
  jobId: string;
  updatedAt: string;
  taxonomyVersion: string;
  snapshot: AnalysisJobSnapshotResponse | null;
}

const memoryFallback = new Map<string, CachedMemoryRecord>();
const analysisResultsFallback = new Map<string, CachedAnalysisResultRecord>();
const analysisMatchesFallback = new Map<string, CachedAnalysisMatchRecord>();
const syncStateFallback = new Map<string, SyncStateRecord>();

function createMemoryKey(spaceId: string, memoryId: string): string {
  return `${spaceId}:${memoryId}`;
}

function createRangeKey(spaceId: string, range: TimeRangePreset): string {
  return `${spaceId}:${range}`;
}

function createMatchKey(
  spaceId: string,
  range: TimeRangePreset,
  memoryId: string,
): string {
  return `${spaceId}:${range}:${memoryId}`;
}

function supportsIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

let openPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (!supportsIndexedDb()) {
    return Promise.resolve(null);
  }
  if (openPromise) return openPromise;

  openPromise = new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(MEMORIES_STORE)) {
        const store = db.createObjectStore(MEMORIES_STORE, { keyPath: "key" });
        store.createIndex("bySpace", "spaceId", { unique: false });
      }

      if (!db.objectStoreNames.contains(ANALYSIS_RESULTS_STORE)) {
        const store = db.createObjectStore(ANALYSIS_RESULTS_STORE, {
          keyPath: "key",
        });
        store.createIndex("bySpace", "spaceId", { unique: false });
      }

      if (!db.objectStoreNames.contains(ANALYSIS_MATCHES_STORE)) {
        const store = db.createObjectStore(ANALYSIS_MATCHES_STORE, {
          keyPath: "key",
        });
        store.createIndex("bySpaceRange", ["spaceId", "range"], {
          unique: false,
        });
      }

      if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) {
        db.createObjectStore(SYNC_STATE_STORE, { keyPath: "spaceId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open IndexedDB"));
  }).catch(() => null);

  return openPromise ?? Promise.resolve(null);
}

async function putRecords<T extends { key?: string; spaceId?: string }>(
  storeName: string,
  records: T[],
): Promise<void> {
  if (records.length === 0) return;
  const db = await openDatabase();
  if (!db) return;

  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  for (const record of records) {
    store.put(record);
  }
  await transactionDone(transaction);
}

async function deleteRecords(storeName: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDatabase();
  if (!db) return;

  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  for (const key of keys) {
    store.delete(key);
  }
  await transactionDone(transaction);
}

async function getRecord<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return null;

  const transaction = db.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  const result = await requestToPromise(store.get(key));
  await transactionDone(transaction);
  return (result as T | undefined) ?? null;
}

async function getAllByIndex<T>(
  storeName: string,
  indexName: string,
  query: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  const db = await openDatabase();
  if (!db) return [];

  const transaction = db.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  const index = store.index(indexName);
  const result = await requestToPromise(index.getAll(query));
  await transactionDone(transaction);
  return result as T[];
}

function toMatchRecord(
  spaceId: string,
  range: TimeRangePreset,
  match: MemoryAnalysisMatch,
): CachedAnalysisMatchRecord {
  return {
    key: createMatchKey(spaceId, range, match.memoryId),
    spaceId,
    range,
    memoryId: match.memoryId,
    categories: [...match.categories],
    categoryScores: { ...match.categoryScores },
    updatedAt: new Date().toISOString(),
  };
}

function fromMatchRecord(record: CachedAnalysisMatchRecord): MemoryAnalysisMatch {
  return {
    memoryId: record.memoryId,
    categories: [...record.categories],
    categoryScores: { ...record.categoryScores },
  };
}

export async function readCachedMemories(spaceId: string): Promise<Memory[]> {
  if (!supportsIndexedDb()) {
    return [...memoryFallback.values()]
      .filter((record) => record.spaceId === spaceId)
      .map((record) => record.memory)
      .sort((left, right) =>
        right.created_at.localeCompare(left.created_at),
      );
  }

  const records = await getAllByIndex<CachedMemoryRecord>(
    MEMORIES_STORE,
    "bySpace",
    spaceId,
  );
  return records
    .map((record) => record.memory)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export async function upsertCachedMemories(
  spaceId: string,
  memories: Memory[],
): Promise<void> {
  const records = memories.map<CachedMemoryRecord>((memory) => ({
    key: createMemoryKey(spaceId, memory.id),
    spaceId,
    memoryId: memory.id,
    updatedAt: memory.updated_at,
    version: memory.version,
    memory,
  }));

  if (!supportsIndexedDb()) {
    for (const record of records) {
      memoryFallback.set(record.key, record);
    }
    return;
  }

  await putRecords(MEMORIES_STORE, records);
}

export async function removeCachedMemory(
  spaceId: string,
  memoryId: string,
): Promise<void> {
  const key = createMemoryKey(spaceId, memoryId);
  if (!supportsIndexedDb()) {
    memoryFallback.delete(key);
    return;
  }
  await deleteRecords(MEMORIES_STORE, [key]);
}

export async function readSyncState(
  spaceId: string,
): Promise<SyncStateRecord | null> {
  if (!supportsIndexedDb()) {
    return syncStateFallback.get(spaceId) ?? null;
  }

  return getRecord<SyncStateRecord>(SYNC_STATE_STORE, spaceId);
}

export async function patchSyncState(
  spaceId: string,
  patch: Partial<SyncStateRecord>,
): Promise<SyncStateRecord> {
  const current =
    (await readSyncState(spaceId)) ?? {
      spaceId,
      hasFullCache: false,
      lastSyncedAt: null,
      incrementalCursor: null,
      incrementalTodo:
        "TODO: backend incremental sync contract is not available yet.",
    };

  const next: SyncStateRecord = {
    ...current,
    ...patch,
    spaceId,
  };

  if (!supportsIndexedDb()) {
    syncStateFallback.set(spaceId, next);
    return next;
  }

  const db = await openDatabase();
  if (!db) {
    syncStateFallback.set(spaceId, next);
    return next;
  }

  const transaction = db.transaction(SYNC_STATE_STORE, "readwrite");
  transaction.objectStore(SYNC_STATE_STORE).put(next);
  await transactionDone(transaction);
  return next;
}

export async function readCachedAnalysisResult(
  spaceId: string,
  range: TimeRangePreset,
): Promise<CachedAnalysisResultEntry | null> {
  const key = createRangeKey(spaceId, range);
  if (!supportsIndexedDb()) {
    const record = analysisResultsFallback.get(key);
    if (!record) return null;
    return {
      fingerprint: record.fingerprint,
      jobId: record.jobId,
      updatedAt: record.updatedAt,
      taxonomyVersion: record.taxonomyVersion ?? record.snapshot?.taxonomyVersion ?? "v1",
      snapshot: record.snapshot,
    };
  }

  const record = await getRecord<CachedAnalysisResultRecord>(
    ANALYSIS_RESULTS_STORE,
    key,
  );
  if (!record) return null;
  return {
    fingerprint: record.fingerprint,
    jobId: record.jobId,
    updatedAt: record.updatedAt,
    taxonomyVersion: record.taxonomyVersion ?? record.snapshot?.taxonomyVersion ?? "v1",
    snapshot: record.snapshot,
  };
}

export async function writeCachedAnalysisResult(
  spaceId: string,
  range: TimeRangePreset,
  entry: CachedAnalysisResultEntry,
): Promise<void> {
  const record: CachedAnalysisResultRecord = {
    key: createRangeKey(spaceId, range),
    spaceId,
    range,
    fingerprint: entry.fingerprint,
    jobId: entry.jobId,
    updatedAt: entry.updatedAt,
    taxonomyVersion: entry.taxonomyVersion,
    snapshot: entry.snapshot,
  };

  if (!supportsIndexedDb()) {
    analysisResultsFallback.set(record.key, record);
    return;
  }

  await putRecords(ANALYSIS_RESULTS_STORE, [record]);
}

export async function clearCachedAnalysisResult(
  spaceId: string,
  range: TimeRangePreset,
): Promise<void> {
  const key = createRangeKey(spaceId, range);
  if (!supportsIndexedDb()) {
    analysisResultsFallback.delete(key);
    return;
  }
  await deleteRecords(ANALYSIS_RESULTS_STORE, [key]);
}

export async function readCachedAnalysisMatches(
  spaceId: string,
  range: TimeRangePreset,
): Promise<MemoryAnalysisMatch[]> {
  if (!supportsIndexedDb()) {
    return [...analysisMatchesFallback.values()]
      .filter((record) => record.spaceId === spaceId && record.range === range)
      .map(fromMatchRecord);
  }

  const records = await getAllByIndex<CachedAnalysisMatchRecord>(
    ANALYSIS_MATCHES_STORE,
    "bySpaceRange",
    IDBKeyRange.only([spaceId, range]),
  );
  return records.map(fromMatchRecord);
}

export async function writeCachedAnalysisMatches(
  spaceId: string,
  range: TimeRangePreset,
  matches: MemoryAnalysisMatch[],
): Promise<void> {
  const records = matches.map((match) => toMatchRecord(spaceId, range, match));

  if (!supportsIndexedDb()) {
    for (const [key, record] of [...analysisMatchesFallback.entries()]) {
      if (record.spaceId === spaceId && record.range === range) {
        analysisMatchesFallback.delete(key);
      }
    }
    for (const record of records) {
      analysisMatchesFallback.set(record.key, record);
    }
    return;
  }

  await clearCachedAnalysisMatches(spaceId, range);
  await putRecords(ANALYSIS_MATCHES_STORE, records);
}

export async function clearCachedAnalysisMatches(
  spaceId: string,
  range: TimeRangePreset,
): Promise<void> {
  if (!supportsIndexedDb()) {
    for (const [key, record] of [...analysisMatchesFallback.entries()]) {
      if (record.spaceId === spaceId && record.range === range) {
        analysisMatchesFallback.delete(key);
      }
    }
    return;
  }

  const records = await getAllByIndex<CachedAnalysisMatchRecord>(
    ANALYSIS_MATCHES_STORE,
    "bySpaceRange",
    IDBKeyRange.only([spaceId, range]),
  );
  await deleteRecords(
    ANALYSIS_MATCHES_STORE,
    records.map((record) => record.key),
  );
}
