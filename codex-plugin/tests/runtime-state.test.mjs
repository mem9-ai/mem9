import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeStateUrl,
  formatRuntimeStateNotice,
  resolveRuntimeStateNotice,
} from "../lib/runtime-state.mjs";

test("buildRuntimeStateUrl targets the public runtime-state endpoint", () => {
  assert.equal(
    buildRuntimeStateUrl("https://api.mem9.ai"),
    "https://api.mem9.ai/v1alpha2/mem9s/runtime-state",
  );
});

test("formatRuntimeStateNotice renders an 80 percent warning", () => {
  const notice = formatRuntimeStateNotice({
    mem9ApiKey: { status: "active" },
    meters: [
      {
        meter: "memory_recall_requests",
        budgets: [
          {
            type: "includedQuota",
            state: "warning",
            usage: { used: 820, remaining: 180, percent: 82 },
            capacity: { type: "limited", value: 1000 },
          },
        ],
      },
    ],
  });

  assert.match(notice, /mem9 recall is at 82% of its included quota/);
  assert.match(notice, /include this exact mem9 warning detail/);
});

test("formatRuntimeStateNotice renders absolute-unit urgent usage", () => {
  const notice = formatRuntimeStateNotice({
    mem9ApiKey: { status: "active" },
    meters: [
      {
        meter: "memory_write_requests",
        budgets: [
          {
            type: "includedQuota",
            state: "ok",
            usage: { used: 96, remaining: 4, percent: 96 },
            capacity: { type: "limited", value: 100 },
          },
        ],
      },
    ],
  });

  assert.match(notice, /mem9 memory saving has 4 units remaining/);
  assert.match(notice, /almost out of runtime quota/);
});

test("formatRuntimeStateNotice prefers constrained mode over lower warnings", () => {
  const notice = formatRuntimeStateNotice({
    mem9ApiKey: { status: "active" },
    meters: [
      {
        meter: "memory_recall_requests",
        budgets: [
          {
            type: "includedQuota",
            state: "warning",
            usage: { used: 810, remaining: 190, percent: 81 },
            capacity: { type: "limited", value: 1000 },
          },
        ],
      },
      {
        meter: "memory_write_requests",
        quotaGateResult: {
          outcome: "allowed",
          mode: "onDemand",
          reason: "includedQuotaExhaustedOnDemandAvailable",
        },
        budgets: [
          {
            type: "includedQuota",
            state: "exhausted",
          },
        ],
      },
    ],
  });

  assert.match(notice, /mem9 memory saving has exhausted its included quota/);
  assert.doesNotMatch(notice, /mem9 recall is at 81%/);
});

test("formatRuntimeStateNotice appends provider action guidance", () => {
  const notice = formatRuntimeStateNotice({
    mem9ApiKey: { status: "active" },
    meters: [
      {
        meter: "memory_recall_requests",
        quotaGateResult: {
          outcome: "blocked",
          mode: "includedQuota",
          reason: "includedQuotaExhausted",
        },
        budgets: [],
      },
    ],
    recommendedAction: {
      type: "openUrl",
      providerActionCode: "upgradePlan",
      severity: "blocking",
      url: "https://console.mem9.ai/console/billing/plan",
    },
  });

  assert.match(notice, /mem9 recall is blocked by runtime quota/);
  assert.match(notice, /upgrade their mem9 plan/);
  assert.match(notice, /https:\/\/console\.mem9\.ai\/console\/billing\/plan/);
});

test("formatRuntimeStateNotice renders inactive API key guidance", () => {
  const notice = formatRuntimeStateNotice({
    mem9ApiKey: { status: "inactive" },
    meters: [
      {
        meter: "memory_recall_requests",
        budgets: [
          {
            type: "includedQuota",
            state: "unlimited",
          },
        ],
      },
    ],
    recommendedAction: {
      type: "openUrl",
      providerActionCode: "claimApiKey",
      severity: "blocking",
      url: "https://console.mem9.ai/console/api-keys",
    },
  });

  assert.match(notice, /Mem9 API key is inactive/);
  assert.match(notice, /rerun mem9 setup or create a new mem9 API key/);
  assert.match(notice, /claim this API key/);
});

test("resolveRuntimeStateNotice is fail-soft", async () => {
  /** @type {string[]} */
  const debugStages = [];
  const notice = await resolveRuntimeStateNotice({
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "mem9_test",
      agentId: "codex",
      defaultTimeoutMs: 1234,
    },
    debug(stage) {
      debugStages.push(stage);
    },
    async fetchState() {
      throw new Error("timeout");
    },
  });

  assert.equal(notice, "");
  assert.deepEqual(debugStages, [
    "runtime_state_request",
    "runtime_state_failed",
  ]);
});

test("resolveRuntimeStateNotice fetches runtime-state with timeout", async () => {
  let capturedUrl = "";
  let capturedTimeout = 0;
  const notice = await resolveRuntimeStateNotice({
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "mem9_test",
      agentId: "codex",
      defaultTimeoutMs: 4321,
    },
    async fetchState(url, options) {
      capturedUrl = url;
      capturedTimeout = options.timeoutMs;
      return {
        meters: [
          {
            meter: "memory_recall_requests",
            budgets: [
              {
                type: "includedQuota",
                state: "warning",
                usage: { percent: 88 },
              },
            ],
          },
        ],
      };
    },
  });

  assert.equal(capturedUrl, "https://api.mem9.ai/v1alpha2/mem9s/runtime-state");
  assert.equal(capturedTimeout, 4321);
  assert.match(notice, /mem9 recall is at 88%/);
});
