import { useEffect, useState } from "react";

export const DESKTOP_BREAKPOINT = 1280;

export function getIsDesktopViewport(): boolean {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= DESKTOP_BREAKPOINT;
}

export function useIsDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(getIsDesktopViewport);

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(getIsDesktopViewport());
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isDesktop;
}

export function scrollToMemoryList(): void {
  const el = document.getElementById("memory-list");
  if (!el) return;

  const headerOffset = window.innerWidth >= DESKTOP_BREAKPOINT ? 120 : 180;
  const y = el.getBoundingClientRect().top + window.scrollY - headerOffset;
  window.scrollTo({ top: y, behavior: "smooth" });
}

export function navigateAndScrollToMemoryList(action: () => void): void {
  action();
  window.setTimeout(scrollToMemoryList, 200);
}
