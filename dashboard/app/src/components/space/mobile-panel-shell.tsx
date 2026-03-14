import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function MobilePanelShell({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
  showHeader = true,
  bodyScrollable = true,
  contentClassName,
  bodyClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  closeLabel: string;
  children: ReactNode;
  showHeader?: boolean;
  bodyScrollable?: boolean;
  contentClassName?: string;
  bodyClassName?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "inset-y-0 right-0 left-auto top-0 h-dvh w-full max-w-full translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-background p-0 shadow-none sm:w-[26rem] sm:max-w-[26rem] sm:border-y-0 sm:border-r-0 sm:border-l md:w-[30rem] md:max-w-[30rem]",
          contentClassName,
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <div className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          {showHeader && (
            <div className="flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur-sm">
              <h2 className="truncate text-sm font-semibold text-foreground">
                {title}
              </h2>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onOpenChange(false)}
                aria-label={closeLabel}
                title={closeLabel}
                className="text-soft-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </Button>
            </div>
          )}

          <div
            className={cn(
              "min-h-0 flex-1",
              bodyScrollable ? "overflow-y-auto" : "overflow-hidden",
              bodyClassName,
            )}
          >
            {children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
