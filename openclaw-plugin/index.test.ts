import assert from "node:assert/strict";
import test from "node:test";

import mnemoPlugin from "./index.js";

interface StubApi {
  pluginConfig?: unknown;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  registerTool: () => void;
  registerCapability?: (slot: string, capability: unknown) => void;
  on: () => void;
}

interface SearchCapability {
  search: (query: string, opts?: { limit?: number }) => Promise<{ data: unknown[]; total: number }>;
}

function createStubApi(
  pluginConfig: unknown,
  options?: {
    onRegisterCapability?: (slot: string, capability: unknown) => void;
    infoLogs?: string[];
    errorLogs?: string[];
  },
): StubApi {
  const infoLogs = options?.infoLogs ?? [];
  const errorLogs = options?.errorLogs ?? [];

  return {
    pluginConfig,
    logger: {
      info: (...args: unknown[]) => {
        infoLogs.push(args.map(String).join(" "));
      },
      error: (...args: unknown[]) => {
        errorLogs.push(args.map(String).join(" "));
      },
    },
    registerTool: () => {},
    registerCapability: options?.onRegisterCapability,
    on: () => {},
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function uniqueApiUrl(name: string): string {
  return `https://api.mem9.ai/${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test("register eagerly auto-provisions when apiKey is absent", async () => {
  const originalFetch = globalThis.fetch;
  const apiUrl = uniqueApiUrl("eager");
  const requests: string[] = [];
  const infoLogs: string[] = [];
  const errorLogs: string[] = [];

  globalThis.fetch = async (input) => {
    requests.push(String(input));

    return new Response(JSON.stringify({ id: "space-1" }), {
      status: 201,
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

  try {
    mnemoPlugin.register(
      createStubApi(
        {
          apiUrl,
          provisionQueryParams: {
            utm_source: "bosn",
          },
        },
        { infoLogs, errorLogs },
      ),
    );

    await waitFor(() => requests.length === 1);

    assert.deepEqual(errorLogs, []);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0],
      `${apiUrl}/v1alpha1/mem9s?utm_source=bosn`,
    );
    assert.equal(
      infoLogs.includes("[mem9] apiKey not configured; starting auto-provision"),
      true,
    );
    assert.equal(
      infoLogs.some((msg) => msg.includes("*** Auto-provisioned apiKey=space-1 ***")),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("register shares an in-flight auto-provision across concurrent plugin registrations", async () => {
  const originalFetch = globalThis.fetch;
  const apiUrl = uniqueApiUrl("shared-pending");
  const infoLogsA: string[] = [];
  const infoLogsB: string[] = [];
  const errorLogs: string[] = [];
  let capabilityA: SearchCapability | null = null;
  let capabilityB: SearchCapability | null = null;
  let provisionRequests = 0;
  let searchRequests = 0;
  const provisionControl: { release: () => void } = {
    release: () => {},
  };
  const provisionGate = new Promise<void>((resolve) => {
    provisionControl.release = resolve;
  });

  globalThis.fetch = async (input, init) => {
    const url = String(input);

    if (url === `${apiUrl}/v1alpha1/mem9s`) {
      provisionRequests += 1;
      await provisionGate;
      return new Response(JSON.stringify({ id: "space-shared-pending" }), {
        status: 201,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (url.includes("/v1alpha2/mem9s/memories")) {
      searchRequests += 1;
      const headers = init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.["X-API-Key"], "space-shared-pending");

      return new Response(
        JSON.stringify({
          memories: [],
          total: 0,
          limit: 20,
          offset: 0,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    mnemoPlugin.register(
      createStubApi(
        { apiUrl },
        {
          infoLogs: infoLogsA,
          errorLogs,
          onRegisterCapability: (_slot, registeredCapability) => {
            capabilityA = registeredCapability as typeof capabilityA;
          },
        },
      ),
    );
    mnemoPlugin.register(
      createStubApi(
        { apiUrl },
        {
          infoLogs: infoLogsB,
          errorLogs,
          onRegisterCapability: (_slot, registeredCapability) => {
            capabilityB = registeredCapability as typeof capabilityB;
          },
        },
      ),
    );

    await waitFor(() => provisionRequests === 1);

    assert.equal(provisionRequests, 1);
    provisionControl.release();

    await waitFor(() => searchRequests === 0);

    assert.deepEqual(errorLogs, []);
    if (!capabilityA || !capabilityB) {
      throw new Error("capability registration did not complete");
    }

    const readyCapabilityA: SearchCapability = capabilityA;
    const readyCapabilityB: SearchCapability = capabilityB;

    await readyCapabilityA.search("hello");
    await readyCapabilityB.search("hello");

    assert.equal(provisionRequests, 1);
    assert.equal(searchRequests, 2);
  } finally {
    provisionControl.release();
    globalThis.fetch = originalFetch;
  }
});

test("register reuses a shared auto-provisioned key before config write-back", async () => {
  const originalFetch = globalThis.fetch;
  const apiUrl = uniqueApiUrl("shared-done");
  const infoLogsA: string[] = [];
  const infoLogsB: string[] = [];
  const errorLogs: string[] = [];
  let capabilityA: SearchCapability | null = null;
  let capabilityB: SearchCapability | null = null;
  let provisionRequests = 0;
  let searchRequests = 0;

  globalThis.fetch = async (input, init) => {
    const url = String(input);

    if (url === `${apiUrl}/v1alpha1/mem9s`) {
      provisionRequests += 1;
      return new Response(JSON.stringify({ id: "space-shared-done" }), {
        status: 201,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (url.includes("/v1alpha2/mem9s/memories")) {
      searchRequests += 1;
      const headers = init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.["X-API-Key"], "space-shared-done");

      return new Response(
        JSON.stringify({
          memories: [],
          total: 0,
          limit: 20,
          offset: 0,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    mnemoPlugin.register(
      createStubApi(
        { apiUrl },
        {
          infoLogs: infoLogsA,
          errorLogs,
          onRegisterCapability: (_slot, registeredCapability) => {
            capabilityA = registeredCapability as typeof capabilityA;
          },
        },
      ),
    );

    await waitFor(() =>
      infoLogsA.some((msg) => msg.includes("*** Auto-provisioned apiKey=space-shared-done ***")),
    );

    mnemoPlugin.register(
      createStubApi(
        { apiUrl },
        {
          infoLogs: infoLogsB,
          errorLogs,
          onRegisterCapability: (_slot, registeredCapability) => {
            capabilityB = registeredCapability as typeof capabilityB;
          },
        },
      ),
    );

    await waitFor(() =>
      infoLogsB.includes("[mem9] reusing shared auto-provisioned apiKey pending config write-back"),
    );

    assert.deepEqual(errorLogs, []);
    assert.equal(provisionRequests, 1);
    if (!capabilityA || !capabilityB) {
      throw new Error("capability registration did not complete");
    }

    const readyCapabilityA: SearchCapability = capabilityA;
    const readyCapabilityB: SearchCapability = capabilityB;

    await readyCapabilityA.search("hello");
    await readyCapabilityB.search("hello");

    assert.equal(searchRequests, 2);
    assert.equal(
      infoLogsB.includes("[mem9] reusing shared auto-provisioned apiKey pending config write-back"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("register does not auto-provision on empty config", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const infoLogs: string[] = [];
  const errorLogs: string[] = [];

  globalThis.fetch = async (input) => {
    requests.push(String(input));

    return new Response(JSON.stringify({ id: "space-unexpected" }), {
      status: 201,
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

  try {
    mnemoPlugin.register(
      createStubApi(
        {},
        { infoLogs, errorLogs },
      ),
    );

    await flushAsyncWork();

    assert.deepEqual(requests, []);
    assert.deepEqual(errorLogs, []);
    assert.equal(
      infoLogs.includes("[mem9] apiKey not configured; starting auto-provision"),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("search retries auto-provision after an eager startup failure", async () => {
  const originalFetch = globalThis.fetch;
  const apiUrl = uniqueApiUrl("retry");
  const infoLogs: string[] = [];
  const errorLogs: string[] = [];
  let provisionAttempts = 0;
  let searchRequests = 0;
  let capability: SearchCapability | null = null;

  globalThis.fetch = async (input, init) => {
    const url = String(input);

    if (url.includes("/v1alpha1/mem9s")) {
      provisionAttempts += 1;

      if (provisionAttempts === 1) {
        return new Response(JSON.stringify({ error: "boom" }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      return new Response(JSON.stringify({ id: "space-2" }), {
        status: 201,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (url.includes("/v1alpha2/mem9s/memories")) {
      searchRequests += 1;
      const headers = init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.["X-API-Key"], "space-2");

      return new Response(
        JSON.stringify({
          memories: [],
          total: 0,
          limit: 20,
          offset: 0,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    mnemoPlugin.register(
      createStubApi(
        { apiUrl },
        {
          infoLogs,
          errorLogs,
          onRegisterCapability: (_slot, registeredCapability) => {
            capability = registeredCapability as typeof capability;
          },
        },
      ),
    );

    await waitFor(() => provisionAttempts === 1);

    assert.equal(provisionAttempts, 1);
    assert.equal(
      errorLogs.some((msg) => msg.includes("auto-provision failed: mem9s provision failed (500):")),
      true,
    );
    assert.notEqual(capability, null);

    const result = await capability!.search("hello");

    assert.deepEqual(result, { data: [], total: 0 });
    assert.equal(provisionAttempts, 2);
    assert.equal(searchRequests, 1);
    assert.equal(
      infoLogs.some((msg) => msg.includes("*** Auto-provisioned apiKey=space-2 ***")),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
