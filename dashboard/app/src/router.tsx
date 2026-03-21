import {
  createRouter,
  createRoute,
  createRootRoute,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { trackGa4PageView } from "@/lib/ga4";
import type { MemoryType, MemoryFacet } from "@/types/memory";
import type { AnalysisCategory } from "@/types/analysis";
import type { TimeRangePreset } from "@/types/time-range";
import { trackMixpanelPageView } from "@/lib/mixpanel";
import { ConnectPage } from "@/pages/connect";
import { SpacePage } from "@/pages/space";

function RootLayout() {
  const location = useLocation({
    select: (currentLocation) => ({
      pathname: currentLocation.pathname,
      searchStr: currentLocation.searchStr,
    }),
  });

  useEffect(() => {
    trackGa4PageView(location.pathname, location.searchStr);
    trackMixpanelPageView(location.pathname);
  }, [location.pathname, location.searchStr]);

  return (
    <>
      <Outlet />
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const connectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ConnectPage,
});

const VALID_TYPES = ["pinned", "insight"];
const VALID_RANGES = ["7d", "30d", "90d", "all"];
const VALID_FACETS = [
  "about_you",
  "preferences",
  "important_people",
  "experiences",
  "plans",
  "routines",
  "constraints",
  "other",
];

export interface SpaceSearch {
  q?: string;
  tag?: string;
  type?: MemoryType;
  range?: TimeRangePreset;
  timelineFrom?: string;
  timelineTo?: string;
  facet?: MemoryFacet;
  analysisCategory?: AnalysisCategory;
}

function validateTimelineBound(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function validateAnalysisCategory(value: unknown): AnalysisCategory | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const spaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/space",
  component: SpacePage,
  validateSearch: (search: Record<string, unknown>): SpaceSearch => ({
    q: typeof search.q === "string" ? search.q || undefined : undefined,
    tag: typeof search.tag === "string" ? search.tag || undefined : undefined,
    type: VALID_TYPES.includes(search.type as string)
      ? (search.type as MemoryType)
      : undefined,
    range: VALID_RANGES.includes(search.range as string)
      ? (search.range as TimeRangePreset)
      : undefined,
    timelineFrom: validateTimelineBound(search.timelineFrom),
    timelineTo: validateTimelineBound(search.timelineTo),
    facet: VALID_FACETS.includes(search.facet as string)
      ? (search.facet as MemoryFacet)
      : undefined,
    analysisCategory: validateAnalysisCategory(search.analysisCategory),
  }),
});

const routeTree = rootRoute.addChildren([connectRoute, spaceRoute]);

export const router = createRouter({
  routeTree,
  basepath: "/your-memory",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
