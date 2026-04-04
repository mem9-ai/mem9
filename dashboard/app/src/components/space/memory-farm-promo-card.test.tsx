import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryFarmPromoCard } from "./memory-farm-promo-card";

describe("MemoryFarmPromoCard", () => {
  it("renders a single CTA for ready state", () => {
    const onAction = vi.fn();
    const { container } = render(<MemoryFarmPromoCard status="ready" onAction={onAction} />);

    const cta = container.querySelector<HTMLButtonElement>(
      'button[data-mp-event="Dashboard/MemoryFarm/EnterClicked"]',
    );

    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute("data-mp-page-name", "space");
    expect(cta).toHaveAttribute("data-mp-entry-point", "promo-card");
    expect(cta).toHaveAttribute("data-mp-status", "ready");

    fireEvent.click(cta!);
    expect(onAction).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("button", { name: "Enter Farm" })).toBeInTheDocument();
  });
});
