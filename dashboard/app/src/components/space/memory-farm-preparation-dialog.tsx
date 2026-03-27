import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBatchSummary, getDisplayedBatchProgress, formatPhaseLabel } from "./analysis-panel";
import type { SpaceAnalysisState } from "@/types/analysis";
import type { MemoryFarmEntryStatus } from "./use-memory-farm-entry-state";
import { Loader2 } from "lucide-react";

export function MemoryFarmPreparationDialog({
  open,
  onOpenChange,
  status,
  analysisState,
  currentRange,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: MemoryFarmEntryStatus;
  analysisState: SpaceAnalysisState;
  currentRange: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  if (status === "unavailable") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Memory Farm Preview Unavailable</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Preview data is not currently ready because analysis failed or degraded.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={() => {
              onRetry();
              onOpenChange(false);
            }}>
              Retry analysis
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Preparing modal
  const showDetailedProgress = currentRange === "all" && analysisState.snapshot !== null;
  const progress = showDetailedProgress ? getDisplayedBatchProgress(analysisState.phase, analysisState.snapshot!) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Preparing Memory Farm Preview</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Synced memories and analysis data are being prepared for the preview.
          </p>
          
          {showDetailedProgress ? (
            <div className="rounded-xl border bg-secondary/20 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ring">
                    {t("analysis.status")}
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {formatPhaseLabel(t, analysisState.phase)}
                  </p>
                </div>
                <span className="rounded-full bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  {progress?.current ?? 0}/{progress?.total ?? 0}
                </span>
              </div>
              <div className="mt-3">
                <Progress value={progress?.ratio ?? 0} />
              </div>
              <p className="mt-2 text-xs text-soft-foreground">
                {formatBatchSummary(t, analysisState.phase, analysisState.snapshot!)}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border bg-secondary/20 px-4 py-4">
              <Loader2 className="size-5 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">
                Syncing memories for the preview...
              </p>
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
