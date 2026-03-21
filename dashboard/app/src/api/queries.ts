import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { api } from "./client";
import { getSourceMemoriesQueryKey } from "./source-memories";
import type {
  Memory,
  MemoryTypeFilter,
  MemoryFacet,
  MemoryCreateInput,
  MemoryUpdateInput,
  SessionMessage,
} from "@/types/memory";
import type { TimeRangePreset } from "@/types/time-range";
import { presetToParams } from "@/types/time-range";

const PAGE_SIZE = 50;
const SESSION_PREVIEW_LIMIT = 6;

export function getSessionPreviewLookupKey(memory: Memory): string {
  if (memory.memory_type !== "insight") return "";

  const sessionID = memory.session_id.trim();
  if (sessionID) return sessionID;

  return "";
}

function getSessionPreviewRequestIDs(memories: Memory[]): string[] {
  const requestIDs = new Set<string>();

  for (const memory of memories) {
    const requestID = getSessionPreviewLookupKey(memory);
    if (!requestID) continue;
    requestIDs.add(requestID);
  }

  return [...requestIDs].sort((left, right) => left.localeCompare(right, "en"));
}

export function useStats(spaceId: string, range?: TimeRangePreset) {
  const timeParams = range ? presetToParams(range) : undefined;
  return useQuery({
    queryKey: ["space", spaceId, "stats", range ?? "all"],
    queryFn: () => api.getStats(spaceId, timeParams),
    enabled: !!spaceId,
    placeholderData: keepPreviousData,
  });
}

export function useMemories(
  spaceId: string,
  params: {
    q?: string;
    tag?: string;
    memory_type?: MemoryTypeFilter;
    range?: TimeRangePreset;
    facet?: MemoryFacet;
  },
) {
  const timeParams = params.range ? presetToParams(params.range) : {};
  return useInfiniteQuery({
    queryKey: ["space", spaceId, "memories", params],
    queryFn: ({ pageParam }) =>
      api.listMemories(spaceId, {
        q: params.q,
        tags: params.tag ? [params.tag] : undefined,
        memory_type: params.memory_type,
        facet: params.facet,
        ...timeParams,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.limit;
      return next < lastPage.total ? next : undefined;
    },
    enabled: !!spaceId,
    placeholderData: keepPreviousData,
  });
}

export function groupSessionMessagesBySessionID(
  messages: SessionMessage[],
): Record<string, SessionMessage[]> {
  return messages.reduce<Record<string, SessionMessage[]>>((grouped, message) => {
    const sessionMessages = grouped[message.session_id] ?? [];
    sessionMessages.push(message);
    grouped[message.session_id] = sessionMessages;
    return grouped;
  }, {});
}

export function useSessionPreviewMessages(
  spaceId: string,
  memories: Memory[],
  limitPerSession = SESSION_PREVIEW_LIMIT,
) {
  const sessionPreviewRequestIDs = getSessionPreviewRequestIDs(memories);

  return useQuery({
    queryKey: [
      "space",
      spaceId,
      "sessionPreview",
      sessionPreviewRequestIDs,
      limitPerSession,
    ],
    queryFn: async () => {
      const response = await api.listSessionMessages(spaceId, {
        session_ids: sessionPreviewRequestIDs,
        limit_per_session: limitPerSession,
      });
      return groupSessionMessagesBySessionID(response.messages);
    },
    enabled: !!spaceId && sessionPreviewRequestIDs.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useMemory(spaceId: string, memoryId: string | null) {
  return useQuery({
    queryKey: ["space", spaceId, "memory", memoryId],
    queryFn: () => api.getMemory(spaceId, memoryId!),
    enabled: !!spaceId && !!memoryId,
  });
}

export function useTopicSummary(
  spaceId: string,
  range?: TimeRangePreset,
  enabled = true,
) {
  const timeParams = range ? presetToParams(range) : undefined;
  return useQuery({
    queryKey: ["space", spaceId, "topics", range ?? "all"],
    queryFn: () => api.getTopicSummary(spaceId, timeParams),
    enabled: !!spaceId && enabled,
    placeholderData: keepPreviousData,
  });
}

export function useImportTasks(spaceId: string, enabled = true) {
  return useQuery({
    queryKey: ["space", spaceId, "importTasks"],
    queryFn: () => api.listImportTasks(spaceId),
    enabled: !!spaceId && enabled,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "processing") return 3000;
      return false;
    },
  });
}

export function useImportTask(
  spaceId: string,
  taskId: string | null,
) {
  return useQuery({
    queryKey: ["space", spaceId, "importTask", taskId],
    queryFn: () => api.getImportTask(spaceId, taskId!),
    enabled: !!spaceId && !!taskId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "pending" || status === "processing") return 2000;
      return false;
    },
  });
}

// ─── Mutations ───

export function useCreateMemory(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MemoryCreateInput) =>
      api.createMemory(spaceId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["space", spaceId, "memories"] });
      qc.invalidateQueries({ queryKey: ["space", spaceId, "stats"] });
      qc.invalidateQueries({ queryKey: ["space", spaceId, "topics"] });
      qc.invalidateQueries({ queryKey: getSourceMemoriesQueryKey(spaceId) });
    },
  });
}

export function useDeleteMemory(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memoryId: string) => api.deleteMemory(spaceId, memoryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["space", spaceId, "memories"] });
      qc.invalidateQueries({ queryKey: ["space", spaceId, "stats"] });
      qc.invalidateQueries({ queryKey: ["space", spaceId, "topics"] });
      qc.invalidateQueries({ queryKey: getSourceMemoriesQueryKey(spaceId) });
    },
  });
}

export function useUpdateMemory(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      memoryId,
      input,
      version,
    }: {
      memoryId: string;
      input: MemoryUpdateInput;
      version?: number;
    }) => api.updateMemory(spaceId, memoryId, input, version),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: ["space", spaceId, "memory", variables.memoryId],
      });
      qc.invalidateQueries({ queryKey: ["space", spaceId, "memories"] });
      qc.invalidateQueries({ queryKey: getSourceMemoriesQueryKey(spaceId) });
    },
  });
}

export function useExportMemories(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.exportMemories(spaceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["space", spaceId] });
    },
  });
}

export function useImportMemories(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.importMemories(spaceId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["space", spaceId, "importTasks"] });
    },
  });
}
