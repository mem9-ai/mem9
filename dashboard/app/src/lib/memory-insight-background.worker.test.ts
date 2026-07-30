import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalDerivedSignalIndex } from "@/lib/memory-derived-signals";

const mocks = vi.hoisted(() => ({
  buildLocalDerivedSignalIndex: vi.fn(),
}));

vi.mock("@/lib/memory-derived-signals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory-derived-signals")>();

  return {
    ...actual,
    buildLocalDerivedSignalIndex: mocks.buildLocalDerivedSignalIndex,
  };
});

function createSignalIndex(value: string): LocalDerivedSignalIndex {
  return {
    derivedTagsByMemoryId: new Map(),
    combinedTagsByMemoryId: new Map(),
    tagStats: [
      {
        value,
        normalizedValue: value,
        count: 1,
        origin: "derived",
      },
    ],
    tagSourceByValue: new Map(),
  };
}

describe("memory insight worker result cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("retains only the current result and releases it on request", async () => {
    const responses: Array<{ result?: LocalDerivedSignalIndex }> = [];
    vi.stubGlobal("postMessage", (response: { result?: LocalDerivedSignalIndex }) => {
      responses.push(response);
    });
    mocks.buildLocalDerivedSignalIndex
      .mockReturnValueOnce(createSignalIndex("first-a"))
      .mockReturnValueOnce(createSignalIndex("b"))
      .mockReturnValueOnce(createSignalIndex("second-a"))
      .mockReturnValueOnce(createSignalIndex("released-a"));

    await import("./memory-insight-background.worker");

    const send = (id: number, memoryID: string) => {
      self.onmessage?.({
        data: {
          id,
          type: "derived-signals",
          payload: {
            memories: [
              {
                id: memoryID,
                content: memoryID,
                created_at: "2026-07-30T00:00:00Z",
                updated_at: "2026-07-30T00:00:00Z",
                tags: [],
              },
            ],
            matches: [],
          },
        },
      } as MessageEvent);
    };

    send(1, "a");
    send(2, "b");
    send(3, "a");
    self.onmessage?.({
      data: {
        type: "release-cache",
        target: "derived-signals",
      },
    } as MessageEvent);
    send(4, "a");

    expect(mocks.buildLocalDerivedSignalIndex).toHaveBeenCalledTimes(4);
    expect(
      responses.flatMap((response) =>
        response.result ? [response.result.tagStats[0]?.value] : [],
      ),
    ).toEqual([
      "first-a",
      "b",
      "second-a",
      "released-a",
    ]);
  });
});
