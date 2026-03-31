import type * as React from "react";
import { cn } from "@/lib/utils";

function ButtonGroup({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<"div"> & {
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(
        "inline-flex shrink-0 items-stretch overflow-hidden",
        orientation === "vertical" ? "flex-col" : "flex-row",
        className,
      )}
      {...props}
    />
  );
}

function ButtonGroupSeparator({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"span"> & {
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="button-group-separator"
      data-orientation={orientation}
      className={cn(
        "shrink-0 bg-current/20",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}

export { ButtonGroup, ButtonGroupSeparator };
