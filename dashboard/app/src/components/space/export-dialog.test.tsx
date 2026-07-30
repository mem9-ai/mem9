import { render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";
import { ExportDialog } from "@/components/space/export-dialog";

describe("ExportDialog", () => {
  it("shows the number of pinned and insight memories in the export count", () => {
    const t = ((
      key: string,
      values?: Record<string, unknown>,
    ): string => {
      if (key === "export.count") {
        return `${String(values?.count)} exportable memories`;
      }
      return key;
    }) as unknown as TFunction;

    render(
      <ExportDialog
        open
        onOpenChange={vi.fn()}
        onExport={vi.fn().mockResolvedValue(undefined)}
        stats={{ total: 12, pinned: 2, insight: 3 }}
        loading={false}
        t={t}
      />,
    );

    expect(screen.getByText("5 exportable memories")).toBeInTheDocument();
  });
});
