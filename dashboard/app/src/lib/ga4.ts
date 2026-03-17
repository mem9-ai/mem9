const GA4_MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID?.trim() ?? "";
const GA4_SCRIPT_ID = "mem9-ga4-script";

let hasInitializedGa4 = false;
let lastTrackedPath: string | null = null;

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

function gtag(...args: unknown[]): void {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(args);
}

export function initGa4(): void {
  if (hasInitializedGa4 || !GA4_MEASUREMENT_ID || typeof window === "undefined") {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || gtag;

  if (!document.getElementById(GA4_SCRIPT_ID)) {
    const script = document.createElement("script");
    script.id = GA4_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`;
    document.head.appendChild(script);
  }

  window.gtag("js", new Date());
  window.gtag("config", GA4_MEASUREMENT_ID, {
    send_page_view: false,
  });

  hasInitializedGa4 = true;
}

export function trackGa4PageView(pathname: string, search = ""): void {
  if (!hasInitializedGa4 || !pathname || typeof window === "undefined") {
    return;
  }

  const pagePath = `${pathname}${search}`;
  if (pagePath === lastTrackedPath) {
    return;
  }

  window.gtag("event", "page_view", {
    page_path: pagePath,
    page_title: document.title,
  });

  lastTrackedPath = pagePath;
}
