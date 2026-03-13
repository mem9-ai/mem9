import { useState } from "react";
import type { TFunction } from "i18next";
import { Download, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { MemoryStats } from "@/types/memory";

export function ExportDialog({
  open,
  onOpenChange,
  onExport,
  stats,
  loading,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: () => Promise<void>;
  stats: MemoryStats | undefined;
  loading: boolean;
  t: TFunction;
}) {
  const [done, setDone] = useState(false);

  async function handleExport() {
    try {
      await onExport();
      setDone(true);
      setTimeout(() => {
        setDone(false);
        onOpenChange(false);
      }, 1500);
    } catch {
      // error handled by caller
    }
  }

  function handleOpenChange(v: boolean) {
    if (!v) setDone(false);
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("export.title")}</DialogTitle>
          <DialogDescription>{t("export.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {stats && (
            <div className="rounded-lg border bg-secondary/30 p-3">
              <div className="text-sm text-foreground">
                {t("export.count", { count: stats.total })}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("export.breakdown", {
                  pinned: stats.pinned,
                  insight: stats.insight,
                })}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {t("export.note")}
          </p>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
            >
              {t("export.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleExport}
              disabled={loading || done}
              className="gap-2"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : done ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <Download className="size-4" />
              )}
              {done ? t("export.done") : t("export.button")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
