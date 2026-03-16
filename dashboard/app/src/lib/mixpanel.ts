import mixpanel from "mixpanel-browser";

const MIXPANEL_TOKEN = import.meta.env.VITE_MIXPANEL_TOKEN?.trim() ?? "";

let hasInitializedMixpanel = false;
let lastTrackedPageName: string | null = null;

function resolvePageName(pathname: string): string {
  if (pathname === "/") return "connect";
  if (pathname === "/space") return "space";
  return pathname;
}

export function initMixpanelOnLogin(): void {
  if (hasInitializedMixpanel || !MIXPANEL_TOKEN || typeof window === "undefined") {
    return;
  }

  mixpanel.init(MIXPANEL_TOKEN, {
    autocapture: false,
    track_pageview: false,
  });

  hasInitializedMixpanel = true;
}

export function trackMixpanelEvent(
  eventName: string,
  properties?: Record<string, string>,
): void {
  if (!hasInitializedMixpanel || !eventName || typeof window === "undefined") {
    return;
  }

  mixpanel.track(eventName, properties);
}

export function trackMixpanelPageView(pathname: string): void {
  if (!hasInitializedMixpanel || !pathname || typeof window === "undefined") {
    return;
  }

  const pageName = resolvePageName(pathname);
  if (pageName === lastTrackedPageName) {
    return;
  }

  mixpanel.track("PV", { pageName });
  lastTrackedPageName = pageName;
}
