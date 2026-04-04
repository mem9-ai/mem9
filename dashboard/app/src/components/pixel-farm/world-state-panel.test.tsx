import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PixelFarmWorldStatePanel } from "./world-state-panel";

describe("PixelFarmWorldStatePanel", () => {
  it("renders the new fields, buckets, and NPC summary", () => {
    render(
      <PixelFarmWorldStatePanel
        spaceId="space-1"
        worldQuery={{
          error: null,
          memoryById: {},
          resolveInteractionMemories: async () => [],
          status: "ready",
          worldState: {
            activeSpaceId: "space-1",
            fetchedAt: "2026-04-04T00:00:00.000Z",
            fields: {
              eventField: {
                kind: "event",
                cells: [{ row: 19, column: 35 }],
                bounds: {
                  minRow: 19,
                  maxRow: 19,
                  minColumn: 35,
                  maxColumn: 35,
                },
              },
              mainField: {
                kind: "main",
                cells: [{ row: 16, column: 23 }],
                bounds: {
                  minRow: 16,
                  maxRow: 16,
                  minColumn: 23,
                  maxColumn: 23,
                },
              },
            },
            memoryBuckets: [
              {
                id: "bucket-work",
                cropFamily: "crop-01",
                plantCapacity: 10,
                plantCount: 6,
                plants: [],
                rank: 1,
                sortedMemoryIds: [],
                tagKey: "work",
                tagLabel: "Work",
                totalMemoryCount: 52,
              },
            ],
            npcs: [{ id: "npc-cow-1", kind: "cow", position: null }],
            recentEvents: [],
            totalMemories: 69,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open World Snapshot" }));

    expect(screen.getByText("69 active memories")).toBeInTheDocument();
    expect(screen.getByText("Main field: 1 tiles")).toBeInTheDocument();
    expect(screen.getByText("Event field: 1 tiles")).toBeInTheDocument();
    expect(screen.getByText("52 memories, 6 plants")).toBeInTheDocument();
    expect(screen.getByText("NPCs: 1")).toBeInTheDocument();
  });
});
