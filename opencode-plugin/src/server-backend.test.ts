import assert from "node:assert/strict";
import test from "node:test";

import { ServerBackend } from "./server-backend.js";

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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
