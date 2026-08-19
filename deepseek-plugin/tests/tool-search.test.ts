import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import { mountAgentLoopTestDependencies } from "@deepseek-ai/dsh-agent-loop-testkit";
import { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import { apply } from "../src/index.js";

class TestCredentials extends CredentialProvider {
  private value = "first-key";

  setValue(value: string): void {
    this.value = value;
  }

  override resolve(): Promise<{ value: string; source: string }> {
    return Promise.resolve({ value: this.value, source: "test" });
  }

  override describe(): Promise<{ configured: boolean; source: string; writable: boolean }> {
    return Promise.resolve({ configured: true, source: "test", writable: true });
  }

  override set(): Promise<void> {
    return Promise.reject(new Error("not supported"));
  }

  override unset(): Promise<void> {
    return Promise.reject(new Error("not supported"));
  }
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describe("Mem9 tool surface", () => {
  it("searches through the public tool registry and resolves the credential per call", async () => {
    const requests: Array<{ authorization: string | undefined; url: string }> = [];
    const server = createServer((request, response) => {
      requests.push({ authorization: request.headers["x-api-key"] as string | undefined, url: request.url ?? "" });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        memories: [{ id: "m-1", content: "preferred editor is Vim", created_at: "2026-01-01", updated_at: "2026-01-01", score: 0.9 }],
        total: 1,
        limit: 20,
        offset: 0,
      }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    cleanups.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test server address");

    const ctx = new Context();
    cleanups.push(() => ctx.fiber.dispose());
    await mountAgentLoopTestDependencies(ctx);
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(TestCredentials);
    const agent = ctx.agentLoop.create(SessionId("root"), { provider: "mock", model: "mock" });
    await ctx.plugin({ name: "mem9-test", inject: ["agents", "tools", "credentials"], apply }, {
      apiUrl: `http://127.0.0.1:${address.port}`,
      apiKeyEnv: "MEM9_API_KEY",
      recall: { enabled: false },
      ingest: { enabled: false },
    });
    const credentials = ctx.credentials as TestCredentials;
    expect(ctx.tools.get("memory_search")).toBeUndefined();
    expect(ctx.tools.get("memory_search", agent)).toBeDefined();
    const first = await ctx.tools.execute({
      callId: "call-1" as never,
      name: "memory_search",
      arguments: { q: "editor" },
      agent,
      signal: new AbortController().signal,
    });
    credentials.setValue("rotated-key");
    await ctx.tools.execute({
      callId: "call-2" as never,
      name: "memory_search",
      arguments: { q: "editor" },
      agent,
      signal: new AbortController().signal,
    });

    expect(first).toMatchObject({ isError: false, value: { ok: true, total: 1 } });
    expect(requests).toEqual([
      { authorization: "first-key", url: "/v1alpha2/mem9s/memories?q=editor" },
      { authorization: "rotated-key", url: "/v1alpha2/mem9s/memories?q=editor" },
    ]);
  });

  it("exposes the five CRUD tools with stable success and not-found values", async () => {
    const calls: Array<{ method: string | undefined; url: string; body: unknown }> = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        calls.push({
          method: request.method,
          url: request.url ?? "",
          body: body.length === 0 ? undefined : JSON.parse(body),
        });
        if (request.url?.endsWith("/missing")) {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "not found" }));
          return;
        }
        if (request.method === "DELETE") {
          response.writeHead(204);
          response.end();
          return;
        }
        const content = request.method === "PUT" ? "updated preference" : "editor preference";
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          id: "m-1",
          content,
          tags: ["preference"],
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        }));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    cleanups.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test server address");

    const ctx = new Context();
    cleanups.push(() => ctx.fiber.dispose());
    await mountAgentLoopTestDependencies(ctx);
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(TestCredentials);
    const agent = ctx.agentLoop.create(SessionId("crud-root"), { provider: "mock", model: "mock" });
    await ctx.plugin({ name: "mem9-test", inject: ["agents", "tools", "credentials"], apply }, {
      apiUrl: `http://127.0.0.1:${address.port}`,
      recall: { enabled: false },
      ingest: { enabled: false },
    });

    expect(ctx.tools.schemas(agent).filter(schema => schema.name.startsWith("memory_")).map(schema => schema.name))
      .toEqual(["memory_store", "memory_search", "memory_get", "memory_update", "memory_delete"]);

    const execute = async (name: string, args: unknown, call: number): Promise<unknown> => {
      const result = await ctx.tools.execute({
        callId: `crud-${call}` as never,
        name,
        arguments: args,
        agent,
        signal: new AbortController().signal,
      });
      expect(result.isError).toBe(false);
      return result.isError ? undefined : result.value;
    };

    await expect(execute("memory_store", { content: "editor preference", tags: ["preference"] }, 1))
      .resolves.toMatchObject({ ok: true, data: { id: "m-1" } });
    await expect(execute("memory_get", { id: "m-1" }, 2))
      .resolves.toMatchObject({ ok: true, data: { content: "editor preference" } });
    await expect(execute("memory_update", { id: "m-1", content: "updated preference" }, 3))
      .resolves.toMatchObject({ ok: true, data: { content: "updated preference" } });
    await expect(execute("memory_delete", { id: "m-1" }, 4)).resolves.toEqual({ ok: true });
    await expect(execute("memory_get", { id: "missing" }, 5))
      .resolves.toEqual({ ok: false, error: "memory not found" });

    expect(calls).toEqual([
      {
        method: "POST",
        url: "/v1alpha2/mem9s/memories",
        body: { content: "editor preference", tags: ["preference"], memory_type: "pinned" },
      },
      { method: "GET", url: "/v1alpha2/mem9s/memories/m-1", body: undefined },
      { method: "PUT", url: "/v1alpha2/mem9s/memories/m-1", body: { content: "updated preference" } },
      { method: "DELETE", url: "/v1alpha2/mem9s/memories/m-1", body: undefined },
      { method: "GET", url: "/v1alpha2/mem9s/memories/missing", body: undefined },
    ]);
  });
});
