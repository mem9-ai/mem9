import assert from "node:assert/strict";
import test from "node:test";

import { formatRuntimeStateNotice } from "../src/server/runtime-state.js";

test("formatRuntimeStateNotice renders warning and urgent budget notices", () => {
  const warning = formatRuntimeStateNotice({
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
  const urgent = formatRuntimeStateNotice({
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

  assert.match(warning, /mem9 recall is at 82% of its included quota/);
  assert.match(urgent, /mem9 memory saving has 4 units remaining/);
});

test("formatRuntimeStateNotice renders provider action guidance", () => {
  const notice = formatRuntimeStateNotice({
    mem9ApiKey: { status: "active" },
    meters: [
      {
        meter: "memory_recall_requests",
        quotaGateResult: {
          outcome: "blocked",
          mode: "includedQuota",
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
        meter: "memory_write_requests",
        budgets: [
          {
            type: "includedQuota",
            state: "unlimited",
          },
        ],
      },
    ],
  });

  assert.match(notice, /Mem9 API key is inactive/);
  assert.match(notice, /rerun mem9 setup or create a new mem9 API key/);
});
