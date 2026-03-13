import { useState } from "react";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getStoredTheme, setStoredTheme, type Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme());

  function pick(next: Theme) {
    setTheme(next);
    setStoredTheme(next);
  }

  const current = OPTIONS.find((o) => o.value === theme)!;
  const Icon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-soft-foreground hover:text-foreground"
        >
          <Icon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[120px]">
        {OPTIONS.map((opt) => {
          const OptIcon = opt.icon;
          return (
            <DropdownMenuItem
              key={opt.value}
              onClick={() => pick(opt.value)}
              className="gap-2"
            >
              <OptIcon className="size-3.5" />
              <span className="flex-1">{opt.label}</span>
              {theme === opt.value && (
                <Check className="size-3.5 text-primary" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
