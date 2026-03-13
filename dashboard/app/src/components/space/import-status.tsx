import type { TFunction } from "i18next";
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  Clock,
  FileJson,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ImportTask, ImportTaskStatus } from "@/types/import";

const STATUS_CONFIG: Record<
  ImportTaskStatus,
  { icon: typeof CheckCircle2; className: string }
> = {
  done: { icon: CheckCircle2, className: "text-green-600 dark:text-green-400" },
  processing: { icon: Loader2, className: "text-blue-500 animate-spin" },
  pending: { icon: Clock, className: "text-muted-foreground" },
  failed: { icon: AlertCircle, className: "text-destructive" },
};

export function ImportStatusDialog({
  open,
  onOpenChange,
  tasks,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: ImportTask[];
  t: TFunction;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("import_status.title")}</DialogTitle>
        </DialogHeader>

        {tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <FileJson className="size-8 text-foreground/15" />
            <p className="text-sm text-muted-foreground">
              {t("import_status.empty")}
            </p>
          </div>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {tasks.map((task) => (
              <ImportTaskRow key={task.id} task={task} t={t} />
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            <X className="mr-1.5 size-3.5" />
            {t("import_status.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportTaskRow({
  task,
  t,
}: {
  task: ImportTask;
  t: TFunction;
}) {
  const config = STATUS_CONFIG[task.status];
  const Icon = config.icon;

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-secondary/20 p-3">
      <Icon className={`mt-0.5 size-4 shrink-0 ${config.className}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {task.file_name}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t(`import_status.status.${task.status}`)}</span>
          {(task.status === "done" || task.status === "processing") &&
            task.total_count > 0 && (
              <span>
                {task.success_count}/{task.total_count}
              </span>
            )}
        </div>
        {task.error_message && (
          <p className="mt-1 text-xs text-destructive/80">
            {task.error_message}
          </p>
        )}
      </div>
      <span className="shrink-0 text-[11px] text-soft-foreground">
        {new Date(task.created_at).toLocaleDateString()}
      </span>
    </div>
  );
}
