import { useState, useEffect } from "react";
import type { TFunction } from "i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Memory } from "@/types/memory";

export function EditMemoryDialog({
  memory,
  open,
  onOpenChange,
  onSave,
  loading,
  t,
}: {
  memory: Memory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (content: string, tags: string) => void;
  loading: boolean;
  t: TFunction;
}) {
  const [content, setContent] = useState(memory.content);
  const [tags, setTags] = useState((memory.tags ?? []).join(", "));

  useEffect(() => {
    if (open) {
      setContent(memory.content);
      setTags((memory.tags ?? []).join(", "));
    }
  }, [open, memory]);

  function handleSave() {
    if (!content.trim()) return;
    onSave(content.trim(), tags);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("edit.title")}</DialogTitle>
          <DialogDescription>{t("edit.prompt")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            className="w-full resize-none rounded-lg border bg-popover px-3.5 py-2.5 text-sm leading-relaxed outline-none placeholder:text-soft-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
            autoFocus
          />
          <div>
            <label className="text-xs text-soft-foreground">
              {t("edit.tags_label")}
            </label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("edit.tags_placeholder")}
              className="mt-1 bg-popover text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("edit.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!content.trim() || loading}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {t("edit.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
