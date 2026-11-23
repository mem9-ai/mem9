// @ts-check

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runPreInvocation } from "../scripts/pre-invocation.mjs";
import { runSessionStart } from "../scripts/session-start.mjs";
import { runStop } from "../scripts/stop.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");

/**
 * @param {(ctx: { tempDir: string, mem9Home: string, workspaceDir: string, pluginDataDir: string }) => Promise<void>} fn
 */
async function withTempEnv(fn) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mem9-agy-hooks-"));
  const mem9Home = path.join(tempDir, "mem9-home");
  const workspaceDir = path.join(tempDir, "workspace");
  const pluginDataDir = path.join(tempDir, "plugin-data");
  mkdirSync(mem9Home, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(pluginDataDir, { recursive: true });
  try {
    await fn({ tempDir, mem9Home, workspaceDir, pluginDataDir });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {string} mem9Home
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {Record<string, unknown>} [userConfig]
 */
function seedUserProfile(mem9Home, baseUrl, apiKey, userConfig = {}) {
  writeFileSync(
    path.join(mem9Home, ".credentials.json"),
    JSON.stringify({
      schemaVersion: 1,
      profiles: {
        default: {
          label: "Default",
          baseUrl,
          apiKey,
        },
      },
    }),
    { mode: 0o600 },
  );
  const stateDir = path.join(mem9Home, "antigravity");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    path.join(stateDir, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      profileId: "default",
      ...userConfig,
    }),
    { mode: 0o600 },
  );
}

/**
 * @param {(req: http.IncomingMessage, body: string, res: http.ServerResponse) => void} handler
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
function startMockServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        handler(req, Buffer.concat(chunks).toString("utf8"), res);
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Unexpected server address"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((resClose) => server.close(() => resClose())),
      });
    });
  });
}

/**
 * @param {Record<string, string | undefined>} overrides
 * @returns {NodeJS.ProcessEnv}
 */
function isolatedEnv(overrides) {
  /** @type {NodeJS.ProcessEnv} */
  const clean = { ...process.env };
  for (const key of [
    "MEM9_API_KEY",
    "MEM9_API_URL",
    "MEM9_AGENT_ID",
    "MEM9_HOME",
    "MEM9_AUTO_PROVISION",
    "MEM9_DEBUG",
    "MEM9_DEBUG_LOG_FILE",
    "PLUGIN_DATA",
    "WORKSPACE_ROOT",
  ]) {
    delete clean[key];
  }
  return { ...clean, ...overrides };
}

/**
 * @param {string} scriptRelPath
 * @param {unknown} stdinPayload
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
function runHookSubprocess(scriptRelPath, stdinPayload, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(PLUGIN_ROOT, scriptRelPath)], {
      cwd: PLUGIN_ROOT,
      env: isolatedEnv(env),
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
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    const text = typeof stdinPayload === "string"
      ? stdinPayload
      : JSON.stringify(stdinPayload);
    child.stdin.end(text);
  });
}

test("hooks.json follows flat Antigravity schema with relative script commands", () => {
  const hooksJson = JSON.parse(
    readFileSync(path.join(PLUGIN_ROOT, "hooks.json"), "utf8"),
  );
  const group = hooksJson["mem9-memory"];
  assert.equal(group.enabled, true);

  for (const [eventName, expectedCmd, expectedTimeout] of [
    ["SessionStart", "node ./scripts/session-start.mjs", 15],
    ["PreInvocation", "node ./scripts/pre-invocation.mjs", 15],
    ["Stop", "node ./scripts/stop.mjs", 30],
  ]) {
    const handlers = group[eventName];
    assert.equal(Array.isArray(handlers), true, `${eventName} must be an array`);
    assert.equal(handlers.length, 1);
    assert.equal(handlers[0].matcher, undefined);
    assert.equal(handlers[0].hooks, undefined);
    assert.equal(handlers[0].type, "command");
    assert.equal(handlers[0].command, expectedCmd);
    assert.equal(handlers[0].timeout, expectedTimeout);
    assert.equal(handlers[0].command.includes("PLUGIN_ROOT"), false);
  }
});

test("SessionStart auto-provisions default profile silently when missing_config", async () => {
  await withTempEnv(async ({ mem9Home, workspaceDir, pluginDataDir }) => {
    const rawKey = "mk_auto_provisioned_secret_key_9999";
    let provisionCalls = 0;

    const output = await runSessionStart({
      stdin: { conversationId: "conv-1", cwd: workspaceDir },
      mem9Home,
      pluginDataDir,
      env: { MEM9_API_URL: "https://mock.mem9.local" },
      provisionFn: async (baseUrl) => {
        provisionCalls += 1;
        return { apiKey: rawKey, baseUrl };
      },
      fetchState: async () => ({ mem9ApiKey: { status: "active" }, meters: [] }),
    });

    assert.equal(provisionCalls, 1);
    assert.equal(output, "{}");

    const credsPath = path.join(mem9Home, ".credentials.json");
    assert.equal(existsSync(credsPath), true);
    assert.equal(statSync(credsPath).mode & 0o777, 0o600);
    const creds = JSON.parse(readFileSync(credsPath, "utf8"));
    assert.equal(creds.profiles.default.apiKey, rawKey);

    const userConfigPath = path.join(mem9Home, "antigravity", "config.json");
    assert.equal(existsSync(userConfigPath), true);
    const userCfg = JSON.parse(readFileSync(userConfigPath, "utf8"));
    assert.equal(userCfg.profileId, "default");
  });
});

test("SessionStart injects runtime notice once per conversation and skips when disabled", async () => {
  await withTempEnv(async ({ mem9Home, workspaceDir, pluginDataDir }) => {
    const rawKey = "mk_live_secret_1234567890";
    seedUserProfile(mem9Home, "https://mock.mem9.local", rawKey);

    const noticePayload = {
      mem9ApiKey: { status: "active" },
      meters: [
        {
          meter: "memory_recall_requests",
          budgets: [
            {
              type: "includedQuota",
              state: "warning",
              usage: { percent: 85, remaining: 15 },
              capacity: { type: "limited", value: 100 },
            },
          ],
        },
      ],
    };

    const first = await runSessionStart({
      stdin: { conversationId: "conv-notice", cwd: workspaceDir },
      mem9Home,
      pluginDataDir,
      env: {},
      fetchState: async () => noticePayload,
    });
    const parsedFirst = JSON.parse(first);
    const injected = parsedFirst.injectSteps[0].systemMessage.systemMessage;
    assert.match(injected, /<mem9-status-warning>/);
    assert.match(injected, /85%/);
    assert.equal(injected.includes(rawKey), false);

    const second = await runSessionStart({
      stdin: { conversationId: "conv-notice", cwd: workspaceDir },
      mem9Home,
      pluginDataDir,
      env: {},
      fetchState: async () => noticePayload,
    });
    assert.equal(second, "{}");

    // Disabled config should skip auto-provision and stay silent.
    writeFileSync(
      path.join(mem9Home, "antigravity", "config.json"),
      JSON.stringify({ schemaVersion: 1, enabled: false, profileId: "default" }),
    );
    let provisioned = false;
    const disabledOut = await runSessionStart({
      stdin: { conversationId: "conv-disabled", cwd: workspaceDir },
      mem9Home,
      pluginDataDir,
      env: {},
      provisionFn: async (baseUrl) => {
        provisioned = true;
        return { apiKey: "mk_should_not_run", baseUrl };
      },
    });
    assert.equal(provisioned, false);
    assert.equal(disabledOut, "{}");
  });
});

test("SessionStart injects safe repair hint on invalid config JSON without auto-provisioning", async () => {
  await withTempEnv(async ({ mem9Home, workspaceDir, pluginDataDir }) => {
    const stateDir = path.join(mem9Home, "antigravity");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(path.join(stateDir, "config.json"), "{ invalid json");

    let provisioned = false;
    const output = await runSessionStart({
      stdin: { conversationId: "conv-bad", cwd: workspaceDir },
      mem9Home,
      pluginDataDir,
      env: {},
      provisionFn: async (baseUrl) => {
        provisioned = true;
        return { apiKey: "mk_should_not_run", baseUrl };
      },
    });

    assert.equal(provisioned, false);
    const parsed = JSON.parse(output);
    assert.match(
      parsed.injectSteps[0].systemMessage.systemMessage,
      /\/mem9-setup/,
    );
  });
});

test("SessionStart respects MEM9_AUTO_PROVISION=0 without calling provisionFn", async () => {
  await withTempEnv(async ({ mem9Home, workspaceDir, pluginDataDir }) => {
    let provisioned = false;
    const output = await runSessionStart({
      stdin: { conversationId: "conv-no-prov", cwd: workspaceDir },
      mem9Home,
      pluginDataDir,
      env: { MEM9_AUTO_PROVISION: "0" },
      provisionFn: async (baseUrl) => {
        provisioned = true;
        return { apiKey: "mk_should_not_run", baseUrl };
      },
    });
    assert.equal(provisioned, false);
    const parsed = JSON.parse(output);
    assert.match(parsed.injectSteps[0].systemMessage.systemMessage, /\/mem9-setup/);
  });
});

test("PreInvocation prunes hook-state.json to at most 50 recent conversations", async () => {
  await withTempEnv(async ({ mem9Home, workspaceDir, pluginDataDir }) => {
    seedUserProfile(mem9Home, "https://mock.mem9.local", "mk_secret_prune_12345");
    for (let idx = 1; idx <= 55; idx += 1) {
      await runPreInvocation({
        stdin: {
          conversationId: `conv-${idx}`,
          cwd: workspaceDir,
          lastUserInput: `query number ${idx}`,
          invocationNum: 1,
        },
        mem9Home,
        pluginDataDir,
        env: {},
        now: () => new Date(Date.UTC(2026, 10, 23, 0, 0, idx)),
        search: async () => ({ memories: [] }),
      });
    }

    const hookState = JSON.parse(
      readFileSync(path.join(mem9Home, "antigravity", "hook-state.json"), "utf8"),
    );
    const keys = Object.keys(hookState.conversations);
    assert.equal(keys.length, 50);
    assert.equal(keys.includes("conv-1"), false);
    assert.equal(keys.includes("conv-5"), false);
    assert.equal(keys.includes("conv-6"), true);
    assert.equal(keys.includes("conv-55"), true);
  });
});

test("PreInvocation skips internal prompts, strips wrappers, recalls, and deduplicates per turn", async () => {
  await withTempEnv(async ({ tempDir, mem9Home, workspaceDir, pluginDataDir }) => {
    seedUserProfile(mem9Home, "https://mock.mem9.local", "mk_secret_recall_12345");
    const transcriptPath = path.join(tempDir, "transcript.jsonl");

    // 1. Internal [plan review] prompt is skipped.
    let searchCalls = 0;
    const planOut = await runPreInvocation({
      stdin: {
        conversationId: "conv-turn",
        cwd: workspaceDir,
        lastUserInput: "<USER_REQUEST>[plan review] inspect the diff</USER_REQUEST>",
        invocationNum: 1,
      },
      mem9Home,
      pluginDataDir,
      env: {},
      search: async () => {
        searchCalls += 1;
        return { memories: [] };
      },
    });
    assert.equal(planOut, "{}");
    assert.equal(searchCalls, 0);

    // 2. Too short prompt after stripping wrappers is skipped.
    const shortOut = await runPreInvocation({
      stdin: {
        conversationId: "conv-turn",
        cwd: workspaceDir,
        lastUserInput: "<relevant-memories>\n1. old\n</relevant-memories>\nhi",
        invocationNum: 1,
      },
      mem9Home,
      pluginDataDir,
      env: {},
      search: async () => {
        searchCalls += 1;
        return { memories: [] };
      },
    });
    assert.equal(shortOut, "{}");
    assert.equal(searchCalls, 0);

    // 3. Transcript-backed turn recall strips wrappers and formats memories + notice once.
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        step_index: 1,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        content: "Where do we deploy the static site?",
      })}\n`,
    );

    /** @type {string[]} */
    const urls = [];
    const firstTurnOut = await runPreInvocation({
      stdin: {
        conversationId: "conv-turn",
        workspacePaths: [workspaceDir],
        transcriptPath,
        lastUserInput:
          "<USER_REQUEST><SYSTEM_MESSAGE>ignore</SYSTEM_MESSAGE>Where do we deploy the static site?</USER_REQUEST>",
        invocationNum: 1,
      },
      mem9Home,
      pluginDataDir,
      env: {},
      search: async (url) => {
        urls.push(url);
        return {
          memories: [{ content: "Site deploys to Netlify from main branch." }],
          message: "Included quota is at 80%.",
        };
      },
    });

    assert.equal(urls.length, 1);
    const parsedUrl = new URL(urls[0]);
    assert.equal(parsedUrl.pathname, "/v1alpha2/mem9s/memories");
    assert.equal(parsedUrl.searchParams.get("q"), "Where do we deploy the static site?");
    assert.equal(parsedUrl.searchParams.get("limit"), "10");

    const parsedFirst = JSON.parse(firstTurnOut);
    const sysMsg = parsedFirst.injectSteps[0].systemMessage.systemMessage;
    assert.match(sysMsg, /<mem9-status-warning>/);
    assert.match(sysMsg, /Included quota is at 80%\./);
    assert.match(sysMsg, /<relevant-memories>/);
    assert.match(sysMsg, /Site deploys to Netlify from main branch\./);

    // 4. Same turn second model step (same USER_INPUT step in transcript) skips recall!
    const repeatStepOut = await runPreInvocation({
      stdin: {
        conversationId: "conv-turn",
        workspacePaths: [workspaceDir],
        transcriptPath,
        lastUserInput: "Where do we deploy the static site?",
        invocationNum: 2,
      },
      mem9Home,
      pluginDataDir,
      env: {},
      search: async () => {
        urls.push("should-not-happen");
        return { memories: [] };
      },
    });
    assert.equal(repeatStepOut, "{}");
    assert.equal(urls.length, 1);

    // 5. New user turn in transcript recalls again, and already-seen notice is NOT repeated.
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        step_index: 1,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        content: "Where do we deploy the static site?",
      })}\n${JSON.stringify({
        step_index: 2,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        content: "What database backend does mem9 use?",
      })}\n`,
    );

    const secondTurnOut = await runPreInvocation({
      stdin: {
        conversationId: "conv-turn",
        cwd: workspaceDir,
        transcriptPath,
        lastUserInput: "What database backend does mem9 use?",
        invocationNum: 1,
      },
      mem9Home,
      pluginDataDir,
      env: {},
      search: async (url) => {
        urls.push(url);
        return {
          memories: [{ content: "Go REST server backed by TiDB/MySQL." }],
          message: "Included quota is at 80%.",
        };
      },
    });
    assert.equal(urls.length, 2);
    const secondSysMsg = JSON.parse(secondTurnOut).injectSteps[0].systemMessage.systemMessage;
    assert.equal(secondSysMsg.includes("<mem9-status-warning>"), false);
    assert.match(secondSysMsg, /Go REST server backed by TiDB\/MySQL\./);
  });
});

test("PreInvocation without transcript deduplicates invocationNum > 1 but allows new turn at invocationNum === 1", async () => {
  await withTempEnv(async ({ mem9Home, workspaceDir, pluginDataDir }) => {
    seedUserProfile(mem9Home, "https://mock.mem9.local", "mk_secret_fallback_12345");
    let count = 0;

    const search = async () => {
      count += 1;
      return { memories: [{ content: `memory-${count}` }] };
    };

    const step1 = await runPreInvocation({
      stdin: {
        conversationId: "conv-no-transcript",
        cwd: workspaceDir,
        lastUserInput: "check build status",
        invocationNum: 1,
      },
      mem9Home,
      pluginDataDir,
      env: {},
      search,
    });
    assert.match(step1, /memory-1/);
    assert.equal(count, 1);

    const step2 = await runPreInvocation({
      stdin: {
        conversationId: "conv-no-transcript",
        cwd: workspaceDir,
        lastUserInput: "check build status",
        invocationNum: 2,
      },
      mem9Home,
      pluginDataDir,
      env: {},
      search,
    });
    assert.equal(step2, "{}");
    assert.equal(count, 1);

    const nextTurn = await runPreInvocation({
      stdin: {
        conversationId: "conv-no-transcript",
        cwd: workspaceDir,
        lastUserInput: "check build status",
        invocationNum: 1,
      },
      mem9Home,
      pluginDataDir,
      env: {},
      search,
    });
    assert.match(nextTurn, /memory-2/);
    assert.equal(count, 2);
  });
});

test("PreInvocation handles runtime quota denial cleanly and swallows network errors", async () => {
  await withTempEnv(async ({ mem9Home, workspaceDir, pluginDataDir }) => {
    seedUserProfile(mem9Home, "https://mock.mem9.local", "mk_secret_quota_12345");

    const quotaOut = await runPreInvocation({
      stdin: {
        conversationId: "conv-quota",
        cwd: workspaceDir,
        lastUserInput: "recall my preferences",
        invocationNum: 1,
      },
      mem9Home,
      pluginDataDir,
      env: {},
      search: async () => {
        const err = new Error("quota exceeded");
        Object.assign(err, {
          status: 402,
          data: {
            error: "Included quota exhausted",
            details: {
              errorCategory: "runtime_quota_denied",
              runtimeQuota: {
                meter: "memory_recall_requests",
                recommendedAction: {
                  providerActionCode: "upgradePlan",
                  url: "https://console.mem9.ai/upgrade",
                },
              },
            },
          },
        });
        throw err;
      },
    });
    const parsedQuota = JSON.parse(quotaOut);
    assert.match(
      parsedQuota.injectSteps[0].systemMessage.systemMessage,
      /https:\/\/console\.mem9\.ai\/upgrade/,
    );

    const netErrOut = await runPreInvocation({
      stdin: {
        conversationId: "conv-neterr",
        cwd: workspaceDir,
        lastUserInput: "recall my preferences",
        invocationNum: 1,
      },
      mem9Home,
      pluginDataDir,
      env: {},
      search: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    assert.equal(netErrOut, "{}");
  });
});

test("Stop parses transcript, uploads smart ingest, deduplicates by hash, and preserves hook-state fields", async () => {
  await withTempEnv(async ({ tempDir, mem9Home, workspaceDir, pluginDataDir }) => {
    seedUserProfile(mem9Home, "https://mock.mem9.local", "mk_secret_stop_12345", {
      agentId: "antigravity-custom",
    });

    const hookStatePath = path.join(mem9Home, "antigravity", "hook-state.json");
    writeFileSync(
      hookStatePath,
      JSON.stringify({
        schemaVersion: 1,
        conversations: {
          "conv-stop": {
            lastRecalledStepKey: "step:1:abcd",
            updatedAt: "2026-11-23T00:00:00.000Z",
          },
        },
      }),
    );

    const transcriptPath = path.join(tempDir, "stop-transcript.jsonl");
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          step_index: 1,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          content: "<relevant-memories>\n1. old\n</relevant-memories>\nWe prefer pnpm.",
        }),
        JSON.stringify({
          step_index: 2,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          content: "",
          tool_calls: [{ name: "run_command" }],
        }),
        JSON.stringify({
          step_index: 3,
          source: "SYSTEM",
          type: "GENERIC",
          content: "tool output should be ignored",
        }),
        JSON.stringify({
          step_index: 4,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          content: "Noted, I will use pnpm in this repo.",
        }),
      ].join("\n") + "\n",
    );

    /** @type {Array<{ url: string, body: any }>} */
    const posts = [];
    const firstOut = await runStop({
      stdin: {
        conversationId: "conv-stop",
        cwd: workspaceDir,
        transcriptPath,
        terminationReason: "completed",
        continuationActive: false,
      },
      mem9Home,
      pluginDataDir,
      env: {},
      post: async (url, body) => {
        posts.push({ url, body });
        return { status: "accepted" };
      },
    });
    assert.equal(firstOut, "{}");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://mock.mem9.local/v1alpha2/mem9s/memories");
    assert.deepEqual(posts[0].body, {
      session_id: "conv-stop",
      agent_id: "antigravity-custom",
      mode: "smart",
      messages: [
        { role: "user", content: "We prefer pnpm." },
        { role: "assistant", content: "Noted, I will use pnpm in this repo." },
      ],
    });

    // Preserved recall state while adding lastIngestedHash.
    const savedState = JSON.parse(readFileSync(hookStatePath, "utf8"));
    assert.equal(savedState.conversations["conv-stop"].lastRecalledStepKey, "step:1:abcd");
    assert.equal(typeof savedState.conversations["conv-stop"].lastIngestedHash, "string");

    // Duplicate Stop with unchanged transcript does NOT post again.
    const dupOut = await runStop({
      stdin: {
        conversationId: "conv-stop",
        cwd: workspaceDir,
        transcriptPath,
      },
      mem9Home,
      pluginDataDir,
      env: {},
      post: async () => {
        posts.push({ url: "unexpected", body: null });
        return {};
      },
    });
    assert.equal(dupOut, "{}");
    assert.equal(posts.length, 1);

    // Network failure on new transcript swallows error and outputs {}.
    writeFileSync(
      transcriptPath,
      readFileSync(transcriptPath, "utf8")
        + `${JSON.stringify({
          step_index: 5,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          content: "Also pin Node 20+.",
        })}\n`,
    );
    const errOut = await runStop({
      stdin: {
        conversationId: "conv-stop",
        cwd: workspaceDir,
        transcriptPath,
      },
      mem9Home,
      pluginDataDir,
      env: {},
      post: async () => {
        throw new Error("socket hang up");
      },
    });
    assert.equal(errOut, "{}");
  });
});

test("End-to-end hook subprocesses run cleanly against local mock HTTP server", async () => {
  await withTempEnv(async ({ tempDir, mem9Home, workspaceDir, pluginDataDir }) => {
    const rawKey = "mk_e2e_secret_abcdef123456";
    /** @type {any[]} */
    const ingestBodies = [];
    const server = await startMockServer((req, body, res) => {
      if (req.method === "POST" && req.url === "/v1alpha1/mem9s") {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: rawKey }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1alpha2/mem9s/runtime-state") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ mem9ApiKey: { status: "active" }, meters: [] }));
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/v1alpha2/mem9s/memories")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            memories: [{ content: "Remember to run node --test before committing." }],
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url === "/v1alpha2/mem9s/memories") {
        ingestBodies.push(JSON.parse(body));
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "accepted" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      const env = {
        MEM9_HOME: mem9Home,
        MEM9_API_URL: server.baseUrl,
        PLUGIN_DATA: pluginDataDir,
      };

      // 1. SessionStart auto-provisions and returns {}.
      const ssRes = await runHookSubprocess(
        "scripts/session-start.mjs",
        { conversationId: "e2e-conv", workspacePaths: [workspaceDir] },
        env,
      );
      assert.equal(ssRes.code, 0);
      assert.deepEqual(JSON.parse(ssRes.stdout), {});
      assert.equal(ssRes.stdout.includes(rawKey), false);

      // 2. PreInvocation recalls memories.
      const transcriptPath = path.join(tempDir, "e2e-transcript.jsonl");
      writeFileSync(
        transcriptPath,
        `${JSON.stringify({
          step_index: 1,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          content: "How should we verify tests?",
        })}\n${JSON.stringify({
          step_index: 2,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          content: "Run node --test.",
        })}\n`,
      );
      const piRes = await runHookSubprocess(
        "scripts/pre-invocation.mjs",
        {
          conversationId: "e2e-conv",
          workspacePaths: [workspaceDir],
          transcriptPath,
          lastUserInput: "How should we verify tests?",
          invocationNum: 1,
        },
        env,
      );
      assert.equal(piRes.code, 0);
      const piJson = JSON.parse(piRes.stdout);
      assert.match(
        piJson.injectSteps[0].systemMessage.systemMessage,
        /Remember to run node --test before committing\./,
      );

      // 3. Stop ingests transcript and prints {}.
      const stopRes = await runHookSubprocess(
        "scripts/stop.mjs",
        {
          conversationId: "e2e-conv",
          cwd: workspaceDir,
          transcriptPath,
        },
        env,
      );
      assert.equal(stopRes.code, 0);
      assert.deepEqual(JSON.parse(stopRes.stdout), {});
      assert.equal(ingestBodies.length, 1);
      assert.equal(ingestBodies[0].session_id, "e2e-conv");
      assert.equal(ingestBodies[0].mode, "smart");
      assert.equal(ingestBodies[0].messages.length, 2);

      // 4. Malformed stdin still exits 0 and emits {}.
      const badStdinRes = await runHookSubprocess(
        "scripts/stop.mjs",
        "{broken",
        env,
      );
      assert.equal(badStdinRes.code, 0);
      assert.deepEqual(JSON.parse(badStdinRes.stdout), {});
    } finally {
      await server.close();
    }
  });
});
