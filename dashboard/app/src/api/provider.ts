import type {
  Memory,
  MemoryListParams,
  MemoryListResponse,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryStats,
  MemoryExportFile,
  SpaceInfo,
  TopicSummary,
} from "@/types/memory";
import type { TimeRangeParams } from "@/types/time-range";
import type { ImportTask, ImportTaskList } from "@/types/import";

export interface DashboardProvider {
  verifySpace(spaceId: string): Promise<SpaceInfo>;
  listMemories(
    spaceId: string,
    params: MemoryListParams,
  ): Promise<MemoryListResponse>;
  getStats(spaceId: string, params?: TimeRangeParams): Promise<MemoryStats>;
  getMemory(spaceId: string, memoryId: string): Promise<Memory>;
  createMemory(spaceId: string, input: MemoryCreateInput): Promise<Memory>;
  updateMemory(
    spaceId: string,
    memoryId: string,
    input: MemoryUpdateInput,
    version?: number,
  ): Promise<Memory>;
  deleteMemory(spaceId: string, memoryId: string): Promise<void>;
  exportMemories(spaceId: string): Promise<MemoryExportFile>;
  importMemories(spaceId: string, file: File): Promise<ImportTask>;
  getImportTask(spaceId: string, taskId: string): Promise<ImportTask>;
  listImportTasks(spaceId: string): Promise<ImportTaskList>;
  getTopicSummary(
    spaceId: string,
    params?: TimeRangeParams,
  ): Promise<TopicSummary>;
}
