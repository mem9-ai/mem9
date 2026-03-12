import { useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStoredTheme, setStoredTheme, type Theme } from "@/lib/theme";

const ORDER: Theme[] = ["light", "dark", "system"];
const ICON: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};
const LABEL: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme());

  function cycle() {
    const idx = ORDER.indexOf(theme);
    const next = ORDER[(idx + 1) % ORDER.length]!;
    setTheme(next);
    setStoredTheme(next);
  }

  const Icon = ICON[theme];

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={cycle}
      className="text-soft-foreground hover:text-foreground"
      title={LABEL[theme]}
    >
      <Icon className="size-4" />
    </Button>
  );
}
