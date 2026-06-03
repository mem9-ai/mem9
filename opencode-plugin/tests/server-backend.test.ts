import assert from "node:assert/strict";
import test from "node:test";

import { ServerBackend } from "../src/server/server-backend.js";

async function withPatchedAbortSignalTimeout(
  run: (capturedTimeouts: number[]) => Promise<void>,
): Promise<void> {
  const capturedTimeouts: number[] = [];
  const originalDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");

  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    value(timeoutMs: number): AbortSignal {
      capturedTimeouts.push(timeoutMs);
      return new AbortController().signal;
    },
  });

  try {
    await run(capturedTimeouts);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(AbortSignal, "timeout", originalDescriptor);
    }
  }
}

test("ServerBackend uses X-API-Key and v1alpha2 paths", async () => {
  const originalFetch = globalThis.fetch;
  let requestURL = "";
  let requestHeaders: Headers | undefined;

  globalThis.fetch = async (input, init) => {
    requestURL = String(input);
    requestHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ memories: [], total: 0, limit: 10, offset: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const backend = new ServerBackend("https://api.mem9.ai", "mk_demo", "opencode");
    await backend.search({ q: "hello" });
    assert.equal(requestURL.includes("/v1alpha2/mem9s/memories"), true);
    assert.equal(requestHeaders?.get("X-API-Key"), "mk_demo");
    assert.equal(requestHeaders?.get("User-Agent"), "mem9-opencode-plugin/0.1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ServerBackend reports non-JSON HTTP errors clearly", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response("<html>forbidden</html>", {
    status: 403,
    headers: { "Content-Type": "text/html" },
  });

  try {
    const backend = new ServerBackend("https://api.mem9.ai", "mk_demo", "opencode");
    await assert.rejects(
      () => backend.store({ content: "saved" }),
      /HTTP 403: <html>forbidden<\/html>/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ServerBackend forwards memory_type in store body", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "memory-1", content: "saved" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const backend = new ServerBackend("https://api.mem9.ai", "mk_demo", "opencode");
    await backend.store({ content: "saved", memory_type: "pinned" });
    assert.deepEqual(requestBody, { content: "saved", memory_type: "pinned" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ServerBackend uses searchTimeoutMs for search and defaultTimeoutMs for writes", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    const body =
      method === "GET"
        ? { memories: [], total: 0, limit: 10, offset: 0 }
        : { id: "memory-1", content: "saved" };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await withPatchedAbortSignalTimeout(async (capturedTimeouts) => {
      const backend = new ServerBackend("https://api.mem9.ai", "mk_demo", "opencode", {
        defaultTimeoutMs: 11000,
        searchTimeoutMs: 16000,
      });

      await backend.search({ q: "hello" });
      await backend.store({ content: "saved" });

      assert.deepEqual(capturedTimeouts, [16000, 11000]);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
