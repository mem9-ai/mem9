import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryCompositionChart } from "./memory-composition-chart";

describe("MemoryCompositionChart", () => {
  it("shortens dotted analysis labels while preserving the full value in hover metadata", () => {
    const onTypeSelect = vi.fn();

    render(
      <MemoryCompositionChart
        total={1400}
        outer={[
          {
            key: "insight",
            labelKey: "space.stats.insight",
            value: 1400,
            ratio: 1,
            colorToken: "--type-insight",
            memoryType: "insight",
          },
        ]}
        inner={[
          {
            key: "analysis.category.project",
            labelKey: "analysis.category.project",
            value: 1400,
            ratio: 1,
            colorToken: "--facet-other",
          },
        ]}
        innerKind="analysis"
        onTypeSelect={onTypeSelect}
      />,
    );

    const projectLegend = screen.getByRole("button", { name: /Project/i });
    expect(projectLegend).toHaveAttribute("title", "analysis.category.project");

    fireEvent.mouseEnter(projectLegend);
    expect(screen.getAllByText("Project")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: /analysis\.category\.project/i }),
    ).not.toBeInTheDocument();
  });
});
