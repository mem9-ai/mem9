import "@/i18n";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryFarmPromoCard } from "./memory-farm-promo-card";

describe("MemoryFarmPromoCard", () => {
  it("adds Mixpanel metadata to the CTA button", () => {
    const onAction = vi.fn();
    const { container } = render(
      <MemoryFarmPromoCard
        status="ready"
        onAction={onAction}
      />,
    );

    const button = container.querySelector<HTMLButtonElement>(
      'button[data-mp-event="Dashboard/MemoryFarm/EnterClicked"]',
    );

    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("data-mp-page-name", "space");
    expect(button).toHaveAttribute("data-mp-entry-point", "promo-card");
    expect(button).toHaveAttribute("data-mp-status", "ready");

    fireEvent.click(button!);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
