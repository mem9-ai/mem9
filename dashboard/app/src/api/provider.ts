import type {
  Memory,
  MemoryListParams,
  MemoryListResponse,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryStats,
  MemoryExportFile,
  SessionMessageListParams,
  SessionMessageListResponse,
  SpaceInfo,
  TopicSummary,
} from "@/types/memory";
import type { TimeRangeParams } from "@/types/time-range";
import type { ImportTask, ImportTaskList } from "@/types/import";

export interface DashboardProvider {
  verifySpace(apiKey: string): Promise<SpaceInfo>;
  listMemories(
    apiKey: string,
    params: MemoryListParams,
  ): Promise<MemoryListResponse>;
  listSessionMessages(
    apiKey: string,
    params: SessionMessageListParams,
  ): Promise<SessionMessageListResponse>;
  getStats(apiKey: string, params?: TimeRangeParams): Promise<MemoryStats>;
  getMemory(apiKey: string, memoryId: string): Promise<Memory>;
  createMemory(apiKey: string, input: MemoryCreateInput): Promise<Memory>;
  updateMemory(
    apiKey: string,
    memoryId: string,
    input: MemoryUpdateInput,
    version?: number,
  ): Promise<Memory>;
  deleteMemory(apiKey: string, memoryId: string): Promise<void>;
  exportMemories(apiKey: string): Promise<MemoryExportFile>;
  importMemories(apiKey: string, file: File): Promise<ImportTask>;
  getImportTask(apiKey: string, taskId: string): Promise<ImportTask>;
  listImportTasks(apiKey: string): Promise<ImportTaskList>;
  getTopicSummary(
    apiKey: string,
    params?: TimeRangeParams,
  ): Promise<TopicSummary>;
}
