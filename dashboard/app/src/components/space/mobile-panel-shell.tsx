import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Two visual layouts the dashboard uses for slide-up / slide-in panels:
//
//  - `side-drawer` (default): right-edge drawer. Full width on phones,
//    sm:26rem / md:30rem on larger screens. Used for the memory detail and
//    analysis side panels.
//  - `responsive-sheet`: bottom sheet on narrow viewports (so it doesn't fight
//    with the vertical content list), then upgrades to the same right-edge
//    drawer at the `lg` (1024px) breakpoint. Used for surfaces that float over
//    a wide canvas like the Memory Insight relations entity detail — at
//    tablet-landscape or desktop widths a 75vh bottom sheet would obscure
//    most of the canvas, so we slide it into the side instead.
export type MobilePanelVariant = "side-drawer" | "responsive-sheet";

const SIDE_DRAWER_CLASSNAME = cn(
  "inset-y-0 right-0 left-auto top-0 h-dvh w-full max-w-full",
  "translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-background p-0 shadow-none",
  "sm:w-[26rem] sm:max-w-[26rem] sm:border-y-0 sm:border-r-0 sm:border-l",
  "md:w-[30rem] md:max-w-[30rem]",
);

const RESPONSIVE_SHEET_CLASSNAME = cn(
  // Bottom sheet (phones / portrait tablets). We override every smaller
  // breakpoint that the side-drawer styling would normally activate so the
  // sheet stays full width all the way up to the `lg` upgrade point below.
  "top-auto bottom-0 left-0 right-0 h-[75vh] max-h-[75vh] w-full max-w-full",
  "sm:w-full sm:max-w-full md:w-full md:max-w-full",
  "translate-x-0 translate-y-0 gap-0 bg-background p-0 shadow-none",
  "rounded-t-[1.5rem] rounded-b-none border-x-0 border-b-0 border-t",
  // Tablet landscape and up: behave like the side drawer so the canvas
  // underneath stays visible while the detail is open. Each `lg:` utility
  // here cancels its narrower-viewport counterpart from the block above.
  // Most importantly we have to neutralise `max-h-[75vh]` with
  // `lg:max-h-none` — without it the sheet's max-height clamps the desired
  // `lg:h-dvh` and the panel ends up as a 75vh-tall card glued to the top
  // edge instead of a full-height side drawer.
  "lg:inset-y-0 lg:right-0 lg:left-auto lg:top-0 lg:bottom-auto",
  "lg:h-dvh lg:max-h-none lg:w-[30rem] lg:max-w-[30rem]",
  // Reset every corner explicitly. `lg:rounded-none` *should* override
  // `rounded-t-[1.5rem]` on its own, but tailwind-merge can be inconsistent
  // when the source utilities mix shorthand (rounded-t-*) and full
  // (rounded-none) forms across breakpoints, so we spell each side out.
  "lg:rounded-none lg:rounded-t-none lg:rounded-b-none",
  "lg:border-l lg:border-t-0",
);

export function MobilePanelShell({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
  showHeader = true,
  bodyScrollable = true,
  variant = "side-drawer",
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
  variant?: MobilePanelVariant;
  contentClassName?: string;
  bodyClassName?: string;
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const updatePortalContainer = () => {
      setPortalContainer(
        document.fullscreenElement instanceof HTMLElement
          ? document.fullscreenElement
          : null,
      );
    };

    updatePortalContainer();
    document.addEventListener("fullscreenchange", updatePortalContainer);
    return () => document.removeEventListener("fullscreenchange", updatePortalContainer);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        portalContainer={portalContainer}
        className={cn(
          variant === "responsive-sheet"
            ? RESPONSIVE_SHEET_CLASSNAME
            : SIDE_DRAWER_CLASSNAME,
          contentClassName,
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {/*
          The outer column constrains every child within the dialog viewport so
          that long, unbreakable content (e.g. wide codeblocks or long paths in
          memory text) cannot shove the chrome — close button and footer
          actions — outside the visible right edge. `min-w-0` allows flex
          children to shrink below their min-content; `overflow-x-hidden` is
          the last-line defense if anything inside still tries to push wider.
        */}
        <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          {showHeader && (
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur-sm">
              <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">
                {title}
              </h2>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onOpenChange(false)}
                aria-label={closeLabel}
                title={closeLabel}
                data-mp-event="Dashboard/MobilePanel/CloseClicked"
                className="shrink-0 text-soft-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </Button>
            </div>
          )}

          <div
            className={cn(
              "min-h-0 min-w-0 flex-1",
              bodyScrollable
                ? "overflow-y-auto overflow-x-hidden"
                : "overflow-hidden",
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
