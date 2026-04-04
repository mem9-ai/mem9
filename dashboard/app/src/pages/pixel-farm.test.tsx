import "@/i18n";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PixelFarmPage } from "./pixel-farm";

const stageSpy = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/pixel-farm/phaser-stage", () => ({
  PhaserStage: (props: unknown) => {
    stageSpy(props);
    return <div data-testid="phaser-stage" />;
  },
}));

vi.mock("@/components/pixel-farm/actor-preview-panel", () => ({
  PixelFarmActorPreviewPanel: () => null,
}));

vi.mock("@/components/pixel-farm/feedback-dialog", () => ({
  PixelFarmFeedbackDialog: () => null,
}));

vi.mock("@/components/pixel-farm/front-target-panel", () => ({
  PixelFarmFrontTargetPanel: () => null,
}));

vi.mock("@/components/pixel-farm/pointer-coordinates-panel", () => ({
  PixelFarmPointerCoordinatesPanel: () => null,
}));

vi.mock("@/components/pixel-farm/world-state-panel", () => ({
  PixelFarmWorldStatePanel: () => null,
}));

vi.mock("@/lib/pixel-farm/create-game", () => ({
  createDefaultPixelFarmDebugState: () => ({
    direction: "down",
    playing: true,
    replayNonce: 0,
    state: "idle",
    type: "chicken",
    variant: "default",
    visible: false,
  }),
}));

vi.mock("@/lib/pixel-farm/data/use-pixel-farm-world", () => ({
  usePixelFarmWorld: () => ({
    error: null,
    memoryById: {},
    resolveInteractionMemories: async () => [],
    status: "ready",
    worldState: null,
  }),
}));

vi.mock("@/lib/pixel-farm/use-pixel-farm-npc-dialog-content", () => ({
  usePixelFarmNpcDialogContent: () => ({
    catalog: {
      deepInsights: [{
        id: "deep-1",
        source: "deep-analysis",
        templateKey: "persona-summary",
        text: "Moo test",
      }],
      lightInsights: [],
      tips: [],
    },
    deepReport: null,
    lightSnapshot: null,
  }),
}));

vi.mock("@/lib/session", () => ({
  getActiveSpaceId: () => "space-1",
}));

describe("PixelFarmPage", () => {
  it("passes npc dialog content into PhaserStage", () => {
    render(<PixelFarmPage />);

    expect(stageSpy).toHaveBeenCalled();
    expect(stageSpy.mock.calls[0]?.[0]).toMatchObject({
      npcDialogContent: {
        catalog: {
          deepInsights: [{ id: "deep-1" }],
        },
      },
    });
  });
});
