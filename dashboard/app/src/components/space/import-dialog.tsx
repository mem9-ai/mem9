import { useRef, useState } from "react";
import type { TFunction } from "i18next";
import { Upload, FileJson, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export function ImportDialog({
  open,
  onOpenChange,
  onImport,
  onViewHistory,
  loading,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (file: File) => Promise<void>;
  onViewHistory: () => void;
  loading: boolean;
  t: TFunction;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    setError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (!selected.name.endsWith(".json")) {
      setError(t("import.error_format"));
      setFile(null);
      return;
    }
    if (selected.size > MAX_FILE_SIZE) {
      setError(t("import.error_size"));
      setFile(null);
      return;
    }
    setFile(selected);
  }

  async function handleImport() {
    if (!file) return;
    try {
      await onImport(file);
      setFile(null);
      setError(null);
      if (inputRef.current) inputRef.current.value = "";
      onOpenChange(false);
    } catch {
      setError(t("import.error_upload"));
    }
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      setFile(null);
      setError(null);
      if (inputRef.current) inputRef.current.value = "";
    }
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
          <DialogDescription>{t("import.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            onClick={() => inputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 transition-colors hover:border-primary/30 hover:bg-secondary/30"
          >
            {file ? (
              <>
                <FileJson className="size-8 text-primary" />
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">
                    {file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </>
            ) : (
              <>
                <Upload className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {t("import.drop_hint")}
                </p>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/5 p-3 text-xs text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {t("import.note")}
            </p>
            <button
              onClick={() => {
                onOpenChange(false);
                onViewHistory();
              }}
              className="shrink-0 text-xs text-primary/70 underline-offset-2 hover:text-primary hover:underline"
            >
              {t("tools.import_status")}
            </button>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
            >
              {t("import.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={!file || loading}
              className="gap-2"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {t("import.button")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
