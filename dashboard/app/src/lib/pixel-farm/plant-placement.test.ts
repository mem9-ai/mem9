import { describe, expect, it } from "vitest";
import type { PixelFarmMemoryBucketState } from "@/lib/pixel-farm/data/types";
import type { PixelFarmFieldLayout } from "@/lib/pixel-farm/field-layout";
import { buildPixelFarmPlantPlacements } from "./plant-placement";

const mainField: PixelFarmFieldLayout = {
  kind: "main",
  cells: [
    { row: 16, column: 23 },
    { row: 16, column: 24 },
    { row: 16, column: 25 },
    { row: 17, column: 23 },
    { row: 17, column: 24 },
    { row: 17, column: 25 },
  ],
  bounds: {
    minRow: 16,
    maxRow: 17,
    minColumn: 23,
    maxColumn: 25,
  },
};

const eventField: PixelFarmFieldLayout = {
  kind: "event",
  cells: [
    { row: 19, column: 35 },
    { row: 19, column: 36 },
  ],
  bounds: {
    minRow: 19,
    maxRow: 19,
    minColumn: 35,
    maxColumn: 36,
  },
};

const interiorPriorityField: PixelFarmFieldLayout = {
  kind: "main",
  cells: [
    { row: 10, column: 10 },
    { row: 10, column: 11 },
    { row: 10, column: 12 },
    { row: 10, column: 13 },
    { row: 11, column: 10 },
    { row: 11, column: 11 },
    { row: 11, column: 12 },
    { row: 11, column: 13 },
    { row: 12, column: 10 },
    { row: 12, column: 11 },
    { row: 12, column: 12 },
    { row: 12, column: 13 },
    { row: 13, column: 10 },
    { row: 13, column: 11 },
    { row: 13, column: 12 },
    { row: 13, column: 13 },
  ],
  bounds: {
    minRow: 10,
    maxRow: 13,
    minColumn: 10,
    maxColumn: 13,
  },
};

const memoryBuckets: PixelFarmMemoryBucketState[] = [
  {
    id: "bucket-work",
    cropFamily: "crop-01",
    plantCapacity: 10,
    plantCount: 2,
    plants: [
      {
        id: "bucket-work-plant-0",
        cropStage: "mature",
        endIndexExclusive: 10,
        fillRatio: 1,
        memoryCount: 10,
        memoryIds: ["work-0"],
        startIndexInclusive: 0,
      },
      {
        id: "bucket-work-plant-1",
        cropStage: "seed",
        endIndexExclusive: 12,
        fillRatio: 0.2,
        memoryCount: 2,
        memoryIds: ["work-1"],
        startIndexInclusive: 10,
      },
    ],
    rank: 1,
    sortedMemoryIds: ["work-0", "work-1"],
    tagKey: "work",
    tagLabel: "Work",
    totalMemoryCount: 12,
  },
  {
    id: "bucket-life",
    cropFamily: "crop-02",
    plantCapacity: 10,
    plantCount: 1,
    plants: [
      {
        id: "bucket-life-plant-0",
        cropStage: "sprout",
        endIndexExclusive: 4,
        fillRatio: 0.4,
        memoryCount: 4,
        memoryIds: ["life-0"],
        startIndexInclusive: 0,
      },
    ],
    rank: 2,
    sortedMemoryIds: ["life-0"],
    tagKey: "life",
    tagLabel: "Life",
    totalMemoryCount: 4,
  },
];

describe("buildPixelFarmPlantPlacements", () => {
  it("places persistent plants only on mainField cells", () => {
    const placements = buildPixelFarmPlantPlacements({
      eventField,
      mainField,
      memoryBuckets,
    });

    expect(placements).toHaveLength(3);
    expect(placements.every((placement) => placement.fieldKind === "main")).toBe(true);
    expect(
      placements.map((placement) => `${placement.cell.row}:${placement.cell.column}`),
    ).not.toContain("19:35");
  });

  it("prefers interior cells for bucket anchors before using the field edge", () => {
    const placements = buildPixelFarmPlantPlacements({
      eventField,
      mainField: interiorPriorityField,
      memoryBuckets: [
        {
          ...memoryBuckets[0]!,
          plantCount: 1,
          plants: [memoryBuckets[0]!.plants[0]!],
        },
        {
          ...memoryBuckets[1]!,
          plantCount: 1,
          plants: [memoryBuckets[1]!.plants[0]!],
        },
      ],
    });

    expect(placements).toHaveLength(2);
    expect(placements.every((placement) => placement.cell.column > 10)).toBe(true);
    expect(placements.every((placement) => placement.cell.column < 13)).toBe(true);
    expect(placements.every((placement) => placement.cell.row > 10)).toBe(true);
    expect(placements.every((placement) => placement.cell.row < 13)).toBe(true);
  });

  it("falls back to edge cells only when the field has no interior capacity left", () => {
    const placements = buildPixelFarmPlantPlacements({
      eventField,
      mainField,
      memoryBuckets,
    });

    expect(placements).toHaveLength(3);
  });
});
