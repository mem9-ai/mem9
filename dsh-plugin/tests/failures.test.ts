import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import { mountAgentLoopTestDependencies } from "@deepseek-ai/dsh-agent-loop-testkit";
import { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import { SessionId } from "@deepseek-ai/dsh-session";
import { apply } from "../src/index.js";

class OptionalCredentials extends CredentialProvider {
  constructor(ctx: Context, private readonly value?: string) {
    super(ctx);
  }

  override resolve(): Promise<{ value: string; source: string } | undefined> {
    return Promise.resolve(this.value === undefined ? undefined : { value: this.value, source: "test" });
  }

  override describe(): Promise<{ configured: boolean; source?: string; writable: boolean }> {
    return Promise.resolve({ configured: this.value !== undefined, ...(this.value === undefined ? {} : { source: "test" }), writable: false });
  }

  override set(): Promise<void> { return Promise.reject(new Error("read only")); }
  override unset(): Promise<void> { return Promise.reject(new Error("read only")); }
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function boot(apiUrl: string, credential?: string, searchTimeoutMs = 15_000): Promise<{
  ctx: Context;
  agent: ReturnType<Context["agentLoop"]["create"]>;
}> {
  const ctx = new Context();
  cleanups.push(() => ctx.fiber.dispose());
  await mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(OptionalCredentials, credential);
  const agent = ctx.agentLoop.create(SessionId(`failure-${cleanups.length}`), { provider: "mock", model: "mock" });
  await ctx.plugin({ name: "mem9-test", inject: ["agents", "tools", "credentials"], apply }, {
    apiUrl,
    searchTimeoutMs,
    recall: { enabled: false },
    ingest: { enabled: false },
  });
  return { ctx, agent };
}

async function search(ctx: Context, agent: ReturnType<Context["agentLoop"]["create"]>, q: string): Promise<unknown> {
  const result = await ctx.tools.execute({
    callId: `failure-${q}` as never,
    name: "memory_search",
    arguments: { q },
    agent,
    signal: new AbortController().signal,
  });
  expect(result.isError).toBe(false);
  return result.isError ? undefined : result.value;
}

describe("Mem9 fail-soft boundaries", () => {
  it("loads without a configured key and returns a safe tool error", async () => {
    const { ctx, agent } = await boot("https://api.mem9.invalid");
    await expect(search(ctx, agent, "missing-key")).resolves.toEqual({
      ok: false,
      error: "mem9 credential MEM9_API_KEY is not configured",
    });
  });

  it("normalizes HTTP, invalid JSON, and timeout failures without exposing the API key", async () => {
    const secret = "never-log-this-secret";
    const server = createServer((request, response) => {
      const query = new URL(request.url ?? "", "http://test").searchParams.get("q");
      if (query === "invalid-json") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("not-json");
        return;
      }
      if (query === "timeout") {
        setTimeout(() => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ memories: [], total: 0, limit: 20, offset: 0 }));
        }, 100);
        return;
      }
      const status = query === "unauthorized" ? 401
        : query === "forbidden" ? 403
          : query === "rate-limit" ? 429
            : 503;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: `fixture HTTP ${status}` }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    cleanups.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test server address");
    const apiUrl = `http://127.0.0.1:${address.port}`;
    const { ctx, agent } = await boot(apiUrl, secret, 1_000);

    for (const [query, expected] of [
      ["unauthorized", { ok: false, error: "fixture HTTP 401", status_code: 401 }],
      ["forbidden", { ok: false, error: "fixture HTTP 403", status_code: 403 }],
      ["rate-limit", { ok: false, error: "fixture HTTP 429", status_code: 429 }],
      ["server-error", { ok: false, error: "fixture HTTP 503", status_code: 503 }],
      ["invalid-json", { ok: false, error: "mem9 returned invalid JSON" }],
    ] as const) {
      const value = await search(ctx, agent, query);
      expect(value).toEqual(expected);
      expect(JSON.stringify(value)).not.toContain(secret);
    }
    const timeoutHarness = await boot(apiUrl, secret, 10);
    const timedOut = await search(timeoutHarness.ctx, timeoutHarness.agent, "timeout");
    expect(timedOut).toMatchObject({ ok: false });
    expect(JSON.stringify(timedOut)).not.toContain(secret);
  });

  it("rejects invalid self-contained configuration during plugin load", async () => {
    const ctx = new Context();
    cleanups.push(() => ctx.fiber.dispose());
    await mountAgentLoopTestDependencies(ctx);
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(OptionalCredentials, "key");
    await expect(ctx.plugin({ name: "mem9-test", inject: ["agents", "tools", "credentials"], apply }, {
      apiUrl: "file:///tmp/mem9",
    })).rejects.toThrow("apiUrl must use HTTP or HTTPS");
    await expect(ctx.plugin({ name: "mem9-test", inject: ["agents", "tools", "credentials"], apply }, {
      apiKeyEnv: "NOT-A-REF",
    })).rejects.toThrow("credential ref");
  });
});
