import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryFarmPromoCard } from "./memory-farm-promo-card";

describe("MemoryFarmPromoCard", () => {
  it("renders a split CTA with a remembered-only new-tab option", async () => {
    const onAction = vi.fn();
    const { container } = render(
      <MemoryFarmPromoCard
        canOpenInNewTab
        href="/your-memory/labs/memory-farm"
        status="ready"
        onAction={onAction}
      />,
    );

    const cta = container.querySelector<HTMLButtonElement>(
      'button[data-mp-event="Dashboard/MemoryFarm/EnterClicked"]',
    );

    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute("data-mp-page-name", "space");
    expect(cta).toHaveAttribute("data-mp-entry-point", "promo-card");
    expect(cta).toHaveAttribute("data-mp-status", "ready");
    expect(screen.queryByText("New tab:")).not.toBeInTheDocument();

    fireEvent.click(cta!);
    expect(onAction).toHaveBeenCalledTimes(1);

    const menuTrigger = screen.getByRole("button", { name: "More options" });
    menuTrigger.focus();
    fireEvent.keyDown(menuTrigger, { key: "Enter" });

    const menuItem = await screen.findByRole("menuitem", {
      name: "Enter Farm in new tab",
    });

    expect(menuItem).toBeInTheDocument();
    expect(menuItem).toHaveAttribute("href", "/your-memory/labs/memory-farm");
    expect(menuItem).toHaveAttribute("target", "_blank");
    expect(menuItem).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(menuItem).toHaveAttribute("data-mp-page-name", "space");
    expect(menuItem).toHaveAttribute("data-mp-entry-point", "promo-card-menu");
    expect(menuItem).toHaveTextContent("Enter Farm");
    expect(menuItem).toHaveTextContent("(new tab)");
  });

  it("keeps a single current-tab CTA when new-tab access is unavailable", () => {
    render(
      <MemoryFarmPromoCard status="ready" onAction={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Enter Farm" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More options" })).not.toBeInTheDocument();
    expect(screen.queryByText("new tab")).not.toBeInTheDocument();
  });
});
