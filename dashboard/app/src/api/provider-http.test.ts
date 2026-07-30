import { afterEach, describe, expect, it, vi } from "vitest";

import { upsertCachedMemories } from "./local-cache";
import { httpProvider } from "./provider-http";

vi.mock("./local-cache", () => ({
  removeCachedMemory: vi.fn().mockResolvedValue(undefined),
  upsertCachedMemories: vi.fn().mockResolvedValue(undefined),
}));

describe("httpProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends space auth in X-API-Key instead of the request path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          memories: [],
          total: 7,
          limit: 1,
          offset: 0,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await httpProvider.verifySpace("space-1");

    expect(result.tenant_id).toBe("space-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    expect(url).toBe("/your-memory/api/memories?limit=1");
    expect(url).not.toContain("space-1");
    expect(headers.get("X-API-Key")).toBe("space-1");
    expect(headers.get("X-Mnemo-Agent-Id")).toBe("mem9-dashboard");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("posts manual creates to /memories with explicit pinned memory_type", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "mem-1",
          content: "Remember my coffee order",
          memory_type: "pinned",
          tags: ["preference", "coffee"],
          created_at: "2026-03-16T00:00:00Z",
          updated_at: "2026-03-16T00:00:00Z",
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await httpProvider.createMemory("space-1", {
      content: "Remember my coffee order",
      memory_type: "pinned",
      tags: ["preference", "coffee"],
    });

    expect(result.memory_type).toBe("pinned");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    expect(url).toBe("/your-memory/api/memories");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({
        content: "Remember my coffee order",
        memory_type: "pinned",
        tags: ["preference", "coffee"],
      }),
    );
    expect(headers.get("X-API-Key")).toBe("space-1");
    expect(headers.get("X-Mnemo-Agent-Id")).toBe("mem9-dashboard");
    expect(upsertCachedMemories).toHaveBeenCalledWith(
      "space-1",
      [expect.objectContaining({ id: "mem-1", memory_type: "pinned" })],
    );
  });

  it("rejects legacy accepted responses for manual creates and skips cache writes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "accepted",
        }),
        {
          status: 202,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      httpProvider.createMemory("space-1", {
        content: "Remember my coffee order",
        memory_type: "pinned",
      }),
    ).rejects.toThrow(
      "Manual add requires pinned-memory create support on the server.",
    );
    expect(upsertCachedMemories).not.toHaveBeenCalled();
  });

  it("uses the same fixed path for multipart imports and keeps auth in headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "task-1",
          tenant_id: "space-1",
          agent_id: "dashboard",
          file_name: "memories.json",
          file_type: "memory",
          status: "pending",
          total_count: 0,
          success_count: 0,
          error_message: "",
          created_at: "2026-03-16T00:00:00Z",
          updated_at: "2026-03-16T00:00:00Z",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await httpProvider.importMemories(
      "space-1",
      new File(["{}"], "memories.json", { type: "application/json" }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    expect(url).toBe("/your-memory/api/imports");
    expect(url).not.toContain("space-1");
    expect(headers.get("X-API-Key")).toBe("space-1");
    expect(headers.get("X-Mnemo-Agent-Id")).toBe("mem9-dashboard");
    expect(headers.has("Content-Type")).toBe(false);
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it("requests selected-memory session messages without an explicit limit", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [
            {
              id: "msg-1",
              session_id: "sess-1",
              agent_id: "agent",
              source: "agent",
              seq: 1,
              role: "user",
              content: "hello",
              content_type: "text/plain",
              tags: [],
              state: "active",
              created_at: "2026-03-16T00:00:00Z",
              updated_at: "2026-03-16T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await httpProvider.listSessionMessages("space-1", {
      session_ids: ["sess-1"],
    });

    expect(result.messages).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    expect(url).toBe("/your-memory/api/session-messages?session_id=sess-1");
    expect(headers.get("X-API-Key")).toBe("space-1");
    expect(headers.get("X-Mnemo-Agent-Id")).toBe("mem9-dashboard");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("returns an empty session-message result when the endpoint is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "not found",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await httpProvider.listSessionMessages("space-1", {
      session_ids: ["sess-1"],
      limit_per_session: 2,
    });

    expect(result).toEqual({ messages: [] });
  });

  it("exports more than 3000 pinned and insight memories", async () => {
    const memories = Array.from({ length: 3001 }, (_, index) => ({
      id: `mem-${index}`,
      content: `memory ${index}`,
      memory_type: index % 2 === 0 ? "pinned" : "insight",
      source: "agent",
      tags: [],
      metadata: null,
      agent_id: "agent",
      session_id: "",
      state: "active",
      version: 1,
      updated_by: "agent",
      created_at: "2026-03-16T00:00:00Z",
      updated_at: "2026-03-16T00:00:00Z",
    }));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input), "https://mem9.ai");
        const limit = Number(url.searchParams.get("limit"));
        const offset = Number(url.searchParams.get("offset"));
        const memoryType = url.searchParams.get("memory_type");
        if (memoryType !== "pinned,insight") {
          return new Response(
            JSON.stringify({
              error: "memory_type is required",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify({
            memories: memories.slice(offset, offset + limit),
            total: memories.length,
            limit,
            offset,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      });

    const result = await httpProvider.exportMemories("space-1");

    expect(result.memories).toHaveLength(3001);
    expect(new Set(result.memories.map((memory) => memory.memory_type))).toEqual(
      new Set(["pinned", "insight"]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(16);
    for (const [url] of fetchMock.mock.calls) {
      expect(
        new URL(String(url), "https://mem9.ai").searchParams.get(
          "memory_type",
        ),
      ).toBe("pinned,insight");
    }
  });
});
