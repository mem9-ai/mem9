import { useEffect, useState } from "react";
import { useNavigate, getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Search,
  Plus,
  LogOut,
  Globe,
  Bookmark,
  Sparkles,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  useStats,
  useMemories,
  useCreateMemory,
  useDeleteMemory,
  useUpdateMemory,
} from "@/api/queries";
import { getSpaceId, clearSpace, maskSpaceId } from "@/lib/session";
import { MemoryCard } from "@/components/space/memory-card";
import { DetailPanel } from "@/components/space/detail-panel";
import { EmptyState } from "@/components/space/empty-state";
import { AddMemoryDialog } from "@/components/space/add-dialog";
import { EditMemoryDialog } from "@/components/space/edit-dialog";
import { DeleteDialog } from "@/components/space/delete-dialog";
import type { Memory, MemoryType } from "@/types/memory";

const route = getRouteApi("/space");

export function SpacePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = route.useSearch();
  const spaceId = getSpaceId() ?? "";

  const [selected, setSelected] = useState<Memory | null>(null);
  const [searchInput, setSearchInput] = useState(search.q ?? "");
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Memory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Memory | null>(null);

  useEffect(() => {
    if (!spaceId) navigate({ to: "/" });
  }, [spaceId, navigate]);

  const { data: stats } = useStats(spaceId);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useMemories(spaceId, { q: search.q, memory_type: search.type });
  const createMutation = useCreateMemory(spaceId);
  const deleteMutation = useDeleteMemory(spaceId);
  const updateMutation = useUpdateMemory(spaceId);

  const memories = data?.pages.flatMap((p) => p.memories) ?? [];

  if (!spaceId) return null;

  function disconnect() {
    clearSpace();
    navigate({ to: "/" });
  }

  function handleSearch(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      navigate({
        to: "/space",
        search: { ...search, q: searchInput || undefined },
      });
    }
  }

  function handleTabChange(value: string) {
    const type = value === "all" ? undefined : (value as MemoryType);
    navigate({ to: "/space", search: { ...search, type } });
  }

  async function handleCreate(content: string, tagsStr: string) {
    const tags = tagsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await createMutation.mutateAsync({
        content,
        tags: tags.length ? tags : undefined,
      });
      setAddOpen(false);
      toast.success(t("add.success"));
    } catch {
      toast.error(t("error.api"));
    }
  }

  async function handleEdit(mem: Memory, content: string, tagsStr: string) {
    const tags = tagsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const updated = await updateMutation.mutateAsync({
        memoryId: mem.id,
        input: { content, tags },
        version: mem.version,
      });
      setEditTarget(null);
      if (selected?.id === mem.id) setSelected(updated);
      toast.success(t("edit.success"));
    } catch {
      toast.error(t("error.api"));
    }
  }

  async function handleDelete(mem: Memory) {
    try {
      await deleteMutation.mutateAsync(mem.id);
      setDeleteTarget(null);
      if (selected?.id === mem.id) setSelected(null);
      toast.success(t("delete.success"));
    } catch {
      toast.error(t("error.api"));
    }
  }

  const toggleLang = () =>
    i18n.changeLanguage(i18n.language === "zh-CN" ? "en" : "zh-CN");

  const isEmpty =
    !isLoading && memories.length === 0 && !search.q && !search.type;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b bg-nav-bg backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1180px] items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <img
              src="/your-memory/mem9-logo.svg"
              alt="mem9"
              className="h-5 w-auto dark:invert"
            />
            <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-soft-foreground">
              {maskSpaceId(spaceId)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLang}
              className="gap-1 text-soft-foreground hover:text-foreground"
              title={
                i18n.language === "zh-CN" ? "Switch to English" : "切换到中文"
              }
            >
              <Globe className="size-4" />
              <span className="text-xs">
                {i18n.language === "zh-CN" ? "EN" : "中文"}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={disconnect}
              className="text-soft-foreground hover:text-destructive"
              title={t("space.disconnect")}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div
        className={`mx-auto px-6 ${selected ? "max-w-[1180px]" : "max-w-3xl"}`}
      >
        <div className={`flex ${selected ? "gap-8" : ""}`}>
          <div className="min-w-0 flex-1 py-8">
            {/* Stats */}
            {stats && (
              <div
                className="grid grid-cols-3 gap-4"
                style={{
                  animation: "slide-up 0.4s cubic-bezier(0.16,1,0.3,1)",
                }}
              >
                <div className="surface-card p-5">
                  <div className="text-3xl font-bold tracking-[-0.04em]">
                    {stats.total}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {t("space.stats.total")}
                  </div>
                </div>
                <div className="surface-card relative overflow-hidden p-5">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-type-pinned" />
                  <div className="text-3xl font-bold tracking-[-0.04em] text-type-pinned">
                    {stats.pinned}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {t("space.stats.pinned")}
                  </div>
                </div>
                <div className="surface-card relative overflow-hidden p-5">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-type-insight" />
                  <div className="text-3xl font-bold tracking-[-0.04em] text-type-insight">
                    {stats.insight}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {t("space.stats.insight")}
                  </div>
                </div>
              </div>
            )}

            {/* Type legend — compact inline context */}
            {stats && (stats.pinned > 0 || stats.insight > 0) && (
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Bookmark className="size-3 text-type-pinned" />
                  <span className="text-foreground/70">
                    {t("tabs.pinned")}
                  </span>
                  <span className="text-soft-foreground">
                    — {t("legend.pinned")}
                  </span>
                </span>
                <span className="text-border">·</span>
                <span className="flex items-center gap-1.5">
                  <Sparkles className="size-3 text-type-insight" />
                  <span className="text-foreground/70">
                    {t("tabs.insight")}
                  </span>
                  <span className="text-soft-foreground">
                    — {t("legend.insight")}
                  </span>
                </span>
              </div>
            )}

            {/* Search + add */}
            <div className="mt-6 flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-soft-foreground" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleSearch}
                  placeholder={t("search.placeholder")}
                  className="h-10 bg-popover pl-9 pr-8 text-sm placeholder:text-soft-foreground"
                />
                {searchInput && (
                  <button
                    onClick={() => {
                      setSearchInput("");
                      navigate({
                        to: "/space",
                        search: { ...search, q: undefined },
                      });
                    }}
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-soft-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
              <Button
                onClick={() => setAddOpen(true)}
                className="h-10 gap-2 px-4 text-sm"
              >
                <Plus className="size-4" />
                {t("add.button")}
              </Button>
            </div>

            {/* Tabs */}
            <div className="mt-4">
              <Tabs
                value={search.type ?? "all"}
                onValueChange={handleTabChange}
              >
                <TabsList variant="line">
                  <TabsTrigger value="all">{t("tabs.all")}</TabsTrigger>
                  <TabsTrigger value="pinned" className="gap-1.5">
                    <span className="size-2 rounded-full bg-type-pinned" />
                    {t("tabs.pinned")}
                  </TabsTrigger>
                  <TabsTrigger value="insight" className="gap-1.5">
                    <span className="size-2 rounded-full bg-type-insight" />
                    {t("tabs.insight")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Memory list */}
            <div className="mt-4">
              {isEmpty ? (
                <EmptyState t={t} onAdd={() => setAddOpen(true)} />
              ) : isLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-soft-foreground" />
                </div>
              ) : memories.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16">
                  <Search className="size-8 text-foreground/15" />
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("search.no_results")}
                  </p>
                  <p className="text-xs text-soft-foreground">
                    {t("search.no_results_hint")}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {memories.map((m, i) => (
                    <MemoryCard
                      key={m.id}
                      memory={m}
                      isSelected={selected?.id === m.id}
                      onClick={() => setSelected(m)}
                      onDelete={() => setDeleteTarget(m)}
                      t={t}
                      delay={i * 30}
                    />
                  ))}
                  {hasNextPage && (
                    <div className="py-4 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="text-sm text-soft-foreground"
                      >
                        {isFetchingNextPage && (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        {t("list.load_more")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Detail panel */}
          {selected && (
            <DetailPanel
              key={selected.id}
              memory={selected}
              onClose={() => setSelected(null)}
              onDelete={() => setDeleteTarget(selected)}
              onEdit={
                selected.memory_type === "pinned"
                  ? () => setEditTarget(selected)
                  : undefined
              }
              t={t}
            />
          )}
        </div>
      </div>

      {/* Dialogs */}
      <AddMemoryDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSave={handleCreate}
        loading={createMutation.isPending}
        t={t}
      />
      {editTarget && (
        <EditMemoryDialog
          memory={editTarget}
          open={!!editTarget}
          onOpenChange={(open) => !open && setEditTarget(null)}
          onSave={(content, tags) => handleEdit(editTarget, content, tags)}
          loading={updateMutation.isPending}
          t={t}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          memory={deleteTarget}
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget)}
          loading={deleteMutation.isPending}
          t={t}
        />
      )}
    </div>
  );
}
