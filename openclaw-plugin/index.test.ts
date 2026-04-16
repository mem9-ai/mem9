import assert from "node:assert/strict";
import test from "node:test";

import mnemoPlugin from "./index.js";

interface RegisteredTool {
  name: string;
  execute: (_id: string, params: unknown) => Promise<unknown>;
}

interface SearchCapability {
  search: (query: string, opts?: { limit?: number }) => Promise<{ data: unknown[]; total: number }>;
}

type HookHandler = (...args: unknown[]) => unknown;

interface StubApi {
  pluginConfig?: unknown;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  registerTool: (factory: unknown, _opts?: unknown) => void;
  registerCapability?: (slot: string, capability: unknown) => void;
  on: (...args: unknown[]) => void;
  getTools: (ctx?: { agentId?: string }) => RegisteredTool[];
  getHook: (name: string) => HookHandler;
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
  const hooks = new Map<string, HookHandler>();
  let toolFactory:
    | ((ctx?: { agentId?: string }) => RegisteredTool[] | RegisteredTool | null | undefined)
    | null = null;

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
    registerTool: (factory: unknown) => {
      toolFactory = factory as typeof toolFactory;
    },
    registerCapability: options?.onRegisterCapability,
    on: (hookName: unknown, handler: unknown) => {
      if (typeof hookName === "string" && typeof handler === "function") {
        hooks.set(hookName, handler as HookHandler);
      }
    },
    getTools: (ctx = {}) => {
      if (!toolFactory) {
        return [];
      }
      const tools = toolFactory(ctx);
      if (!tools) {
        return [];
      }
      return Array.isArray(tools) ? tools : [tools];
    },
    getHook: (name: string) => {
      const hook = hooks.get(name);
      if (!hook) {
        throw new Error(`missing hook: ${name}`);
      }
      return hook;
    },
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

test("register does not auto-provision on startup during create-new", async () => {
  const originalFetch = globalThis.fetch;
  const apiUrl = uniqueApiUrl("no-startup-provision");
  const requests: string[] = [];
  const infoLogs: string[] = [];
  const errorLogs: string[] = [];

  globalThis.fetch = async (input) => {
    requests.push(String(input));
    throw new Error("unexpected fetch");
  };

  try {
    mnemoPlugin.register(
      createStubApi(
        {
          apiUrl,
          provisionToken: "token-startup",
          provisionQueryParams: {
            utm_source: "bosn",
          },
        },
        { infoLogs, errorLogs },
      ),
    );

    await flushAsyncWork();

    assert.deepEqual(requests, []);
    assert.deepEqual(errorLogs, []);
    assert.equal(
      infoLogs.includes(
        "[mem9] apiKey not configured; waiting for the first post-restart message to finish create-new provision",
      ),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("memory capability stays idle until explicit provision runs", async () => {
  const originalFetch = globalThis.fetch;
  const apiUrl = uniqueApiUrl("pending-capability");
  let capability: SearchCapability | null = null;
  const requests: string[] = [];

  globalThis.fetch = async (input) => {
    requests.push(String(input));
    throw new Error("unexpected fetch");
  };

  try {
    mnemoPlugin.register(
      createStubApi(
        {
          apiUrl,
          provisionToken: "token-capability",
        },
        {
          onRegisterCapability: (_slot, registeredCapability) => {
            capability = registeredCapability as SearchCapability;
          },
        },
      ),
    );

    assert.notEqual(capability, null);

    const result = await capability!.search("hello");

    assert.deepEqual(result, { data: [], total: 0 });
    assert.deepEqual(requests, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("first post-restart prompt provisions once and unlocks memory access", async () => {
  const originalFetch = globalThis.fetch;
  const apiUrl = uniqueApiUrl("explicit-provision");
  let capability: SearchCapability | null = null;
  let provisionRequests = 0;
  let searchRequests = 0;

  globalThis.fetch = async (input, init) => {
    const url = String(input);

    if (url === `${apiUrl}/v1alpha1/mem9s?utm_source=bosn`) {
      provisionRequests += 1;
      return new Response(JSON.stringify({ id: "space-explicit" }), {
        status: 201,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (url.includes("/v1alpha2/mem9s/memories")) {
      searchRequests += 1;
      const headers = init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.["X-API-Key"], "space-explicit");

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
      const api = createStubApi(
      {
        apiUrl,
        provisionToken: "token-explicit",
        provisionQueryParams: {
          utm_source: "bosn",
        },
      },
      {
        onRegisterCapability: (_slot, registeredCapability) => {
          capability = registeredCapability as SearchCapability;
        },
      },
    );
    mnemoPlugin.register(api);

    const beforePromptBuild = api.getHook("before_prompt_build");
    const hookResult = await beforePromptBuild({ prompt: "hi" });

    assert.equal(hookResult, undefined);
    assert.equal(provisionRequests, 1);

    assert.notEqual(capability, null);
    const searchResult = await capability!.search("hello");

    assert.deepEqual(searchResult, { data: [], total: 0 });
    assert.equal(provisionRequests, 1);
    assert.equal(searchRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent first-post-restart prompts share one server request", async () => {
  const originalFetch = globalThis.fetch;
  const apiUrl = uniqueApiUrl("shared-explicit");
  let provisionRequests = 0;
  const provisionControl: { release: () => void } = {
    release: () => {},
  };
  const provisionGate = new Promise<void>((resolve) => {
    provisionControl.release = resolve;
  });

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url === `${apiUrl}/v1alpha1/mem9s`) {
      provisionRequests += 1;
      await provisionGate;
      return new Response(JSON.stringify({ id: "space-shared-explicit" }), {
        status: 201,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const pluginConfig = {
      apiUrl,
      provisionToken: "token-shared-explicit",
    };
    const apiA = createStubApi(pluginConfig);
    const apiB = createStubApi(pluginConfig);

    mnemoPlugin.register(apiA);
    mnemoPlugin.register(apiB);

    const hookA = apiA.getHook("before_prompt_build");
    const hookB = apiB.getHook("before_prompt_build");

    const promiseA = hookA({ prompt: "hi" });
    const promiseB = hookB({ prompt: "hi" });

    await waitFor(() => provisionRequests === 1);
    provisionControl.release();

    await promiseA;
    await promiseB;

    assert.equal(provisionRequests, 1);
  } finally {
    provisionControl.release();
    globalThis.fetch = originalFetch;
  }
});

test("a second setup retry reuses the locally persisted provisioned key before config write-back", async () => {
  const originalFetch = globalThis.fetch;
  const apiUrl = uniqueApiUrl("shared-retry");
  const infoLogsA: string[] = [];
  const infoLogsB: string[] = [];
  let provisionRequests = 0;
  let searchRequests = 0;

  globalThis.fetch = async (input, init) => {
    const url = String(input);

    if (url === `${apiUrl}/v1alpha1/mem9s`) {
      provisionRequests += 1;
      return new Response(JSON.stringify({ id: "space-shared-retry" }), {
        status: 201,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (url.includes("/v1alpha2/mem9s/memories")) {
      searchRequests += 1;
      const headers = init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.["X-API-Key"], "space-shared-retry");
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
    const pluginConfig = {
      apiUrl,
      provisionToken: "token-shared-retry",
    };

    const apiA = createStubApi(pluginConfig, { infoLogs: infoLogsA });
    mnemoPlugin.register(apiA);
    const firstHook = apiA.getHook("before_prompt_build");
    await firstHook({ prompt: "hi" });

    let capabilityB: SearchCapability | null = null;
    const apiB = createStubApi(pluginConfig, {
      infoLogs: infoLogsB,
      onRegisterCapability: (_slot, registeredCapability) => {
        capabilityB = registeredCapability as SearchCapability;
      },
    });
    mnemoPlugin.register(apiB);
    assert.notEqual(capabilityB, null);
    const secondResult = await capabilityB!.search("hello");

    assert.equal(provisionRequests, 1);
    assert.deepEqual(secondResult, { data: [], total: 0 });
    assert.equal(searchRequests, 1);
    assert.equal(
      infoLogsB.includes("[mem9] reusing locally persisted create-new API key for this provisionToken"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
