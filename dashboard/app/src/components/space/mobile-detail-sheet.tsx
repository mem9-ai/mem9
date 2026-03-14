import type { TFunction } from "i18next";
import { DetailPanelContent } from "@/components/space/detail-panel";
import { MobilePanelShell } from "@/components/space/mobile-panel-shell";
import type { Memory } from "@/types/memory";

export function MobileDetailSheet({
  memory,
  open,
  onOpenChange,
  onDelete,
  onEdit,
  t,
}: {
  memory: Memory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  onEdit?: () => void;
  t: TFunction;
}) {
  if (!memory) return null;

  return (
    <MobilePanelShell
      open={open}
      onOpenChange={onOpenChange}
      title={memory.content}
      description={t(`detail.type.${memory.memory_type}`)}
      closeLabel={t("detail.close")}
      showHeader={false}
      bodyScrollable={false}
    >
      <DetailPanelContent
        memory={memory}
        onClose={() => onOpenChange(false)}
        onDelete={onDelete}
        onEdit={onEdit}
        t={t}
        scrollAreaClassName="min-h-0 flex-1 overflow-y-auto px-5 py-4"
      />
    </MobilePanelShell>
  );
}
