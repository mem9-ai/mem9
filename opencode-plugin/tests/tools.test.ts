import assert from "node:assert/strict";
import test from "node:test";

import type { IngestInput, IngestResult, MemoryBackend } from "../src/server/backend.js";
import { Mem9HttpError } from "../src/server/quota-error.js";
import { buildTools } from "../src/server/tools.js";
import type {
  CreateMemoryInput,
  Memory,
  SearchInput,
  SearchResult,
  StoreResult,
  UpdateMemoryInput,
} from "../src/shared/types.js";

function quotaError(): Mem9HttpError {
  return new Mem9HttpError(
    "Spending limit is exhausted.",
    402,
    "",
    {
      error: "Spending limit is exhausted.",
      details: {
        errorCategory: "runtime_quota_denied",
        runtimeQuota: {
          recommendedAction: {
            providerActionCode: "increaseSpendingLimit",
            type: "openUrl",
            url: "https://console.mem9.ai/console/billing/plan",
          },
        },
      },
    },
  );
}

function createBackend(): MemoryBackend {
  return {
    async store(_input: CreateMemoryInput): Promise<StoreResult> {
      throw quotaError();
    },
    async search(_input: SearchInput): Promise<SearchResult> {
      throw quotaError();
    },
    async get(_id: string): Promise<Memory | null> {
      throw quotaError();
    },
    async update(_id: string, _input: UpdateMemoryInput): Promise<Memory | null> {
      throw quotaError();
    },
    async remove(_id: string): Promise<boolean> {
      throw quotaError();
    },
    async listRecent(_limit: number): Promise<Memory[]> {
      return [];
    },
    async ingest(_input: IngestInput): Promise<IngestResult> {
      return { status: "ok" };
    },
    async runtimeState(): Promise<unknown> {
      return null;
    },
  };
}

test("memory tools return structured runtime quota denial payloads", async () => {
  const tools = buildTools(createBackend()) as unknown as Record<
    string,
    { execute(args: Record<string, unknown>, context?: unknown): Promise<unknown> }
  >;
  const output = await tools.memory_search.execute({ q: "theme" });
  assert.equal(typeof output, "string");

  const parsed = JSON.parse(output as string);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "runtime_quota_denied");
  assert.equal(parsed.status_code, 402);
  assert.equal(parsed.action_url, "https://console.mem9.ai/console/billing/plan");
  assert.deepEqual(parsed.quota.recommendedAction, {
    providerActionCode: "increaseSpendingLimit",
    type: "openUrl",
    url: "https://console.mem9.ai/console/billing/plan",
  });
});
