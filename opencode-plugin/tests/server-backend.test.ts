import assert from "node:assert/strict";
import test from "node:test";

import { ServerBackend } from "../src/server/server-backend.js";
import { Mem9HttpError, parseRuntimeQuotaDenied } from "../src/server/quota-error.js";

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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ServerBackend fetches runtime-state through the public v1alpha2 path", async () => {
  const originalFetch = globalThis.fetch;
  let requestURL = "";
  let requestHeaders: Headers | undefined;

  globalThis.fetch = async (input, init) => {
    requestURL = String(input);
    requestHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ mem9ApiKey: { status: "active" }, meters: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const backend = new ServerBackend("https://api.mem9.ai", "mk_demo", "opencode");
    await backend.runtimeState();
    assert.equal(requestURL, "https://api.mem9.ai/v1alpha2/mem9s/runtime-state");
    assert.equal(requestHeaders?.get("X-API-Key"), "mk_demo");
    assert.equal(requestHeaders?.get("X-Mnemo-Agent-Id"), "opencode");
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

test("ServerBackend rejects malformed success JSON", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response("{", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const backend = new ServerBackend("https://api.mem9.ai", "mk_demo", "opencode");
    await assert.rejects(() => backend.search({ q: "hello" }), SyntaxError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ServerBackend preserves runtime quota denial response bodies", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
      error: "Included quota is exhausted.",
      details: {
        errorCategory: "runtime_quota_denied",
        runtimeQuota: {
          recommendedAction: {
            providerActionCode: "claimApiKey",
            type: "openUrl",
            url: "https://console.mem9.ai/console/claim?key=mem9_test",
          },
        },
      },
    }), {
      status: 402,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const backend = new ServerBackend("https://api.mem9.ai", "mk_demo", "opencode");
    await assert.rejects(
      () => backend.search({ q: "hello" }),
      (error: unknown) => {
        assert.equal(error instanceof Mem9HttpError, true);
        const denied = parseRuntimeQuotaDenied(error);
        assert.equal(denied?.code, "runtime_quota_denied");
        assert.equal(denied?.recommendedAction?.url, "https://console.mem9.ai/console/claim?key=mem9_test");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ServerBackend preserves post-quota rate limit response bodies", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
      error: "Post-quota rate limit exceeded.",
      details: {
        errorCategory: "runtime_quota_denied",
        runtimeQuota: {
          meter: "memory_recall_requests",
          quotaGateResult: {
            outcome: "rateLimited",
            mode: "postQuota",
            reason: "postQuotaRateLimitExceeded",
            postQuotaRateLimit: {
              requestsPerMinute: 4,
              windowDurationSeconds: 60,
              scope: "apiKeyMeter",
              retryAfterSeconds: 23,
            },
          },
        },
      },
    }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const backend = new ServerBackend("https://api.mem9.ai", "mk_demo", "opencode");
    await assert.rejects(
      () => backend.search({ q: "hello" }),
      (error: unknown) => {
        assert.equal(error instanceof Mem9HttpError, true);
        const denied = parseRuntimeQuotaDenied(error);
        assert.equal(denied?.code, "runtime_quota_denied");
        assert.equal(denied?.retryAfterSeconds, 23);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
