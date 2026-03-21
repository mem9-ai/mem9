import { describe, expect, it } from "vitest";
import {
  filterLowSignalAggregationTags,
  isLowSignalAggregationTag,
} from "./tag-signals";

describe("tag-signals", () => {
  it("recognizes low-signal aggregation tags case-insensitively", () => {
    expect(isLowSignalAggregationTag("clawd")).toBe(true);
    expect(isLowSignalAggregationTag(" Local-Memory ")).toBe(true);
    expect(isLowSignalAggregationTag("JSON")).toBe(true);
    expect(isLowSignalAggregationTag("project-alpha")).toBe(false);
  });

  it("filters low-signal tags while preserving meaningful ones", () => {
    expect(
      filterLowSignalAggregationTags([
        "clawd",
        "import",
        "project-alpha",
        " Project-Alpha ",
        "md",
        "customer-sync",
      ]),
    ).toEqual(["project-alpha", "customer-sync"]);
  });
});
