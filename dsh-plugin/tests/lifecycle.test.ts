import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import { mountAgentLoopTestDependencies } from "@deepseek-ai/dsh-agent-loop-testkit";
import { CredentialProvider } from "@deepseek-ai/dsh-credentials";
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

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const toolNames = ["memory_store", "memory_search", "memory_get", "memory_update", "memory_delete"];

function mem9Tools(ctx: Context, agent: ReturnType<Context["agentLoop"]["create"]>): string[] {
  return ctx.tools.schemas(agent).map(schema => schema.name).filter(name => name.startsWith("memory_"));
}

describe("Mem9 agent lifecycle", () => {
  it("isolates subagents by default and cleans every scoped registration on unload", async () => {
    const ctx = new Context();
    cleanups.push(() => ctx.fiber.dispose());
    await mountAgentLoopTestDependencies(ctx);
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(FixedCredentials);
    const root = ctx.agentLoop.create(SessionId("lifecycle-root"), { provider: "mock", model: "mock" });
    const childHandle = await root.ctx.agents.create({
      sessionId: SessionId("lifecycle-child"),
      agentOptions: { provider: "mock", model: "mock" },
    });
    cleanups.push(() => childHandle.dispose());
    const child = childHandle.agent;

    const defaultFiber = await ctx.plugin({ name: "mem9-default", inject: ["agents", "tools", "credentials"], apply }, {
      recall: { enabled: false },
      ingest: { enabled: false },
    });
    expect(mem9Tools(ctx, root)).toEqual(toolNames);
    expect(mem9Tools(ctx, child)).toEqual([]);

    await defaultFiber.dispose();
    expect(mem9Tools(ctx, root)).toEqual([]);
    expect(mem9Tools(ctx, child)).toEqual([]);

    const allAgentsFiber = await ctx.plugin({ name: "mem9-all", inject: ["agents", "tools", "credentials"], apply }, {
      includeSubagents: true,
      recall: { enabled: false },
      ingest: { enabled: false },
    });
    expect(mem9Tools(ctx, root)).toEqual(toolNames);
    expect(mem9Tools(ctx, child)).toEqual(toolNames);

    const laterChildHandle = await root.ctx.agents.create({
      sessionId: SessionId("lifecycle-later-child"),
      agentOptions: { provider: "mock", model: "mock" },
    });
    cleanups.push(() => laterChildHandle.dispose());
    const laterChild = laterChildHandle.agent;
    expect(mem9Tools(ctx, laterChild)).toEqual(toolNames);

    await allAgentsFiber.dispose();
    expect(mem9Tools(ctx, root)).toEqual([]);
    expect(mem9Tools(ctx, child)).toEqual([]);
    expect(mem9Tools(ctx, laterChild)).toEqual([]);
  });
});
