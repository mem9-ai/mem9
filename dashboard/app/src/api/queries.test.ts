import { afterEach, describe, expect, it, vi } from "vitest";
import type { Memory, SessionMessage } from "@/types/memory";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn((options: unknown) => options),
  listSessionMessages: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );

  return {
    ...actual,
    useQuery: (options: unknown) => mocks.useQuery(options),
  };
});

vi.mock("./client", () => ({
  api: {
    listSessionMessages: (...args: unknown[]) => mocks.listSessionMessages(...args),
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
      queryFn: () => Promise<SessionMessage[]>;
    };

    expect(mocks.useQuery).toHaveBeenCalledTimes(1);
    expect(options).toMatchObject({
      enabled: true,
      retry: 1,
      queryKey: ["space", "space-1", "sessionMessages", "sess-1"],
    });

    const messages = await options.queryFn();

    expect(mocks.listSessionMessages).toHaveBeenCalledWith("space-1", {
      session_ids: ["sess-1"],
    });
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
