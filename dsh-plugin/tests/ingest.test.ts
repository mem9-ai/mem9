import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import { mountAgentLoopTestDependencies } from "@deepseek-ai/dsh-agent-loop-testkit";
import { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from "@deepseek-ai/dsh-llm";
import { runFixtureTurn } from "@deepseek-ai/dsh-loader-smoke";
import { SessionId } from "@deepseek-ai/dsh-session";
import { apply } from "../src/index.js";

class FixedCredentials extends CredentialProvider {
  override resolve(): Promise<{ value: string; source: string }> {
    return Promise.resolve({ value: "test-key", source: "test" });
  }

  override describe(): Promise<{ configured: boolean; source: string; writable: boolean }> {
    return Promise.resolve({ configured: true, source: "test", writable: false });
  }

  override set(): Promise<void> { return Promise.reject(new Error("read only")); }
  override unset(): Promise<void> { return Promise.reject(new Error("read only")); }
}

class FixedAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model });
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = "You prefer Vim.";
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text };
    yield { type: "block-end", index: 0, block: { type: "text", text } };
    yield { type: "usage", usage: { inputTokens: 10, outputTokens: 4 } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describe("automatic Mem9 ingest", () => {
  it("submits one smart ingest after a completed turn without delaying the turn", async () => {
    const received = Promise.withResolvers<unknown>();
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        received.resolve(JSON.parse(body));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "ok", memories_changed: 1 }));
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
    await ctx.plugin(FixedCredentials);
    ctx.llm.registerAdapter(["mock"], new FixedAdapter());
    ctx.agentLoop.create(SessionId("ingest-root"), { provider: "mock", model: "mock" });
    await ctx.plugin({ name: "mem9-test", inject: ["agents", "tools", "credentials"], apply }, {
      apiUrl: `http://127.0.0.1:${address.port}`,
      recall: { enabled: false },
    });

    const turn = await runFixtureTurn(ctx, { task: "Which editor do I prefer?" });
    expect(turn.output).toBe("You prefer Vim.");
    await expect(Promise.race([
      received.promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("ingest was not submitted")), 2_000)),
    ])).resolves.toEqual({
      messages: [
        { role: "user", content: "Which editor do I prefer?" },
        { role: "assistant", content: "You prefer Vim." },
      ],
      session_id: "ingest-root",
      agent_id: "deepseek-harness",
      mode: "smart",
    });
  });

  it("serializes consecutive turns and drains the queue during plugin unload", async () => {
    const bodies: unknown[] = [];
    let active = 0;
    let maxActive = 0;
    const twoReceived = Promise.withResolvers<void>();
    const server = createServer((request, response) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      let body = "";
      request.setEncoding("utf8");
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        bodies.push(JSON.parse(body));
        setTimeout(() => {
          active -= 1;
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ status: "ok" }));
          if (bodies.length === 2) twoReceived.resolve();
        }, 40);
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
    await ctx.plugin(FixedCredentials);
    ctx.llm.registerAdapter(["mock"], new FixedAdapter());
    ctx.agentLoop.create(SessionId("ingest-queue"), { provider: "mock", model: "mock" });
    const plugin = await ctx.plugin({ name: "mem9-test", inject: ["agents", "tools", "credentials"], apply }, {
      apiUrl: `http://127.0.0.1:${address.port}`,
      recall: { enabled: false },
    });

    await runFixtureTurn(ctx, { task: "first preference" });
    await runFixtureTurn(ctx, { task: "second preference" });
    const dispose = plugin.dispose();
    await expect(Promise.race([
      twoReceived.promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("queued ingest did not drain")), 2_000)),
    ])).resolves.toBeUndefined();
    await dispose;

    expect(maxActive).toBe(1);
    expect(bodies).toHaveLength(2);
    expect(bodies.map(body => (body as { messages: Array<{ content: string }> }).messages[0]?.content))
      .toEqual(["first preference", "second preference"]);
  });

  it("bounds unload when an ingest request does not complete", async () => {
    const requestStarted = Promise.withResolvers<void>();
    const server = createServer(request => {
      request.resume();
      request.on("end", () => requestStarted.resolve());
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
    await ctx.plugin(FixedCredentials);
    ctx.llm.registerAdapter(["mock"], new FixedAdapter());
    ctx.agentLoop.create(SessionId("ingest-timeout"), { provider: "mock", model: "mock" });
    const plugin = await ctx.plugin({ name: "mem9-test", inject: ["agents", "tools", "credentials"], apply }, {
      apiUrl: `http://127.0.0.1:${address.port}`,
      defaultTimeoutMs: 25,
      recall: { enabled: false },
    });

    await runFixtureTurn(ctx, { task: "do not hang on shutdown" });
    await requestStarted.promise;
    await expect(Promise.race([
      plugin.dispose(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("plugin unload hung")), 500)),
    ])).resolves.toBeUndefined();
  });
});
