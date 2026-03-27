import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { PixelFarmFeedbackDialog } from "./feedback-dialog";

describe("PixelFarmFeedbackDialog", () => {
  it("adds Mixpanel metadata to the feedback trigger button", () => {
    const { container } = render(<PixelFarmFeedbackDialog />);

    const button = container.querySelector<HTMLButtonElement>(
      'button[data-mp-event="Dashboard/MemoryFarm/FeedbackOpenClicked"]',
    );

    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("data-mp-page-name", "memory-farm");

    fireEvent.click(button!);
    expect(screen.getByText(i18n.t("pixel_farm.feedback.title"))).toBeInTheDocument();
  });
});
