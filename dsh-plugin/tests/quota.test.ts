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
    return Promise.resolve({ value: "quota-test-key", source: "test" });
  }

  override describe(): Promise<{ configured: boolean; source: string; writable: boolean }> {
    return Promise.resolve({ configured: true, source: "test", writable: false });
  }

  override set(): Promise<void> { return Promise.reject(new Error("read only")); }
  override unset(): Promise<void> { return Promise.reject(new Error("read only")); }
}

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model });
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    const text = "ok";
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text };
    yield { type: "block-end", index: 0, block: { type: "text", text } };
    yield { type: "usage", usage: { inputTokens: 3, outputTokens: 1 } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

const quotaPayload = {
  error: "Included quota is exhausted.",
  details: {
    errorCategory: "runtime_quota_denied",
    runtimeQuota: {
      meter: "memory_recall_requests",
      retryAfterSeconds: 60,
      recommendedAction: {
        providerActionCode: "upgradePlan",
        type: "open_url",
        url: "https://mem9.ai/console/billing",
      },
    },
  },
};

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function quotaServer(): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(429, { "content-type": "application/json" });
    response.end(JSON.stringify(quotaPayload));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing test server address");
  return `http://127.0.0.1:${address.port}`;
}

describe("Mem9 runtime quota handling", () => {
  it("returns structured quota data from a user-invoked tool", async () => {
    const ctx = new Context();
    cleanups.push(() => ctx.fiber.dispose());
    await mountAgentLoopTestDependencies(ctx);
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(FixedCredentials);
    const agent = ctx.agentLoop.create(SessionId("quota-tool"), { provider: "mock", model: "mock" });
    await ctx.plugin({ name: "mem9-test", inject: ["agents", "tools", "credentials"], apply }, {
      apiUrl: await quotaServer(),
      recall: { enabled: false },
      ingest: { enabled: false },
    });

    const result = await ctx.tools.execute({
      callId: "quota-call" as never,
      name: "memory_search",
      arguments: { q: "preference" },
      agent,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      isError: false,
      value: {
        ok: false,
        error: "Included quota is exhausted.",
        status_code: 429,
        code: "runtime_quota_denied",
        quota: {
          code: "runtime_quota_denied",
          retryAfterSeconds: 60,
          recommendedAction: {
            providerActionCode: "upgradePlan",
            url: "https://mem9.ai/console/billing",
          },
        },
      },
    });
  });

  it("adds at most one durable quota notice to a session", async () => {
    const ctx = new Context();
    cleanups.push(() => ctx.fiber.dispose());
    await mountAgentLoopTestDependencies(ctx);
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(FixedCredentials);
    const adapter = new RecordingAdapter();
    ctx.llm.registerAdapter(["mock"], adapter);
    const agent = ctx.agentLoop.create(SessionId("quota-recall"), { provider: "mock", model: "mock" });
    await ctx.plugin({ name: "mem9-test", inject: ["agents", "tools", "credentials"], apply }, {
      apiUrl: await quotaServer(),
      ingest: { enabled: false },
    });

    await runFixtureTurn(ctx, { task: "Remember my preferred editor." });
    await runFixtureTurn(ctx, { task: "What is my preferred editor?" });

    const notices = agent.session.events.filter(event =>
      event.type === "user/message"
      && event.data.source.kind === "plugin"
      && event.data.source.plugin === "mem9"
      && event.data.source.form === "notice");
    expect(notices).toHaveLength(1);
    expect(adapter.requests[0]?.messages.some(message =>
      message.source.kind === "plugin" && message.source.plugin === "mem9" && message.source.form === "notice"))
      .toBe(true);
    expect(adapter.requests[1]?.messages.filter(message =>
      message.source.kind === "plugin" && message.source.plugin === "mem9" && message.source.form === "notice"))
      .toHaveLength(1);
  });
});
