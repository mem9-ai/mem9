import { describe, expect, it } from "vitest";
import {
  derivePixelFarmFieldLayouts,
  type PixelFarmFieldCell,
} from "./field-layout";

describe("derivePixelFarmFieldLayouts", () => {
  it("assigns the largest tilled component to mainField and the second largest to eventField", () => {
    const cells: PixelFarmFieldCell[] = [
      { row: 16, column: 23 },
      { row: 16, column: 24 },
      { row: 16, column: 25 },
      { row: 17, column: 23 },
      { row: 17, column: 24 },
      { row: 17, column: 25 },
      { row: 19, column: 35 },
      { row: 19, column: 36 },
      { row: 20, column: 35 },
    ];

    const fields = derivePixelFarmFieldLayouts(cells);

    expect(fields.mainField.cells).toHaveLength(6);
    expect(fields.mainField.bounds).toEqual({
      minRow: 16,
      maxRow: 17,
      minColumn: 23,
      maxColumn: 25,
    });
    expect(fields.eventField?.cells).toHaveLength(3);
    expect(fields.eventField?.bounds).toEqual({
      minRow: 19,
      maxRow: 20,
      minColumn: 35,
      maxColumn: 36,
    });
  });
});
