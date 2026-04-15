import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectPage } from "./connect";

const mocks = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
  getActiveSpaceId: vi.fn(),
  initMixpanelOnLogin: vi.fn(),
  navigate: vi.fn(),
  setSpaceId: vi.fn(),
  trackMixpanelEvent: vi.fn(),
  verifySpace: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: {
      changeLanguage: mocks.changeLanguage,
      language: "en",
    },
    t: (key: string) => key,
  }),
}));

vi.mock("@/api/client", () => ({
  api: {
    verifySpace: mocks.verifySpace,
  },
}));

vi.mock("@/lib/mixpanel", () => ({
  initMixpanelOnLogin: mocks.initMixpanelOnLogin,
  trackMixpanelEvent: mocks.trackMixpanelEvent,
}));

vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>(
    "@/lib/session",
  );

  return {
    ...actual,
    getActiveSpaceId: mocks.getActiveSpaceId,
    setSpaceId: mocks.setSpaceId,
  };
});

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

describe("ConnectPage", () => {
  beforeEach(() => {
    mocks.changeLanguage.mockReset();
    mocks.getActiveSpaceId.mockReset();
    mocks.initMixpanelOnLogin.mockReset();
    mocks.navigate.mockReset();
    mocks.setSpaceId.mockReset();
    mocks.trackMixpanelEvent.mockReset();
    mocks.verifySpace.mockReset();

    Object.defineProperty(window, "opener", {
      configurable: true,
      value: null,
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prioritizes opener handoff over an existing active space", async () => {
    const opener = { postMessage: vi.fn() } as unknown as Window;
    mocks.getActiveSpaceId.mockReturnValue("space-old");
    mocks.verifySpace.mockResolvedValue({ id: "space-new" });

    Object.defineProperty(window, "opener", {
      configurable: true,
      value: opener,
      writable: true,
    });

    render(<ConnectPage />);

    await waitFor(() => {
      expect(opener.postMessage).toHaveBeenCalledWith(
        { type: "mem9-connect-ready" },
        "*",
      );
    });

    expect(mocks.navigate).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          spaceId: "space-new",
          type: "mem9-space-handoff",
        },
        source: opener,
      }),
    );

    await waitFor(() => {
      expect(mocks.verifySpace).toHaveBeenCalledWith("space-new");
    });

    await waitFor(() => {
      expect(mocks.setSpaceId).toHaveBeenCalledWith("space-new", false);
      expect(mocks.navigate).toHaveBeenCalledWith({
        replace: true,
        to: "/space",
      });
    });
  });

  it("redirects straight to space when opened directly with an active session", async () => {
    mocks.getActiveSpaceId.mockReturnValue("space-existing");

    render(<ConnectPage />);

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({
        replace: true,
        to: "/space",
      });
    });
  });

  it("submits typed space ids through the same connect flow", async () => {
    mocks.verifySpace.mockResolvedValue({ id: "space-form" });

    render(<ConnectPage />);

    fireEvent.change(screen.getByPlaceholderText("connect.placeholder"), {
      target: { value: "space-form" },
    });
    fireEvent.click(screen.getByRole("button", { name: "connect.submit" }));

    await waitFor(() => {
      expect(mocks.verifySpace).toHaveBeenCalledWith("space-form");
    });

    await waitFor(() => {
      expect(mocks.setSpaceId).toHaveBeenCalledWith("space-form", false);
      expect(mocks.navigate).toHaveBeenCalledWith({
        replace: true,
        to: "/space",
      });
    });
  });
});
