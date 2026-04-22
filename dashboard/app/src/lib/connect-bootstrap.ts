export interface ConnectBootstrapState {
  autoConnectKey: string | null;
  hasBootstrapParams: boolean;
  initialInput: string;
}

interface ConnectBootstrapParseResult {
  didSanitizeURL: boolean;
  sanitizedURL: string;
  state: ConnectBootstrapState;
}

interface ConnectBootstrapInitOptions {
  history?: Pick<History, "replaceState"> & { state?: unknown };
  location?: Location | URL;
}

const EMPTY_CONNECT_BOOTSTRAP_STATE: ConnectBootstrapState = {
  autoConnectKey: null,
  hasBootstrapParams: false,
  initialInput: "",
};

let hasInitializedConnectBootstrap = false;
let pendingConnectBootstrap = EMPTY_CONNECT_BOOTSTRAP_STATE;

function normalizeBootstrapParam(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildRelativeURL(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function parseConnectBootstrapFromLocation(
  location: Location | URL,
): ConnectBootstrapParseResult {
  const nextURL = new URL(location.href);
  const key = normalizeBootstrapParam(nextURL.searchParams.get("key"));
  const id = normalizeBootstrapParam(nextURL.searchParams.get("id"));
  const initialInput = key ?? id ?? "";

  nextURL.searchParams.delete("id");
  nextURL.searchParams.delete("key");

  return {
    didSanitizeURL: buildRelativeURL(nextURL) !== buildRelativeURL(new URL(location.href)),
    sanitizedURL: buildRelativeURL(nextURL),
    state: {
      autoConnectKey: key,
      hasBootstrapParams: key !== null || id !== null,
      initialInput,
    },
  };
}

export function initializeConnectBootstrapFromLocation(
  options: ConnectBootstrapInitOptions = {},
): ConnectBootstrapState {
  if (hasInitializedConnectBootstrap) {
    return pendingConnectBootstrap;
  }

  hasInitializedConnectBootstrap = true;

  if (typeof window === "undefined") {
    pendingConnectBootstrap = EMPTY_CONNECT_BOOTSTRAP_STATE;
    return pendingConnectBootstrap;
  }

  const location = options.location ?? window.location;
  const history = options.history ?? window.history;
  const parsed = parseConnectBootstrapFromLocation(location);

  pendingConnectBootstrap = parsed.state;

  if (parsed.didSanitizeURL) {
    history.replaceState(history.state ?? null, "", parsed.sanitizedURL);
  }

  return pendingConnectBootstrap;
}

export function consumeConnectBootstrap(): ConnectBootstrapState {
  const current = pendingConnectBootstrap;
  pendingConnectBootstrap = EMPTY_CONNECT_BOOTSTRAP_STATE;
  return current;
}

export function resetConnectBootstrapForTests(): void {
  hasInitializedConnectBootstrap = false;
  pendingConnectBootstrap = EMPTY_CONNECT_BOOTSTRAP_STATE;
}
