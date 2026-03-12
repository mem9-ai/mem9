import type { TFunction } from "i18next";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState({
  t,
  onAdd,
}: {
  t: TFunction;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-secondary text-3xl">
        🫙
      </div>
      <div>
        <h3 className="text-base font-semibold">{t("empty.title")}</h3>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {t("empty.description")}
        </p>
      </div>
      <Button onClick={onAdd} className="gap-2 text-sm">
        <Plus className="size-4" />
        {t("empty.cta")}
      </Button>
    </div>
  );
}
