import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getSourceMemoriesQueryKey } from "@/api/source-memories";
import { patchSyncState } from "@/api/local-cache";
import { SpacePageLayout } from "@/components/space/space-page-layout";
import { useSpaceDataModel } from "@/components/space/use-space-data-model";
import { useSpaceRouteState } from "@/components/space/use-space-route-state";
import { getActiveSpaceId } from "@/lib/session";
import type { Memory } from "@/types/memory";
import { shouldCompactMemoryOverview } from "@/components/space/space-selectors";

export { shouldCompactMemoryOverview };

export function SpacePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const spaceId = getActiveSpaceId() ?? "";
  const routeState = useSpaceRouteState(spaceId);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Memory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Memory | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importStatusOpen, setImportStatusOpen] = useState(false);
  const [refreshingMemories, setRefreshingMemories] = useState(false);
  const [farmPrepOpen, setFarmPrepOpen] = useState(false);
  const dataModel = useSpaceDataModel({
    spaceId,
    q: routeState.search.q,
    range: routeState.range,
    facet: routeState.facet,
    analysisCategory: routeState.analysisCategory,
    tag: routeState.tag,
    memoryTypeFilter: routeState.memoryTypeFilter,
    timelineSelection: routeState.timelineSelection,
    importStatusOpen,
    selected: routeState.selected,
    localVisibleCount: routeState.localVisibleCount,
    onSelectedMissing: () => routeState.setSelected(null),
  });

  useEffect(() => {
    if (farmPrepOpen && dataModel.farmEntryStatus === "ready") {
      setFarmPrepOpen(false);
      window.open("/your-memory/labs/memory-farm", "_blank", "noopener");
    }
  }, [dataModel.farmEntryStatus, farmPrepOpen]);

  if (!spaceId) {
    return null;
  }

  const handleRefreshMemories = async (): Promise<void> => {
    if (!spaceId || refreshingMemories) {
      return;
    }

    setRefreshingMemories(true);

    try {
      await patchSyncState(spaceId, {
        hasFullCache: false,
        lastSyncedAt: null,
        incrementalCursor: null,
      });
      await queryClient.invalidateQueries({
        queryKey: getSourceMemoriesQueryKey(spaceId),
      });
      toast.success(t("analysis.refresh_memory_success"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("analysis.refresh_memory_failed"),
      );
    } finally {
      setRefreshingMemories(false);
    }
  };

  const handleCreate = async (content: string, tagsStr: string) => {
    const tags = tagsStr
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    try {
      await dataModel.createMutation.mutateAsync({
        content,
        tags: tags.length ? tags : undefined,
      });
      setAddOpen(false);
      toast.success(t("add.success"));
    } catch {
      toast.error(t("error.api"));
    }
  };

  const handleEdit = async (memory: Memory, content: string, tagsStr: string) => {
    const tags = tagsStr
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    try {
      const updated = await dataModel.updateMutation.mutateAsync({
        memoryId: memory.id,
        input: { content, tags },
        version: memory.version,
      });
      setEditTarget(null);
      if (routeState.selected?.id === memory.id) {
        routeState.setSelected(updated);
      }
      toast.success(t("edit.success"));
    } catch {
      toast.error(t("error.api"));
    }
  };

  const handleDelete = async (memory: Memory) => {
    try {
      await dataModel.deleteMutation.mutateAsync(memory.id);
      setDeleteTarget(null);
      if (routeState.selected?.id === memory.id) {
        routeState.setSelected(null);
      }
      toast.success(t("delete.success"));
    } catch {
      toast.error(t("error.api"));
    }
  };

  const handleExport = async () => {
    try {
      const exportFile = await dataModel.exportMutation.mutateAsync();
      const blob = new Blob([JSON.stringify(exportFile, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mem9-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(t("export.success"));
    } catch {
      toast.error(t("error.api"));
    }
  };

  const handleImport = async (file: File) => {
    try {
      await dataModel.importMutation.mutateAsync(file);
      toast.success(t("import.success"));
    } catch {
      toast.error(t("error.api"));
      throw new Error("import failed");
    }
  };

  const handleFarmAction = () => {
    if (dataModel.farmEntryStatus === "ready") {
      window.open("/your-memory/labs/memory-farm", "_blank", "noopener");
      return;
    }

    setFarmPrepOpen(true);
  };

  return (
    <SpacePageLayout
      spaceId={spaceId}
      routeState={routeState}
      dataModel={dataModel}
      t={t}
      addOpen={addOpen}
      setAddOpen={setAddOpen}
      editTarget={editTarget}
      setEditTarget={setEditTarget}
      deleteTarget={deleteTarget}
      setDeleteTarget={setDeleteTarget}
      exportOpen={exportOpen}
      setExportOpen={setExportOpen}
      importOpen={importOpen}
      setImportOpen={setImportOpen}
      importStatusOpen={importStatusOpen}
      setImportStatusOpen={setImportStatusOpen}
      farmPrepOpen={farmPrepOpen}
      setFarmPrepOpen={setFarmPrepOpen}
      refreshingMemories={refreshingMemories}
      onHandleCreate={handleCreate}
      onHandleEdit={handleEdit}
      onHandleDelete={handleDelete}
      onHandleExport={handleExport}
      onHandleImport={handleImport}
      onRefreshMemories={handleRefreshMemories}
      onHandleFarmAction={handleFarmAction}
    />
  );
}
