import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { api } from "./client";
import type {
  MemoryType,
  MemoryFacet,
  MemoryCreateInput,
  MemoryUpdateInput,
} from "@/types/memory";
import type { TimeRangePreset } from "@/types/time-range";
import { presetToParams } from "@/types/time-range";

const PAGE_SIZE = 50;

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
    memory_type?: MemoryType;
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
      qc.invalidateQueries({ queryKey: ["analysis", "source-memories", spaceId] });
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
      qc.invalidateQueries({ queryKey: ["analysis", "source-memories", spaceId] });
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
      qc.invalidateQueries({ queryKey: ["analysis", "source-memories", spaceId] });
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
