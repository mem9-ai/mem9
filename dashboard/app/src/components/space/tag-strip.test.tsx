import { fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";
import { TagStrip } from "./tag-strip";

const t = vi.fn((key: string, options?: Record<string, unknown>) => {
  if (options?.tag && options?.count) {
    return `${key}:${options.tag}:${options.count}`;
  }
  return key;
}) as unknown as TFunction;

describe("TagStrip", () => {
  it("renders only mixed origin badges for tag chips", () => {
    const onSelect = vi.fn();

    render(
      <TagStrip
        tags={[
          { tag: "OpenClaw", count: 4, origin: "derived" },
          { tag: "gateway", count: 3, origin: "mixed" },
          { tag: "manual-tag", count: 2, origin: "raw" },
        ]}
        onSelect={onSelect}
        t={t}
      />,
    );

    expect(screen.queryByText("tag_strip.derived_badge")).not.toBeInTheDocument();
    expect(screen.getByText("tag_strip.mixed_badge")).toBeInTheDocument();
    expect(screen.queryByText("raw")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "tag_strip.filter_label:gateway:3" }));
    expect(onSelect).toHaveBeenCalledWith("gateway");
  });
});
