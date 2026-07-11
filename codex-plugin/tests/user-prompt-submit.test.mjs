import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildRecallUrl,
  extractMemories,
  extractResponseNotice,
  runUserPromptSubmit,
} from "../hooks/user-prompt-submit.mjs";
import { Mem9HttpError } from "../lib/http.mjs";
import { formatRuntimeQuotaNotice } from "../lib/quota-error.mjs";
import { createTempRoot } from "./test-temp.mjs";

const USER_PROMPT_SUBMIT_ENTRY = path.resolve("./hooks/user-prompt-submit.mjs");
/** @type {Array<"plugin_disabled" | "plugin_missing" | "legacy_paused">} */
const NON_READY_ISSUE_CODES = ["plugin_disabled", "plugin_missing", "legacy_paused"];

/**
 * @param {string} error
 * @param {Record<string, unknown> | null} [runtimeQuota]
 */
function runtimeQuotaPayload(error, runtimeQuota = {}) {
  /** @type {{errorCategory: string, runtimeQuota?: Record<string, unknown>}} */
  const details = {
    errorCategory: "runtime_quota_denied",
  };
  if (runtimeQuota !== null) {
    details.runtimeQuota = runtimeQuota;
  }

  return {
    error,
    details,
  };
}

/**
 * @param {string} filePath
 * @param {unknown} value
 */
function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createCountingServer() {
  let requestCount = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(request.method === "GET" ? '{"memories":[]}' : '{"status":"complete"}');
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(undefined);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected a TCP server address");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    getRequestCount() {
      return requestCount;
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(undefined);
        });
      });
    },
  };
}

/**
 * @param {string} scriptPath
 * @param {{cwd: string, env: Record<string, string | undefined>, input: string}} input
 */
async function runNodeHook(scriptPath, input) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        code,
        signal,
        stdout,
        stderr,
      });
    });

    child.stdin.end(input.input);
  });
}

/**
 * @param {string} tempRoot
 * @param {"ready" | "plugin_disabled" | "plugin_missing" | "legacy_paused"} issueCode
 * @param {string} baseUrl
 */
function createRuntimeLayout(tempRoot, issueCode, baseUrl) {
  const codexHome = path.join(tempRoot, "codex-home");
  const mem9Home = path.join(tempRoot, "mem9-home");
  const cwd = path.join(tempRoot, "workspace");

  mkdirSync(cwd, { recursive: true });
  writeJson(path.join(codexHome, "mem9", "config.json"), {
    schemaVersion: 1,
    enabled: issueCode === "legacy_paused" ? false : true,
    profileId: "default",
  });
  writeJson(path.join(mem9Home, ".credentials.json"), {
    schemaVersion: 1,
    profiles: {
      default: {
        label: "Default",
        baseUrl,
        apiKey: "key-1",
      },
    },
  });
  writeFileSync(
    path.join(codexHome, "config.toml"),
    issueCode === "plugin_disabled"
      ? ' [plugins."mem9@mem9-ai"]   # disabled for this run\n enabled = false\n'
      : "\n",
  );

  if (issueCode !== "plugin_missing") {
    writeJson(path.join(codexHome, "mem9", "install.json"), {
      schemaVersion: 1,
      marketplaceName: "mem9-ai",
      pluginName: "mem9",
      shimVersion: 1,
    });
    mkdirSync(
      path.join(codexHome, "plugins", "cache", "mem9-ai", "mem9", "local"),
      { recursive: true },
    );
  }

  return {
    codexHome,
    mem9Home,
    cwd,
  };
}

test("buildRecallUrl encodes q and limit", () => {
  const url = new URL(
    buildRecallUrl("https://api.mem9.ai/", "hello world"),
  );

  assert.equal(url.origin + url.pathname, "https://api.mem9.ai/v1alpha2/mem9s/memories");
  assert.equal(url.searchParams.get("q"), "hello world");
  assert.equal(url.searchParams.get("agent_id"), null);
  assert.equal(url.searchParams.get("limit"), "10");
});

test("buildRecallUrl keeps a configured base path", () => {
  const url = new URL(
    buildRecallUrl("https://api.mem9.ai/base", "hello world"),
  );

  assert.equal(
    url.origin + url.pathname,
    "https://api.mem9.ai/base/v1alpha2/mem9s/memories",
  );
  assert.equal(url.searchParams.get("q"), "hello world");
  assert.equal(url.searchParams.get("agent_id"), null);
  assert.equal(url.searchParams.get("limit"), "10");
});

test("extractMemories accepts both server response shapes", () => {
  assert.deepEqual(extractMemories({ memories: [{ content: "a" }] }), [{ content: "a" }]);
  assert.deepEqual(extractMemories({ data: [{ content: "b" }] }), [{ content: "b" }]);
  assert.deepEqual(extractMemories(null), []);
});

test("extractResponseNotice prefers success response message", () => {
  assert.deepEqual(
    extractResponseNotice({
      message: "mem9 recall has used 80% of included quota.",
      runtimeState: {
        mem9ApiKey: { status: "active" },
        meters: [],
      },
    }),
    {
      message: "mem9 recall has used 80% of included quota.",
      source: "success-response",
    },
  );
});

test("extractResponseNotice falls back to runtimeState", () => {
  const notice = extractResponseNotice({
    runtimeState: {
      mem9ApiKey: { status: "active" },
      meters: [{
        meter: "memory_recall_requests",
        budgets: [{
          type: "includedQuota",
          state: "warning",
          usage: { percent: 82, remaining: 18 },
          capacity: { type: "limited", value: 100 },
        }],
      }],
    },
  });

  assert.equal(notice?.source, "runtime-state");
  assert.match(notice?.message ?? "", /mem9 recall is at 82% of its included quota/);
});

test("user prompt submit recalls memories with the search timeout bucket", async () => {
  /** @type {string | null} */
  let requestedUrl = null;
  /** @type {number | null} */
  let timeoutMs = null;
  /** @type {Array<{stage: string, fields: Record<string, unknown> | undefined}>} */
  const debugEvents = [];

  const output = await runUserPromptSubmit({
    prompt: "remember my preference",
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "key-1",
      agentId: "codex",
      searchTimeoutMs: 15_000,
      recallMinPromptLength: 5,
    },
    async search(url, options) {
      requestedUrl = url;
      timeoutMs = options.timeoutMs;
      return {
        memories: [
          { content: "User prefers concise answers." },
        ],
      };
    },
    debug(stage, fields) {
      debugEvents.push({ stage, fields });
    },
  });

  assert.equal(timeoutMs, 15_000);
  assert.ok(requestedUrl);
  assert.doesNotMatch(requestedUrl, /agent_id=/);
  assert.match(requestedUrl, /limit=10/);

  const parsed = JSON.parse(output);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(parsed.hookSpecificOutput.additionalContext, /relevant-memories/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /concise answers/);
  assert.deepEqual(
    debugEvents.map((event) => event.stage),
    ["recall_request", "recall_response", "context_injected"],
  );
});

test("user prompt submit injects success response message without memories", async () => {
  /** @type {Array<{stage: string, fields: Record<string, unknown> | undefined}>} */
  const debugEvents = [];

  const output = await runUserPromptSubmit({
    prompt: "remember my preference",
    sessionID: "session-message-1",
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "key-1",
      agentId: "codex",
      searchTimeoutMs: 15_000,
      recallMinPromptLength: 5,
    },
    async search() {
      return {
        memories: [],
        message: "mem9 recall has used 80% of included quota.",
      };
    },
    debug(stage, fields) {
      debugEvents.push({ stage, fields });
    },
  });

  const parsed = JSON.parse(output);
  assert.match(parsed.hookSpecificOutput.additionalContext, /<mem9-status-warning>/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /Mem9 notice for the user: mem9 recall has used 80%/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /Mention this mem9 notice to the user once/);
  assert.doesNotMatch(parsed.hookSpecificOutput.additionalContext, /<relevant-memories>/);
  assert.deepEqual(debugEvents.at(1)?.fields, {
    memoryCount: 0,
    hasMessage: true,
    messageLength: 43,
    messageHash: "sha256:2365c7aac0acad4c5300a420722fec83ac8ae4012e34c7694500334f9b4de1d6",
    messageSource: "success-response",
  });
});

test("user prompt submit deduplicates success response message by session", async () => {
  const tempRoot = createTempRoot("runtime-notice-state");
  const noticeStateFile = path.join(tempRoot, "codex-home", "mem9", "runtime-notices.json");
  const input = {
    prompt: "remember my preference",
    sessionID: "session-message-1",
    noticeStateFile,
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "key-1",
      agentId: "codex",
      searchTimeoutMs: 15_000,
      recallMinPromptLength: 5,
    },
    async search() {
      return {
        memories: [],
        message: "mem9 recall has used 80% of included quota.",
      };
    },
  };

  const firstOutput = await runUserPromptSubmit(input);
  const secondOutput = await runUserPromptSubmit(input);

  assert.match(firstOutput, /mem9 recall has used 80%/);
  assert.equal(secondOutput, "");
});

test("user prompt submit renders runtime quota denial action", async () => {
  /** @type {Array<{stage: string, fields: Record<string, unknown> | undefined}>} */
  const debugEvents = [];

  const output = await runUserPromptSubmit({
    prompt: "remember my preference",
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "key-1",
      agentId: "codex",
      searchTimeoutMs: 15_000,
      recallMinPromptLength: 5,
    },
    async search() {
      throw new Mem9HttpError("quota denied", {
        status: 402,
        data: runtimeQuotaPayload("Included quota is exhausted.", {
          meter: "memory_recall_requests",
          recommendedAction: {
            providerActionCode: "claimApiKey",
            type: "openUrl",
            url: "https://console.mem9.ai/console/claim?key=mem9_test",
          },
        }),
      });
    },
    debug(stage, fields) {
      debugEvents.push({ stage, fields });
    },
  });

  const parsed = JSON.parse(output);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(parsed.hookSpecificOutput.additionalContext, /Mem9 recall is temporarily unavailable/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /included usage quota for this API key has been used up/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /sign in or create a mem9 account and claim this API key/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /upgrade their plan or set up billing/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /Include the link exactly as written/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /console\/claim\?key=mem9_test/);
  assert.equal(
    parsed.hookSpecificOutput.additionalContext.match(/https:\/\/console\.mem9\.ai\/console\/claim\?key=mem9_test/g)?.length,
    1,
  );
  assert.doesNotMatch(parsed.hookSpecificOutput.additionalContext, /\.\. Claim/);
  assert.equal(debugEvents.at(-1)?.stage, "recall_quota_denied");
  assert.deepEqual(debugEvents.at(-1)?.fields, {
    code: "runtime_quota_denied",
    actionType: "openUrl",
    hasActionUrl: true,
  });
});

test("runtime quota notice renders spending limit guidance", () => {
  const notice = formatRuntimeQuotaNotice(
    new Mem9HttpError("quota denied", {
      status: 402,
      data: runtimeQuotaPayload("On-demand spending limit would be exceeded.", {
        meter: "memory_recall_requests",
        recommendedAction: {
          providerActionCode: "increaseSpendingLimit",
          type: "openUrl",
          url: "https://console.mem9.ai/console/billing/plan",
        },
      }),
    }),
    "recall paused",
  );

  assert.match(notice, /configured spending limit would be exceeded/);
  assert.match(notice, /increase the mem9 spending limit or adjust billing settings/);
  assert.match(notice, /Include the link exactly as written/);
  assert.equal(
    notice.match(/https:\/\/console\.mem9\.ai\/console\/billing\/plan/g)?.length,
    1,
  );
});

test("runtime quota notice handles missing runtime quota metadata", () => {
  const notice = formatRuntimeQuotaNotice(
    new Mem9HttpError("quota denied", {
      status: 402,
      data: runtimeQuotaPayload("Runtime access is blocked.", null),
    }),
    "recall paused",
  );

  assert.match(notice, /runtime quota check blocked this request/);
  assert.match(notice, /open the mem9 console/);
});

test("runtime quota notice handles unknown provider action codes", () => {
  const notice = formatRuntimeQuotaNotice(
    new Mem9HttpError("quota denied", {
      status: 402,
      data: runtimeQuotaPayload("Custom quota action required.", {
        recommendedAction: {
          providerActionCode: "contactSupport",
          type: "openUrl",
          url: "https://console.mem9.ai/console/support",
        },
      }),
    }),
    "recall paused",
  );

  assert.match(notice, /open this mem9 link to resolve the account or billing state/);
  assert.match(notice, /console\/support/);
});

test("runtime quota notice ignores generic api rate limits", () => {
  const notice = formatRuntimeQuotaNotice(
    new Mem9HttpError("rate limited", {
      status: 429,
      data: {
        error: "rate limit exceeded",
      },
    }),
    "recall paused",
  );

  assert.equal(notice, "");
});

test("runtime quota notice renders post-quota rate limit guidance without action URL", () => {
  const notice = formatRuntimeQuotaNotice(
    new Mem9HttpError("quota denied", {
      status: 429,
      data: runtimeQuotaPayload("Post-quota rate limit exceeded.", {
        meter: "memory_recall_requests",
        quotaGateResult: {
          outcome: "rateLimited",
          mode: "postQuota",
          reason: "postQuotaRateLimitExceeded",
          postQuotaRateLimit: {
            requestsPerMinute: 4,
            windowDurationSeconds: 60,
            scope: "apiKeyMeter",
            retryAfterSeconds: 23,
          },
        },
      }),
    }),
    "recall paused",
  );

  assert.match(notice, /temporary request limit/);
  assert.match(notice, /quota\/rate-limit check blocked this request/);
  assert.match(notice, /retry later or open the mem9 console/);
  assert.doesNotMatch(notice, /console\/billing\/plan/);
  assert.doesNotMatch(notice, /wait 23 seconds before trying again/);
  assert.equal((notice.match(/https:\/\//g) ?? []).length, 0);
});

test("runtime quota notice renders post-quota billing action when provided", () => {
  const notice = formatRuntimeQuotaNotice(
    new Mem9HttpError("quota denied", {
      status: 429,
      data: runtimeQuotaPayload("Post-quota rate limit exceeded.", {
        meter: "memory_write_requests",
        recommendedAction: {
          providerActionCode: "upgradePlan",
          type: "openUrl",
          url: "https://console.mem9.ai/console/billing/plan",
        },
        quotaGateResult: {
          outcome: "rateLimited",
          mode: "postQuota",
          reason: "postQuotaRateLimitExceeded",
          postQuotaRateLimit: {
            requestsPerMinute: 2,
            windowDurationSeconds: 60,
            scope: "apiKeyMeter",
            retryAfterSeconds: 1,
          },
        },
      }),
    }),
    "memory save paused",
  );

  assert.match(notice, /Mem9 memory saving is temporarily unavailable/);
  assert.match(notice, /upgrade their mem9 plan and get more included usage/);
  assert.match(notice, /console\/billing\/plan/);
  assert.doesNotMatch(notice, /wait 1 second before trying again/);
  assert.equal(
    notice.match(/https:\/\/console\.mem9\.ai\/console\/billing\/plan/g)?.length,
    1,
  );
});

test("runtime quota notice renders post-quota claim action when provided", () => {
  const notice = formatRuntimeQuotaNotice(
    new Mem9HttpError("quota denied", {
      status: 429,
      data: runtimeQuotaPayload("Post-quota rate limit exceeded.", {
        meter: "memory_recall_requests",
        recommendedAction: {
          providerActionCode: "claimApiKey",
          type: "openUrl",
          url: "https://console.mem9.ai/console/claim?key=mem9_test",
        },
        quotaGateResult: {
          outcome: "rateLimited",
          mode: "postQuota",
          reason: "postQuotaRateLimitExceeded",
          postQuotaRateLimit: {
            requestsPerMinute: 4,
            windowDurationSeconds: 60,
            scope: "apiKeyMeter",
            retryAfterSeconds: 23,
          },
        },
      }),
    }),
    "recall paused",
  );

  assert.match(notice, /temporary request limit/);
  assert.match(notice, /sign in or create a mem9 account and claim this API key/);
  assert.match(notice, /After claiming the key, they can upgrade their plan or set up billing/);
  assert.match(notice, /console\/claim\?key=mem9_test/);
  assert.doesNotMatch(notice, /console\/billing\/plan/);
  assert.equal(
    notice.match(/https:\/\/console\.mem9\.ai\/console\/claim\?key=mem9_test/g)?.length,
    1,
  );
});

test("runtime quota notice renders write meter guidance", () => {
  const notice = formatRuntimeQuotaNotice(
    new Mem9HttpError("quota denied", {
      status: 402,
      data: runtimeQuotaPayload("Included quota is exhausted.", {
        meter: "memory_write_requests",
        recommendedAction: {
          providerActionCode: "upgradePlan",
          type: "openUrl",
          url: "https://console.mem9.ai/console/billing/plan",
        },
      }),
    }),
    "recall paused",
  );

  assert.match(notice, /Mem9 memory saving is temporarily unavailable/);
  assert.match(notice, /mem9 cannot save new memories right now/);
  assert.match(notice, /upgrade their mem9 plan and get more included usage/);
  assert.doesNotMatch(notice, /cannot recall memories/);
  assert.equal(
    notice.match(/https:\/\/console\.mem9\.ai\/console\/billing\/plan/g)?.length,
    1,
  );
});

test("user prompt submit skips empty queries after stripping injected memories", async () => {
  let called = false;
  /** @type {Array<{stage: string, fields: Record<string, unknown> | undefined}>} */
  const debugEvents = [];

  const output = await runUserPromptSubmit({
    prompt: "<relevant-memories>\n1. old\n</relevant-memories>",
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "key-1",
      agentId: "codex",
      searchTimeoutMs: 15_000,
      recallMinPromptLength: 5,
    },
    async search() {
      called = true;
      return { memories: [] };
    },
    debug(stage, fields) {
      debugEvents.push({ stage, fields });
    },
  });

  assert.equal(called, false);
  assert.equal(output, "");
  assert.equal(debugEvents[0]?.stage, "prompt_empty");
});

test("user prompt submit strips injected status warnings before recall", async () => {
  let called = false;
  const output = await runUserPromptSubmit({
    prompt: "<mem9-status-warning>\nMem9 notice for the user: old\n</mem9-status-warning>",
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "key-1",
      agentId: "codex",
      searchTimeoutMs: 15_000,
      recallMinPromptLength: 5,
    },
    async search() {
      called = true;
      return { memories: [] };
    },
  });

  assert.equal(called, false);
  assert.equal(output, "");
});

test("user prompt submit skips recall when the stripped query is shorter than the configured minimum", async () => {
  let called = false;
  /** @type {Array<{stage: string, fields: Record<string, unknown> | undefined}>} */
  const debugEvents = [];
  const prompt = "<relevant-memories>\n1. old\n</relevant-memories>\n\nhi";

  const output = await runUserPromptSubmit({
    prompt,
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "key-1",
      agentId: "codex",
      searchTimeoutMs: 15_000,
      recallMinPromptLength: 5,
    },
    async search() {
      called = true;
      return { memories: [] };
    },
    debug(stage, fields) {
      debugEvents.push({ stage, fields });
    },
  });

  assert.equal(called, false);
  assert.equal(output, "");
  assert.equal(debugEvents[0]?.stage, "prompt_too_short");
  assert.deepEqual(debugEvents[0]?.fields, {
    promptChars: prompt.length,
    queryChars: 2,
    recallMinPromptLength: 5,
  });
});

test("user prompt submit allows short non-empty queries when the configured minimum is zero", async () => {
  /** @type {string | null} */
  let requestedUrl = null;

  const output = await runUserPromptSubmit({
    prompt: "hi",
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "key-1",
      agentId: "codex",
      searchTimeoutMs: 15_000,
      recallMinPromptLength: 0,
    },
    async search(url) {
      requestedUrl = url;
      return {
        memories: [
          { content: "Short prompts can still recall when configured." },
        ],
      };
    },
  });

  assert.ok(requestedUrl);
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("q"), "hi");
  assert.match(output, /Short prompts can still recall/);
});

test("user prompt submit entrypoint skips short prompts using runtime config from disk", async () => {
  const tempRoot = createTempRoot();
  const server = await createCountingServer();

  try {
    const runtime = createRuntimeLayout(tempRoot, "ready", server.origin);
    writeJson(path.join(runtime.codexHome, "mem9", "config.json"), {
      schemaVersion: 1,
      enabled: true,
      profileId: "default",
      recallMinPromptLength: 6,
    });

    const result = await runNodeHook(USER_PROMPT_SUBMIT_ENTRY, {
      cwd: runtime.cwd,
      env: {
        CODEX_HOME: runtime.codexHome,
        MEM9_HOME: runtime.mem9Home,
        PATH: process.env.PATH,
      },
      input: JSON.stringify({
        cwd: runtime.cwd,
        prompt: "hello",
      }),
    });

    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(server.getRequestCount(), 0);
  } finally {
    await server.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

for (const issueCode of NON_READY_ISSUE_CODES) {
  test(`user prompt submit entrypoint skips ${issueCode} without calling the mem9 api`, async () => {
    const tempRoot = createTempRoot();
    const server = await createCountingServer();

    try {
      const runtime = createRuntimeLayout(tempRoot, issueCode, server.origin);
      const result = await runNodeHook(USER_PROMPT_SUBMIT_ENTRY, {
        cwd: runtime.cwd,
        env: {
          ...process.env,
          CODEX_HOME: runtime.codexHome,
          MEM9_HOME: runtime.mem9Home,
        },
        input: JSON.stringify({
          cwd: runtime.cwd,
          prompt: "remember my preference",
        }),
      });

      assert.equal(result.code, 0);
      assert.equal(result.signal, null);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(server.getRequestCount(), 0);
    } finally {
      await server.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
}
