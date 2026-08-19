import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import { mountAgentLoopTestDependencies } from "@deepseek-ai/dsh-agent-loop-testkit";
import { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from "@deepseek-ai/dsh-llm";
import { runFixtureTurn } from "@deepseek-ai/dsh-loader-smoke";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { apply } from "../src/index.js";

const apiKey = process.env.MEM9_API_KEY;
const apiUrl = process.env.MEM9_API_URL ?? "https://api.mem9.ai";

class LiveCredentials extends CredentialProvider {
  override resolve(): Promise<{ value: string; source: string } | undefined> {
    return Promise.resolve(apiKey === undefined ? undefined : { value: apiKey, source: "env" });
  }

  override describe(): Promise<{ configured: boolean; source?: string; writable: boolean }> {
    return Promise.resolve({ configured: apiKey !== undefined, ...(apiKey === undefined ? {} : { source: "env" }), writable: false });
  }

  override set(): Promise<void> { return Promise.reject(new Error("read only")); }
  override unset(): Promise<void> { return Promise.reject(new Error("read only")); }
}

class LiveTurnAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];

  constructor(private readonly reply: string) { super(); }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model });
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text: this.reply };
    yield { type: "block-end", index: 0, block: { type: "text", text: this.reply } };
    yield { type: "usage", usage: { inputTokens: 5, outputTokens: 5 } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

describe.skipIf(apiKey === undefined)("Mem9 live API", () => {
  let ctx: Context;
  let agent: Agent;
  const createdIds = new Set<string>();

  beforeAll(async () => {
    ctx = new Context();
    await mountAgentLoopTestDependencies(ctx);
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(LiveCredentials);
    agent = ctx.agentLoop.create(SessionId(`mem9-live-${randomUUID()}`), { provider: "live-test", model: "live-test" });
    await ctx.plugin({ name: "mem9-live", inject: ["agents", "tools", "credentials"], apply }, {
      apiUrl,
    });
  });

  afterAll(async () => {
    await Promise.allSettled([...createdIds].map(id => execute("memory_delete", { id })));
    await ctx.fiber.dispose();
  });

  async function execute(name: string, args: unknown): Promise<Record<string, unknown>> {
    const result = await ctx.tools.execute({
      callId: randomUUID() as never,
      name,
      arguments: args,
      agent,
      signal: new AbortController().signal,
    });
    if (result.isError) throw new Error(result.error.message);
    return result.value as Record<string, unknown>;
  }

  it("completes store, search, get, update, and delete against the hosted API", async () => {
    const marker = `dsh-live-${randomUUID()}`;
    const stored = await execute("memory_store", {
      content: `DeepSeek Harness live test memory ${marker}`,
      tags: ["dsh-live-test", marker],
      source: "deepseek-harness-live-test",
    });
    expect(stored.ok).toBe(true);
    const data = stored.data as { id?: unknown };
    expect(typeof data.id).toBe("string");
    const createdId = data.id as string;
    createdIds.add(createdId);

    const searched = await execute("memory_search", { q: marker, limit: 10 });
    expect(searched.ok).toBe(true);
    expect((searched.memories as Array<{ id: string }>).some(memory => memory.id === createdId)).toBe(true);

    const fetched = await execute("memory_get", { id: createdId });
    expect(fetched).toMatchObject({ ok: true, data: { id: createdId } });

    const updated = await execute("memory_update", { id: createdId, content: `Updated ${marker}` });
    expect(updated).toMatchObject({ ok: true, data: { id: createdId, content: `Updated ${marker}` } });

    const deleted = await execute("memory_delete", { id: createdId });
    expect(deleted).toEqual({ ok: true });
    createdIds.delete(createdId);

    const recallMarker = `dsh-recall-${randomUUID()}`;
    const assistantMarker = `dsh-ingest-${randomUUID()}`;
    const recallStored = await execute("memory_store", { content: `Recall marker ${recallMarker}` });
    const recallId = (recallStored.data as { id: string }).id;
    createdIds.add(recallId);
    const adapter = new LiveTurnAdapter(`Assistant marker ${assistantMarker}`);
    ctx.llm.registerAdapter(["live-test"], adapter);

    await runFixtureTurn(ctx, { task: `Recall ${recallMarker}` });
    expect(adapter.requests[0]?.messages.some(message =>
      message.source.kind === "plugin" && message.source.plugin === "mem9"
      && message.content.some(block => block.type === "text" && block.text.includes(recallMarker))))
      .toBe(true);

    let ingested: Array<{ id: string }> = [];
    for (let attempt = 0; attempt < 10 && ingested.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const result = await execute("memory_search", { q: assistantMarker, limit: 20 });
      ingested = (result.memories as Array<{ id: string; content?: string }>).filter(memory => memory.content?.includes(assistantMarker));
    }
    expect(ingested.length).toBeGreaterThan(0);
    for (const memory of ingested) createdIds.add(memory.id);
  });
});
