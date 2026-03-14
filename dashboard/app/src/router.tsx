import {
  createRouter,
  createRoute,
  createRootRoute,
  Outlet,
} from "@tanstack/react-router";
import { Toaster } from "sonner";
import type { MemoryType, MemoryFacet } from "@/types/memory";
import { ANALYSIS_CATEGORIES, type AnalysisCategory } from "@/types/analysis";
import type { TimeRangePreset } from "@/types/time-range";
import { ConnectPage } from "@/pages/connect";
import { SpacePage } from "@/pages/space";

function RootLayout() {
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
  facet?: MemoryFacet;
  analysisCategory?: AnalysisCategory;
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
    facet: VALID_FACETS.includes(search.facet as string)
      ? (search.facet as MemoryFacet)
      : undefined,
    analysisCategory: ANALYSIS_CATEGORIES.includes(search.analysisCategory as AnalysisCategory)
      ? (search.analysisCategory as AnalysisCategory)
      : undefined,
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
