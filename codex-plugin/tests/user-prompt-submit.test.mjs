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
  runUserPromptSubmit,
} from "../hooks/user-prompt-submit.mjs";
import { createTempRoot } from "./test-temp.mjs";

const USER_PROMPT_SUBMIT_ENTRY = path.resolve("./hooks/user-prompt-submit.mjs");
/** @type {Array<"plugin_disabled" | "plugin_missing" | "legacy_paused">} */
const NON_READY_ISSUE_CODES = ["plugin_disabled", "plugin_missing", "legacy_paused"];

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
 * @param {"plugin_disabled" | "plugin_missing" | "legacy_paused"} issueCode
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
