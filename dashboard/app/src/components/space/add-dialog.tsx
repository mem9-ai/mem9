import { useState } from "react";
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

export function AddMemoryDialog({
  open,
  onOpenChange,
  onSave,
  loading,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (content: string, tags: string) => void;
  loading: boolean;
  t: TFunction;
}) {
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");

  function handleSave() {
    if (!content.trim()) return;
    onSave(content.trim(), tags);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setContent("");
          setTags("");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("add.title")}</DialogTitle>
          <DialogDescription>{t("add.prompt")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-lg border bg-popover px-3.5 py-2.5 text-sm leading-relaxed outline-none placeholder:text-soft-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
            autoFocus
          />
          <div>
            <label className="text-xs text-soft-foreground">
              {t("add.tags_label")}
            </label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("add.tags_placeholder")}
              className="mt-1 bg-popover text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <p className="mr-auto flex items-center gap-1.5 text-xs text-soft-foreground">
            <span className="size-2 rounded-full bg-type-pinned" />
            {t("add.footer")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("add.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!content.trim() || loading}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {t("add.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
