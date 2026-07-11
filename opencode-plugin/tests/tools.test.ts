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

function createSuccessBackend(): MemoryBackend {
  return {
    async store(_input: CreateMemoryInput): Promise<StoreResult> {
      return {
        id: "memory-1",
        content: "saved",
        created_at: "2026-04-21T00:00:00.000Z",
        updated_at: "2026-04-21T00:00:00.000Z",
        message: "mem9 memory saving has used 80% of included quota.",
      };
    },
    async search(_input: SearchInput): Promise<SearchResult> {
      return {
        memories: [],
        total: 0,
        limit: 10,
        offset: 0,
        runtimeState: {
          mem9ApiKey: { status: "active" },
          meters: [
            {
              meter: "memory_recall_requests",
              budgets: [
                {
                  type: "includedQuota",
                  state: "warning",
                  usage: { percent: 82, remaining: 18 },
                  capacity: { type: "limited", value: 100 },
                },
              ],
            },
          ],
        },
      };
    },
    async get(_id: string): Promise<Memory | null> {
      return null;
    },
    async update(_id: string, _input: UpdateMemoryInput): Promise<Memory | null> {
      return null;
    },
    async remove(_id: string): Promise<boolean> {
      return false;
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

test("memory tools expose success response message at top level", async () => {
  const tools = buildTools(createSuccessBackend()) as unknown as Record<
    string,
    { execute(args: Record<string, unknown>, context?: unknown): Promise<unknown> }
  >;

  const searchOutput = await tools.memory_search.execute({ q: "theme" });
  const storeOutput = await tools.memory_store.execute({ content: "saved" });

  const searchParsed = JSON.parse(searchOutput as string);
  const storeParsed = JSON.parse(storeOutput as string);

  assert.equal(searchParsed.ok, true);
  assert.equal(searchParsed.runtimeState, undefined);
  assert.match(searchParsed.message, /mem9 recall is at 82% of its included quota/);
  assert.equal(storeParsed.ok, true);
  assert.equal(storeParsed.message, "mem9 memory saving has used 80% of included quota.");
});
