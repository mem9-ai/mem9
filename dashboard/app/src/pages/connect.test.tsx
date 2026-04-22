import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import i18n from "@/i18n";
import { resetConnectBootstrapForTests } from "@/lib/connect-bootstrap";
import { ConnectPage } from "./connect";
import { loadConnectRouteData, type ConnectRouteLoaderData } from "./connect-loader";

const mocks = vi.hoisted(() => ({
  getActiveSpaceId: vi.fn<() => string | null>(() => null),
  initMixpanelOnLogin: vi.fn(),
  loaderData: {
    hasBootstrapParams: false,
    initialError: "",
    initialInput: "",
  } as ConnectRouteLoaderData,
  navigate: vi.fn(() => Promise.resolve()),
  setSpaceId: vi.fn(),
  trackMixpanelEvent: vi.fn(),
  verifySpace: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>(
      "@tanstack/react-router",
    );

  return {
    ...actual,
    getRouteApi: () => ({
      useLoaderData: () => mocks.loaderData,
    }),
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/api/client", () => ({
  api: {
    verifySpace: (spaceId: string) => mocks.verifySpace(spaceId),
  },
}));

vi.mock("@/lib/mixpanel", () => ({
  initMixpanelOnLogin: () => mocks.initMixpanelOnLogin(),
  trackMixpanelEvent: (eventName: string, properties?: Record<string, string>) =>
    mocks.trackMixpanelEvent(eventName, properties),
}));

vi.mock("@/lib/session", () => ({
  MEM9_CONNECT_READY_EVENT: "mem9-connect-ready",
  MEM9_SPACE_HANDOFF_EVENT: "mem9-space-handoff",
  getActiveSpaceId: () => mocks.getActiveSpaceId(),
  setSpaceId: (spaceId: string, remember?: boolean) =>
    mocks.setSpaceId(spaceId, remember),
}));

function setLoaderData(next: ConnectRouteLoaderData): void {
  mocks.loaderData = next;
}

function currentURL(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

beforeEach(() => {
  resetConnectBootstrapForTests();
  mocks.getActiveSpaceId.mockReset();
  mocks.getActiveSpaceId.mockReturnValue(null);
  mocks.initMixpanelOnLogin.mockReset();
  mocks.navigate.mockClear();
  mocks.setSpaceId.mockReset();
  mocks.trackMixpanelEvent.mockReset();
  mocks.verifySpace.mockReset();
  setLoaderData({
    hasBootstrapParams: false,
    initialError: "",
    initialInput: "",
  });
  window.history.pushState({}, "", "/your-memory");
  Object.defineProperty(window, "opener", {
    configurable: true,
    value: null,
  });
});

afterEach(() => {
  resetConnectBootstrapForTests();
});

describe("loadConnectRouteData", () => {
  it("prefills id params without auto-login and strips them from the URL", async () => {
    window.history.pushState({}, "", "/your-memory?id=space-id&foo=1#details");

    const result = await loadConnectRouteData();

    expect(result).toEqual({
      hasBootstrapParams: true,
      initialError: "",
      initialInput: "space-id",
    });
    expect(mocks.verifySpace).not.toHaveBeenCalled();
    expect(currentURL()).toBe("/your-memory?foo=1#details");
  });

  it("auto-logins key params, replaces the active space, and strips them from the URL", async () => {
    mocks.getActiveSpaceId.mockReturnValue("space-old");
    mocks.verifySpace.mockResolvedValue({
      created_at: "",
      memory_count: 0,
      name: "space-new",
      provider: "unknown",
      status: "active",
      tenant_id: "space-new",
    });
    window.history.pushState({}, "", "/your-memory?key=space-new&foo=1#details");

    try {
      await loadConnectRouteData();
      throw new Error("Expected redirect");
    } catch (error) {
      expect(isRedirect(error)).toBe(true);
      if (isRedirect(error)) {
        expect(error.options).toMatchObject({
          replace: true,
          to: "/space",
        });
      }
    }

    expect(mocks.verifySpace).toHaveBeenCalledWith("space-new");
    expect(mocks.setSpaceId).toHaveBeenCalledWith("space-new", false);
    expect(currentURL()).toBe("/your-memory?foo=1#details");
  });

  it("returns the invalid-space copy when key auto-login fails", async () => {
    mocks.verifySpace.mockRejectedValue(new Error("unauthorized"));
    window.history.pushState({}, "", "/your-memory?key=bad-space");

    const result = await loadConnectRouteData();

    expect(result).toEqual({
      hasBootstrapParams: true,
      initialError: i18n.t("connect.error.invalid"),
      initialInput: "bad-space",
    });
    expect(mocks.setSpaceId).not.toHaveBeenCalled();
    expect(currentURL()).toBe("/your-memory");
  });
});

describe("ConnectPage", () => {
  it("shows bootstrap-prefilled input and does not auto-redirect an existing session", async () => {
    mocks.getActiveSpaceId.mockReturnValue("space-existing");
    setLoaderData({
      hasBootstrapParams: true,
      initialError: "",
      initialInput: "prefilled-space",
    });

    render(<ConnectPage />);

    expect(screen.getByDisplayValue("prefilled-space")).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.navigate).not.toHaveBeenCalled();
    });
  });

  it("auto-redirects existing sessions when there are no bootstrap params", async () => {
    mocks.getActiveSpaceId.mockReturnValue("space-existing");

    render(<ConnectPage />);

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({
        replace: true,
        to: "/space",
      });
    });
  });

  it("renders the loader-provided invalid error state", () => {
    setLoaderData({
      hasBootstrapParams: true,
      initialError: i18n.t("connect.error.invalid"),
      initialInput: "bad-space",
    });

    render(<ConnectPage />);

    expect(screen.getByDisplayValue("bad-space")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("connect.error.invalid"))).toBeInTheDocument();
  });
});
