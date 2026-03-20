import { afterEach, describe, expect, it, vi } from "vitest";
import type { Memory } from "@/types/memory";

function createMemory(
  id: string,
  memoryType: Memory["memory_type"],
  sessionID = "",
): Memory {
  const timestamp = "2026-03-19T00:00:00Z";

  return {
    id,
    content: `memory-${id}`,
    memory_type: memoryType,
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

async function importQueriesModule() {
  vi.resetModules();
  return import("./queries");
}

describe("session preview lookup keys", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps pinned memories out of session preview lookups", async () => {
    vi.stubEnv("VITE_USE_MOCK", "true");
    vi.stubEnv("VITE_ENABLE_MOCK_SESSION_PREVIEW", "true");

    const { getSessionPreviewLookupKey } = await importQueriesModule();

    expect(
      getSessionPreviewLookupKey(createMemory("mem-full-mock", "pinned", "sess-2")),
    ).toBe("");
  });

  it("uses insight session ids when mock preview is enabled", async () => {
    vi.stubEnv("VITE_USE_MOCK", "false");
    vi.stubEnv("VITE_ENABLE_MOCK_SESSION_PREVIEW", "true");

    const { getSessionPreviewLookupKey } = await importQueriesModule();

    expect(
      getSessionPreviewLookupKey(createMemory("mem-insight", "insight", "sess-1")),
    ).toBe("sess-1");
    expect(
      getSessionPreviewLookupKey(createMemory("mem-no-session", "insight")),
    ).toBe("");
  });

  it("uses real insight session ids when mock preview is disabled", async () => {
    vi.stubEnv("VITE_USE_MOCK", "false");
    vi.stubEnv("VITE_ENABLE_MOCK_SESSION_PREVIEW", "false");

    const { getSessionPreviewLookupKey } = await importQueriesModule();

    expect(
      getSessionPreviewLookupKey(createMemory("mem-insight", "insight", "sess-real")),
    ).toBe("sess-real");
    expect(
      getSessionPreviewLookupKey(createMemory("mem-pinned", "pinned", "sess-pinned")),
    ).toBe("");
    expect(
      getSessionPreviewLookupKey(createMemory("mem-no-session", "insight")),
    ).toBe("");
  });
});
