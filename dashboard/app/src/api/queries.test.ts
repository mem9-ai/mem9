import { afterEach, describe, expect, it, vi } from "vitest";
import type { Memory, SessionMessage } from "@/types/memory";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn((options: unknown) => options),
  useMutation: vi.fn((options: unknown) => options),
  useInfiniteQuery: vi.fn((options: unknown) => options),
  invalidateQueries: vi.fn(),
  listMemories: vi.fn(),
  listSessionMessages: vi.fn(),
  exportMemories: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );

  return {
    ...actual,
    useQuery: (options: unknown) => mocks.useQuery(options),
    useMutation: (options: unknown) => mocks.useMutation(options),
    useInfiniteQuery: (options: unknown) => mocks.useInfiniteQuery(options),
    useQueryClient: () => ({
      invalidateQueries: mocks.invalidateQueries,
    }),
  };
});

vi.mock("./client", () => ({
  api: {
    listMemories: (...args: unknown[]) => mocks.listMemories(...args),
    listSessionMessages: (...args: unknown[]) => mocks.listSessionMessages(...args),
    exportMemories: (...args: unknown[]) => mocks.exportMemories(...args),
  },
}));

function createMemory(sessionID = ""): Memory {
  const timestamp = "2026-03-19T00:00:00Z";

  return {
    id: "mem-1",
    content: "memory",
    memory_type: "insight",
    source: "agent",
    tags: [],
    metadata: null,
    agent_id: "agent",
    session_id: sessionID,
    state: "active",
    version: 1,
    updated_by: "agent",
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function createMessage(
  id: string,
  createdAt: string,
  seq: number,
): SessionMessage {
  return {
    id,
    session_id: "sess-1",
    agent_id: "agent",
    source: "agent",
    seq,
    role: "user",
    content: id,
    content_type: "text/plain",
    tags: [],
    state: "active",
    created_at: createdAt,
    updated_at: createdAt,
  };
}

async function importQueriesModule() {
  vi.resetModules();
  return import("./queries");
}

describe("linked session helpers", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("derives linked-session presence from the session_id field only", async () => {
    const { getLinkedSessionID } = await importQueriesModule();
    const pinnedMemory: Memory = {
      ...createMemory("sess-2"),
      memory_type: "pinned",
    };

    expect(getLinkedSessionID(createMemory("  sess-1  "))).toBe("sess-1");
    expect(getLinkedSessionID(pinnedMemory)).toBe("sess-2");
    expect(getLinkedSessionID(createMemory(""))).toBe("");
    expect(getLinkedSessionID(null)).toBe("");
  });

  it("sorts session messages by created_at, seq, then id", async () => {
    const { sortSessionMessages } = await importQueriesModule();

    const messages = [
      createMessage("msg-3", "2026-03-19T00:00:01Z", 2),
      createMessage("msg-2", "2026-03-19T00:00:01Z", 1),
      createMessage("msg-1", "2026-03-19T00:00:00Z", 3),
      createMessage("msg-0", "2026-03-19T00:00:01Z", 2),
    ];

    expect(sortSessionMessages(messages).map((message) => message.id)).toEqual([
      "msg-1",
      "msg-2",
      "msg-0",
      "msg-3",
    ]);
  });
});

describe("useSelectedSessionMessages", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("requests selected-memory session messages with one retry and no explicit limit", async () => {
    mocks.listSessionMessages.mockResolvedValue({
      messages: [createMessage("msg-1", "2026-03-19T00:00:00Z", 1)],
    });

    const { useSelectedSessionMessages } = await importQueriesModule();
    useSelectedSessionMessages("space-1", createMemory(" sess-1 "));
    const options = mocks.useQuery.mock.calls[0]?.[0] as {
      enabled: boolean;
      retry: number;
      queryKey: string[];
      queryFn: (context: { signal: AbortSignal }) => Promise<SessionMessage[]>;
    };

    expect(mocks.useQuery).toHaveBeenCalledTimes(1);
    expect(options).toMatchObject({
      enabled: true,
      retry: 1,
      queryKey: ["space", "space-1", "sessionMessages", "sess-1"],
    });

    const controller = new AbortController();
    const messages = await options.queryFn({ signal: controller.signal });

    expect(mocks.listSessionMessages).toHaveBeenCalledWith(
      "space-1",
      {
        session_ids: ["sess-1"],
      },
      controller.signal,
    );
    expect(messages).toEqual([createMessage("msg-1", "2026-03-19T00:00:00Z", 1)]);
  });

  it("stays disabled when the selected memory has no linked session", async () => {
    const { useSelectedSessionMessages } = await importQueriesModule();
    useSelectedSessionMessages("space-1", createMemory(""));
    const options = mocks.useQuery.mock.calls[0]?.[0] as {
      enabled: boolean;
      retry: number;
      queryKey: string[];
    };

    expect(options).toMatchObject({
      enabled: false,
      retry: 1,
      queryKey: ["space", "space-1", "sessionMessages", ""],
    });
  });
});

describe("useExportMemories", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("exports without invalidating read-only space queries", async () => {
    const blob = new Blob(["{}"], { type: "application/json" });
    mocks.exportMemories.mockResolvedValue(blob);

    const { useExportMemories } = await importQueriesModule();
    const options = useExportMemories("space-1") as unknown as {
      mutationFn: () => Promise<Blob>;
      onSuccess?: () => void;
    };

    await expect(options.mutationFn()).resolves.toBe(blob);
    options.onSuccess?.();

    expect(mocks.exportMemories).toHaveBeenCalledWith("space-1");
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });
});

describe("useMemories", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("passes query cancellation to the memory provider", async () => {
    mocks.listMemories.mockResolvedValue({
      memories: [],
      total: 0,
      limit: 50,
      offset: 0,
    });

    const { useMemories } = await importQueriesModule();
    const options = useMemories("space-1", {}) as unknown as {
      queryFn: (context: {
        pageParam: number;
        signal: AbortSignal;
      }) => Promise<unknown>;
    };
    const controller = new AbortController();

    await options.queryFn({ pageParam: 0, signal: controller.signal });

    expect(mocks.listMemories).toHaveBeenCalledWith(
      "space-1",
      expect.objectContaining({ limit: 50, offset: 0 }),
      controller.signal,
    );
  });
});
