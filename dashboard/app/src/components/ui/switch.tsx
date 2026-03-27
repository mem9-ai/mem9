import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  className?: string;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

function Switch({ checked, className, disabled = false, onCheckedChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-[#8fb76b]/40 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-[#5a7740]" : "bg-[#b79d74]",
        className,
      )}
      onClick={() => onCheckedChange?.(!checked)}
    >
      <span
        className={cn(
          "block size-4 rounded-full bg-white transition-transform",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

export { Switch };
