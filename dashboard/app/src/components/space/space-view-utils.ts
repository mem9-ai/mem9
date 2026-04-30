import { useEffect, useState } from "react";

// We deliberately keep two breakpoints rather than a single "is mobile" flag,
// because the dashboard has two different "minimum width" requirements that
// shouldn't be conflated:
//
//  - DESKTOP_BREAKPOINT (1280px) is the floor for the full three-column layout
//    (analysis rail + memory list + inline detail panel). Below this we fall
//    back to the single-column layout with a mobile detail sheet.
//  - LARGE_BREAKPOINT (1024px) is the floor for content surfaces that just
//    need a wide canvas to render — primarily the Memory Insight relations
//    workspace. 1024 is the standard "tablet landscape" / "small desktop"
//    boundary (Tailwind `lg`, Bootstrap `lg`, iPadOS desktop website mode), and
//    matches what every iPad reports in landscape orientation.
//
// Using two breakpoints lets an iPad in landscape (1024–1279px) get the full
// Memory Insight experience while still using the single-column layout that
// fits its width, instead of being lumped together with phones.
export const DESKTOP_BREAKPOINT = 1280;
export const LARGE_BREAKPOINT = 1024;

export function getIsDesktopViewport(): boolean {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= DESKTOP_BREAKPOINT;
}

export function getIsLargeViewport(): boolean {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= LARGE_BREAKPOINT;
}

function useViewportFlag(getter: () => boolean): boolean {
  const [flag, setFlag] = useState(getter);

  useEffect(() => {
    const handleResize = () => {
      setFlag(getter());
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [getter]);

  return flag;
}

export function useIsDesktopViewport(): boolean {
  return useViewportFlag(getIsDesktopViewport);
}

export function useIsLargeViewport(): boolean {
  return useViewportFlag(getIsLargeViewport);
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
