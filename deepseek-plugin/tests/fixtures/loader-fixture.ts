import { writeFile } from "node:fs/promises";
import type { Context } from "@deepseek-ai/cordis";
import { CallId, LlmAdapter } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from "@deepseek-ai/dsh-llm";

class Mem9FixtureAdapter extends LlmAdapter {
  private readonly requests: GenerateOptions[] = [];

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model });
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    await writeFile("loader-model-requests.json", JSON.stringify(this.requests), "utf8");
    if (process.env.MEM9_REPLAY_MODE === "1") {
      const reply = "Replay inspection completed.";
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "text-delta", index: 0, text: reply };
      yield { type: "block-end", index: 0, block: { type: "text", text: reply } };
      yield { type: "usage", usage: { inputTokens: 2, outputTokens: 2 } };
      yield { type: "finish", reason: { kind: "stop" } };
      return;
    }
    const toolResult = options.messages.at(-1)?.content.find(block => block.type === "tool-result");
    if (toolResult === undefined) {
      const args = JSON.stringify({ q: "editor", limit: 5 });
      yield { type: "block-start", index: 0, blockType: "tool-call" };
      yield { type: "tool-call-delta", index: 0, id: CallId("mem9-loader-search"), name: "memory_search", argumentsDelta: args };
      yield { type: "block-end", index: 0, block: { type: "tool-call", id: CallId("mem9-loader-search"), name: "memory_search", arguments: args } };
      yield { type: "usage", usage: { inputTokens: 8, outputTokens: 3 } };
      yield { type: "finish", reason: { kind: "tool-calls" } };
      return;
    }

    const reply = "Mem9 found the saved preference: Vim.";
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text: reply };
    yield { type: "block-end", index: 0, block: { type: "text", text: reply } };
    yield { type: "usage", usage: { inputTokens: 6, outputTokens: 4 } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

export const name = "mem9-loader-fixture";
export const inject = ["llm"];

export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(["mem9-fixture"], new Mem9FixtureAdapter());
}
