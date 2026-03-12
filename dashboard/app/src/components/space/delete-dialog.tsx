import type { TFunction } from "i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Memory } from "@/types/memory";

export function DeleteDialog({
  memory,
  open,
  onOpenChange,
  onConfirm,
  loading,
  t,
}: {
  memory: Memory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  loading: boolean;
  t: TFunction;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("delete.title")}</DialogTitle>
          <DialogDescription asChild>
            <div>
              <p className="my-3 rounded-lg bg-secondary p-3 text-sm italic leading-relaxed text-muted-foreground">
                &ldquo;
                {memory.content.length > 120
                  ? memory.content.slice(0, 120) + "…"
                  : memory.content}
                &rdquo;
              </p>
              <p className="text-sm">{t("delete.warning")}</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("delete.cancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {t("delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
