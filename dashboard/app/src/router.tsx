import {
  createRouter,
  createRoute,
  createRootRoute,
  Outlet,
} from "@tanstack/react-router";
import { Toaster } from "sonner";
import type { MemoryType } from "@/types/memory";
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

export interface SpaceSearch {
  q?: string;
  type?: MemoryType;
}

const spaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/space",
  component: SpacePage,
  validateSearch: (search: Record<string, unknown>): SpaceSearch => ({
    q: typeof search.q === "string" ? search.q || undefined : undefined,
    type: ["pinned", "insight"].includes(search.type as string)
      ? (search.type as MemoryType)
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
