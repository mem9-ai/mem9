import { describe, expect, it } from "vitest";
import { paginatePixelFarmDialogText } from "./ui-dialog-pagination";

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

describe("paginatePixelFarmDialogText", () => {
  it("keeps short text on one page", () => {
    const pages = paginatePixelFarmDialogText({
      text: "Short memory line.",
      maxLines: 4,
      measureLineCount: (value) => Math.ceil(value.length / 20),
    });

    expect(pages).toEqual(["Short memory line."]);
  });

  it("splits long text into multiple pages without dropping content", () => {
    const text =
      "First sentence is long enough to wrap. Second sentence keeps going. Third sentence closes the thought.";

    const pages = paginatePixelFarmDialogText({
      text,
      maxLines: 3,
      measureLineCount: (value) => Math.ceil(value.length / 18),
    });

    expect(pages.length).toBeGreaterThan(1);
    expect(normalize(pages.join(" "))).toBe(normalize(text));
  });

  it("falls back to word groups when a sentence is too long for one page", () => {
    const pages = paginatePixelFarmDialogText({
      text: "alpha beta gamma delta epsilon zeta eta theta iota kappa",
      maxLines: 2,
      measureLineCount: (value) => Math.ceil(value.length / 12),
    });

    expect(pages.length).toBeGreaterThan(1);
    expect(normalize(pages.join(" "))).toBe(
      "alpha beta gamma delta epsilon zeta eta theta iota kappa",
    );
  });
});
