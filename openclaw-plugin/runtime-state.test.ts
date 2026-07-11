import assert from "node:assert/strict";
import test from "node:test";

import { formatRuntimeStateNotice } from "./runtime-state.js";

test("formatRuntimeStateNotice renders included quota warnings", () => {
  const notice = formatRuntimeStateNotice({
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
  });

  assert.match(notice, /mem9 recall is at 82% of its included quota/);
  assert.match(notice, /nearing its runtime quota/);
});

test("formatRuntimeStateNotice prefers blocking provider actions", () => {
  const notice = formatRuntimeStateNotice({
    recommendedAction: {
      providerActionCode: "upgradePlan",
      severity: "blocking",
      type: "openUrl",
      url: "https://console.mem9.ai/console/billing/plan",
    },
    meters: [],
  });

  assert.match(notice, /account or billing attention/);
  assert.match(notice, /upgrade their mem9 plan/);
  assert.equal(
    notice.match(/https:\/\/console\.mem9\.ai\/console\/billing\/plan/g)?.length,
    1,
  );
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
  });

  assert.match(notice, /Mem9 API key is inactive/);
  assert.match(notice, /rerun mem9 setup or create a new mem9 API key/);
});
