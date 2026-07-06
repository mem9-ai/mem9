import assert from "node:assert/strict";
import test from "node:test";

import { ServerBackend } from "./server-backend.js";
import { Mem9HttpError, parseRuntimeQuotaDenied } from "./quota-error.js";

test("register forwards only utm_* params during create-new provision", async () => {
  const originalFetch = globalThis.fetch;
  let requestedURL = "";

  globalThis.fetch = async (input, init) => {
    requestedURL = String(input);
    assert.equal(init?.method, "POST");

    return new Response(JSON.stringify({ id: "space-1" }), {
      status: 201,
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

  try {
    const backend = new ServerBackend("https://api.mem9.ai", "", "agent-1", {
      provisionQueryParams: {
        utm_source: "bosn",
        foo: "bar",
        utm_campaign: "spring",
        utm_medium: "",
      },
    });

    const result = await backend.register();
    assert.equal(result.id, "space-1");

    const url = new URL(requestedURL);
    assert.equal(url.origin + url.pathname, "https://api.mem9.ai/v1alpha1/mem9s");
    assert.equal(url.searchParams.get("utm_source"), "bosn");
    assert.equal(url.searchParams.get("utm_campaign"), "spring");
    assert.equal(url.searchParams.has("foo"), false);
    assert.equal(url.searchParams.has("utm_medium"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normal memory requests do not append provision query params", async () => {
  const originalFetch = globalThis.fetch;
  let requestedURL = "";

  globalThis.fetch = async (input) => {
    requestedURL = String(input);

    return new Response(
      JSON.stringify({
        id: "mem-1",
        content: "remember this",
        created_at: "2026-04-05T00:00:00Z",
        updated_at: "2026-04-05T00:00:00Z",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const backend = new ServerBackend("https://api.mem9.ai", "space-key", "agent-1", {
      provisionQueryParams: {
        utm_source: "bosn",
      },
    });

    await backend.store({ content: "remember this" });

    assert.equal(requestedURL, "https://api.mem9.ai/v1alpha2/mem9s/memories");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normal memory requests reject malformed success JSON", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response("{", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const backend = new ServerBackend("https://api.mem9.ai", "space-key", "agent-1");
    await assert.rejects(() => backend.search({ q: "hello" }), SyntaxError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runtime quota denial response bodies are preserved", async () => {
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
    const backend = new ServerBackend("https://api.mem9.ai", "space-key", "agent-1");
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

test("post-quota rate limit response bodies are preserved", async () => {
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
    const backend = new ServerBackend("https://api.mem9.ai", "space-key", "agent-1");
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
