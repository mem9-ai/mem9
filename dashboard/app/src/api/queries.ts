import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./client";
import type {
  MemoryType,
  MemoryCreateInput,
  MemoryUpdateInput,
} from "../types/memory";

const PAGE_SIZE = 50;

// ─── Queries ───

export function useStats(spaceId: string) {
  return useQuery({
    queryKey: ["space", spaceId, "stats"],
    queryFn: () => api.getStats(spaceId),
    enabled: !!spaceId,
  });
}

export function useMemories(
  spaceId: string,
  params: { q?: string; memory_type?: MemoryType },
) {
  return useInfiniteQuery({
    queryKey: ["space", spaceId, "memories", params],
    queryFn: ({ pageParam }) =>
      api.listMemories(spaceId, {
        ...params,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.limit;
      return next < lastPage.total ? next : undefined;
    },
    enabled: !!spaceId,
  });
}

export function useMemory(spaceId: string, memoryId: string | null) {
  return useQuery({
    queryKey: ["space", spaceId, "memory", memoryId],
    queryFn: () => api.getMemory(spaceId, memoryId!),
    enabled: !!spaceId && !!memoryId,
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
    },
  });
}
