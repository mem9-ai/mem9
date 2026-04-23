import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import "@/lib/connect-bootstrap-init";
import { router } from "@/router";
import { initGa4 } from "@/lib/ga4";
import { enableMixpanelAutoClickTracking } from "@/lib/mixpanel-auto-click";
import { initTheme } from "@/lib/theme";
import "@xyflow/react/dist/style.css";
import "@/i18n";
import "@/index.css";
import * as Sentry from "@sentry/react";

const sentryDSN = import.meta.env.VITE_SENTRY_DSN;

if (sentryDSN) {
  Sentry.init({
    dsn: sentryDSN,
    sendDefaultPii: true,
  });
}

initTheme();
initGa4();
enableMixpanelAutoClickTracking();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
