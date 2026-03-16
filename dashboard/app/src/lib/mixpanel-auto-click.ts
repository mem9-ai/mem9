import { trackMixpanelEvent } from "@/lib/mixpanel";

let hasEnabledAutoClickTracking = false;

function normalizeDatasetKey(key: string): string | null {
  if (!key.startsWith("mp") || key === "mpEvent" || key === "mpPropagationIgnored") {
    return null;
  }

  const normalized = key.slice(2);
  if (!normalized) return null;

  return normalized.charAt(0).toLowerCase() + normalized.slice(1);
}

function getEventProperties(dataset: DOMStringMap): Record<string, string> {
  return Object.entries(dataset).reduce<Record<string, string>>((acc, [key, value]) => {
    const normalizedKey = normalizeDatasetKey(key);
    if (!normalizedKey || !value) {
      return acc;
    }

    acc[normalizedKey] = value;
    return acc;
  }, {});
}

export function enableMixpanelAutoClickTracking(): void {
  if (hasEnabledAutoClickTracking || typeof document === "undefined") {
    return;
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest("button[data-mp-event]");
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return;
    }

    const eventName = button.dataset.mpEvent;
    if (!eventName) {
      return;
    }

    trackMixpanelEvent(eventName, {
      from: window.location.pathname,
      ...getEventProperties(button.dataset),
    });
  });

  hasEnabledAutoClickTracking = true;
}
