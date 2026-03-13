import type { TFunction } from "i18next";
import { Settings2, Download, Upload, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SpaceTools({
  onExport,
  onImport,
  onImportStatus,
  t,
}: {
  onExport: () => void;
  onImport: () => void;
  onImportStatus: () => void;
  t: TFunction;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-soft-foreground hover:text-foreground"
        >
          <Settings2 className="size-4" />
          <span className="text-xs">{t("tools.title")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onExport} className="gap-2">
          <Download className="size-4" />
          {t("tools.export")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImport} className="gap-2">
          <Upload className="size-4" />
          {t("tools.import")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportStatus} className="gap-2">
          <ClipboardList className="size-4" />
          {t("tools.import_history")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
