import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_LOCAL_DERIVED_SIGNAL_INDEX,
  EMPTY_MEMORY_INSIGHT_GRAPH,
  EMPTY_MEMORY_INSIGHT_RELATION_GRAPH,
  useBackgroundDerivedSignals,
  useBackgroundMemoryInsightGraph,
  useBackgroundMemoryInsightRelationGraph,
} from "./memory-insight-background";
import type { LocalDerivedSignalIndex } from "@/lib/memory-derived-signals";
import type { Memory } from "@/types/memory";

const mocks = vi.hoisted(() => ({
  buildLocalDerivedSignalIndex: vi.fn(),
  buildMemoryInsightGraph: vi.fn(),
  buildMemoryInsightRelationGraph: vi.fn(),
}));

vi.mock("@/lib/memory-derived-signals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory-derived-signals")>();

  return {
    ...actual,
    buildLocalDerivedSignalIndex: mocks.buildLocalDerivedSignalIndex,
  };
});

vi.mock("@/lib/memory-insight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory-insight")>();

  return {
    ...actual,
    buildMemoryInsightGraph: mocks.buildMemoryInsightGraph,
  };
});

vi.mock("@/lib/memory-insight-relations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory-insight-relations")>();

  return {
    ...actual,
    buildMemoryInsightRelationGraph: mocks.buildMemoryInsightRelationGraph,
  };
});

function createMemories(count: number): Memory[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `mem-${index}`,
    content: `Memory ${index}`,
    memory_type: "insight",
    source: "agent",
    tags: ["dashboard"],
    metadata: {},
    agent_id: "agent-1",
    session_id: "session-1",
    state: "active",
    version: 1,
    updated_by: "agent-1",
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T00:00:00Z",
  }));
}

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

class FailingWorker {
  public static instances: FailingWorker[] = [];

  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public readonly terminate = vi.fn();

  public constructor() {
    FailingWorker.instances.push(this);
  }

  public postMessage(): void {
    queueMicrotask(() => {
      this.onerror?.({ message: "worker failed" } as ErrorEvent);
    });
  }
}

class PendingWorker {
  public static instances: PendingWorker[] = [];

  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public readonly terminate = vi.fn();

  public constructor() {
    PendingWorker.instances.push(this);
  }

  public postMessage(): void {}
}

class ControlledWorker {
  public static instances: ControlledWorker[] = [];

  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public readonly terminate = vi.fn(() => {
    this.onmessage = null;
    this.onerror = null;
  });
  private requestID: number | null = null;

  public constructor() {
    ControlledWorker.instances.push(this);
  }

  public postMessage(message: { id?: number }): void {
    if (typeof message.id === "number") {
      this.requestID = message.id;
    }
  }

  public complete(result: LocalDerivedSignalIndex): void {
    if (this.requestID === null) {
      throw new Error("Worker request is missing");
    }

    this.onmessage?.({
      data: {
        id: this.requestID,
        ok: true,
        result,
      },
    } as MessageEvent);
  }
}

class ConstructorFailingWorker {
  public constructor() {
    throw new Error("worker unavailable");
  }
}

describe("background insight computations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    ControlledWorker.instances = [];
    FailingWorker.instances = [];
    PendingWorker.instances = [];
  });

  it("returns the stable empty result without scanning memories when disabled", () => {
    const memories = createMemories(500);
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useBackgroundDerivedSignals({
          memories,
          matchMap: new Map(),
          enabled,
        }),
      {
        initialProps: { enabled: false },
      },
    );

    expect(result.current).toEqual({
      data: EMPTY_LOCAL_DERIVED_SIGNAL_INDEX,
      isComputing: false,
    });
    expect(result.current.data).toBe(EMPTY_LOCAL_DERIVED_SIGNAL_INDEX);
    expect(mocks.buildLocalDerivedSignalIndex).not.toHaveBeenCalled();

    rerender({ enabled: false });

    expect(result.current.data).toBe(EMPTY_LOCAL_DERIVED_SIGNAL_INDEX);
    expect(mocks.buildLocalDerivedSignalIndex).not.toHaveBeenCalled();
  });

  it("returns the stable empty graph without scanning memories when disabled", () => {
    const memories = createMemories(500);
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useBackgroundMemoryInsightGraph({
          cards: [],
          memories,
          matchMap: new Map(),
          enabled,
        }),
      {
        initialProps: { enabled: false },
      },
    );

    expect(result.current).toEqual({
      data: EMPTY_MEMORY_INSIGHT_GRAPH,
      isComputing: false,
    });
    expect(result.current.data).toBe(EMPTY_MEMORY_INSIGHT_GRAPH);
    expect(mocks.buildMemoryInsightGraph).not.toHaveBeenCalled();

    rerender({ enabled: false });

    expect(result.current.data).toBe(EMPTY_MEMORY_INSIGHT_GRAPH);
    expect(mocks.buildMemoryInsightGraph).not.toHaveBeenCalled();
  });

  it("keeps the empty result when the worker fails without scanning memories on the main thread", async () => {
    vi.stubGlobal("Worker", FailingWorker);
    const memories = createMemories(80);
    const matchMap = new Map();

    const { result, unmount } = renderHook(() =>
      useBackgroundDerivedSignals({
        memories,
        matchMap,
      }),
    );

    await waitFor(() => {
      expect(result.current).toEqual({
        data: EMPTY_LOCAL_DERIVED_SIGNAL_INDEX,
        isComputing: false,
      });
    });
    expect(mocks.buildLocalDerivedSignalIndex).not.toHaveBeenCalled();

    unmount();

    expect(FailingWorker.instances).toHaveLength(1);
    expect(FailingWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
  });

  it("keeps the empty result when worker construction fails", async () => {
    vi.stubGlobal("Worker", ConstructorFailingWorker);
    const memories = createMemories(80);
    const matchMap = new Map();

    const { result } = renderHook(() =>
      useBackgroundDerivedSignals({
        memories,
        matchMap,
      }),
    );

    await waitFor(() => {
      expect(result.current).toEqual({
        data: EMPTY_LOCAL_DERIVED_SIGNAL_INDEX,
        isComputing: false,
      });
    });
    expect(mocks.buildLocalDerivedSignalIndex).not.toHaveBeenCalled();
  });

  it("keeps the empty derived result for a large input when Worker is unavailable", () => {
    vi.stubGlobal("Worker", undefined);
    const memories = createMemories(80);

    const { result } = renderHook(() =>
      useBackgroundDerivedSignals({
        memories,
        matchMap: new Map(),
      }),
    );

    expect(result.current).toEqual({
      data: EMPTY_LOCAL_DERIVED_SIGNAL_INDEX,
      isComputing: false,
    });
    expect(result.current.data).toBe(EMPTY_LOCAL_DERIVED_SIGNAL_INDEX);
    expect(mocks.buildLocalDerivedSignalIndex).not.toHaveBeenCalled();
  });

  it("keeps the empty insight graph for a large input when Worker is unavailable", () => {
    vi.stubGlobal("Worker", undefined);
    const memories = createMemories(80);

    const { result } = renderHook(() =>
      useBackgroundMemoryInsightGraph({
        cards: [],
        memories,
        matchMap: new Map(),
      }),
    );

    expect(result.current).toEqual({
      data: EMPTY_MEMORY_INSIGHT_GRAPH,
      isComputing: false,
    });
    expect(result.current.data).toBe(EMPTY_MEMORY_INSIGHT_GRAPH);
    expect(mocks.buildMemoryInsightGraph).not.toHaveBeenCalled();
  });

  it("keeps the empty relation graph for a large input when Worker is unavailable", () => {
    vi.stubGlobal("Worker", undefined);
    const memories = createMemories(80);

    const { result } = renderHook(() =>
      useBackgroundMemoryInsightRelationGraph({
        cards: [],
        memories,
        matchMap: new Map(),
      }),
    );

    expect(result.current).toEqual({
      data: EMPTY_MEMORY_INSIGHT_RELATION_GRAPH,
      isComputing: false,
    });
    expect(result.current.data).toBe(EMPTY_MEMORY_INSIGHT_RELATION_GRAPH);
    expect(mocks.buildMemoryInsightRelationGraph).not.toHaveBeenCalled();
  });

  it("keeps synchronous computation for small inputs when Worker is unavailable", () => {
    vi.stubGlobal("Worker", undefined);
    const memories = createMemories(79);
    mocks.buildLocalDerivedSignalIndex.mockReturnValueOnce(
      EMPTY_LOCAL_DERIVED_SIGNAL_INDEX,
    );
    mocks.buildMemoryInsightGraph.mockReturnValueOnce(
      EMPTY_MEMORY_INSIGHT_GRAPH,
    );
    mocks.buildMemoryInsightRelationGraph.mockReturnValueOnce(
      EMPTY_MEMORY_INSIGHT_RELATION_GRAPH,
    );

    renderHook(() =>
      useBackgroundDerivedSignals({
        memories,
        matchMap: new Map(),
      }),
    );
    renderHook(() =>
      useBackgroundMemoryInsightGraph({
        cards: [],
        memories,
        matchMap: new Map(),
      }),
    );
    renderHook(() =>
      useBackgroundMemoryInsightRelationGraph({
        cards: [],
        memories,
        matchMap: new Map(),
      }),
    );

    expect(mocks.buildLocalDerivedSignalIndex).toHaveBeenCalledOnce();
    expect(mocks.buildMemoryInsightGraph).toHaveBeenCalledOnce();
    expect(mocks.buildMemoryInsightRelationGraph).toHaveBeenCalledOnce();
  });

  it("cancels only the unmounted computation while a concurrent worker completes", async () => {
    vi.stubGlobal("Worker", ControlledWorker);
    const memories = createMemories(80);
    const matchMap = new Map();
    const first = renderHook(() =>
      useBackgroundDerivedSignals({
        memories,
        matchMap,
      }),
    );
    const second = renderHook(() =>
      useBackgroundDerivedSignals({
        memories,
        matchMap,
      }),
    );

    expect(ControlledWorker.instances).toHaveLength(2);
    const [firstWorker, secondWorker] = ControlledWorker.instances;
    const firstSnapshot = first.result.current;

    first.unmount();

    expect(firstWorker?.terminate).toHaveBeenCalledOnce();
    expect(secondWorker?.terminate).not.toHaveBeenCalled();

    act(() => {
      firstWorker?.complete(createSignalIndex("stale"));
      secondWorker?.complete(createSignalIndex("current"));
    });

    await waitFor(() => {
      expect(second.result.current).toEqual({
        data: createSignalIndex("current"),
        isComputing: false,
      });
    });
    expect(first.result.current).toBe(firstSnapshot);
    expect(secondWorker?.terminate).toHaveBeenCalledOnce();

    second.unmount();

    expect(secondWorker?.terminate).toHaveBeenCalledOnce();
  });

  it("terminates the previous worker when the memory input switches", () => {
    vi.stubGlobal("Worker", PendingWorker);
    const firstMemories = createMemories(80);
    const secondMemories = createMemories(81);
    const matchMap = new Map();

    const { rerender, unmount } = renderHook(
      ({ memories }) =>
        useBackgroundDerivedSignals({
          memories,
          matchMap,
        }),
      {
        initialProps: { memories: firstMemories },
      },
    );

    expect(PendingWorker.instances).toHaveLength(1);

    rerender({ memories: secondMemories });

    expect(PendingWorker.instances).toHaveLength(2);
    expect(PendingWorker.instances[0]?.terminate).toHaveBeenCalledOnce();

    unmount();

    expect(PendingWorker.instances[1]?.terminate).toHaveBeenCalledOnce();
  });
});
