import type {
  Memory,
  MemoryListParams,
  MemoryListResponse,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryStats,
  SessionMessageListParams,
  SessionMessageListResponse,
  SpaceInfo,
  TopicSummary,
} from "@/types/memory";
import type { TimeRangeParams } from "@/types/time-range";
import type { ImportTask, ImportTaskList } from "@/types/import";

export interface DashboardProvider {
  verifySpace(apiKey: string, signal?: AbortSignal): Promise<SpaceInfo>;
  listMemories(
    apiKey: string,
    params: MemoryListParams,
    signal?: AbortSignal,
  ): Promise<MemoryListResponse>;
  listSessionMessages(
    apiKey: string,
    params: SessionMessageListParams,
    signal?: AbortSignal,
  ): Promise<SessionMessageListResponse>;
  getStats(
    apiKey: string,
    params?: TimeRangeParams,
    signal?: AbortSignal,
  ): Promise<MemoryStats>;
  getMemory(
    apiKey: string,
    memoryId: string,
    signal?: AbortSignal,
  ): Promise<Memory>;
  createMemory(apiKey: string, input: MemoryCreateInput): Promise<Memory>;
  updateMemory(
    apiKey: string,
    memoryId: string,
    input: MemoryUpdateInput,
    version?: number,
  ): Promise<Memory>;
  deleteMemory(apiKey: string, memoryId: string): Promise<void>;
  exportMemories(apiKey: string): Promise<Blob>;
  importMemories(apiKey: string, file: File): Promise<ImportTask>;
  getImportTask(
    apiKey: string,
    taskId: string,
    signal?: AbortSignal,
  ): Promise<ImportTask>;
  listImportTasks(apiKey: string, signal?: AbortSignal): Promise<ImportTaskList>;
  getTopicSummary(
    apiKey: string,
    params?: TimeRangeParams,
    signal?: AbortSignal,
  ): Promise<TopicSummary>;
}
