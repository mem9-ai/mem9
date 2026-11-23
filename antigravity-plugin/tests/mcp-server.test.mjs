// @ts-check

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TOOL_DEFINITIONS,
  createFrameReader,
  executeToolCall,
  handleJsonRpcMessage,
} from "../scripts/mcp-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");

/**
 * @param {(ctx: { tempDir: string, mem9Home: string, workspaceDir: string }) => Promise<void>} fn
 */
async function withTempWorkspace(fn) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mem9-agy-mcp-"));
  const mem9Home = path.join(tempDir, "mem9-home");
  const workspaceDir = path.join(tempDir, "workspace");
  mkdirSync(mem9Home, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  try {
    await fn({ tempDir, mem9Home, workspaceDir });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {string} mem9Home
 * @param {Record<string, { label: string, baseUrl: string, apiKey: string }>} profiles
 * @param {string} activeProfile
 * @param {string} [agentId]
 */
function seedCredentialsAndConfig(mem9Home, profiles, activeProfile, agentId) {
  writeFileSync(
    path.join(mem9Home, ".credentials.json"),
    JSON.stringify({ schemaVersion: 1, profiles }),
    { mode: 0o600 },
  );
  const stateDir = path.join(mem9Home, "antigravity");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    path.join(stateDir, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      profileId: activeProfile,
      ...(agentId ? { agentId } : {}),
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
 * @param {unknown} message
 * @returns {string}
 */
function frameContentLength(message) {
  const json = JSON.stringify(message);
  const byteLength = Buffer.byteLength(json, "utf8");
  return `Content-Length: ${byteLength}\r\n\r\n${json}`;
}

test("mcp_config.json configures mem9 stdio server without variables or redundant env", () => {
  const mcpConfig = JSON.parse(
    readFileSync(path.join(PLUGIN_ROOT, "mcp_config.json"), "utf8"),
  );
  assert.equal(mcpConfig.variables, undefined);
  assert.deepEqual(mcpConfig.mcpServers.mem9, {
    command: "node",
    args: ["${PLUGIN_ROOT}/scripts/mcp-server.mjs"],
  });
});

test("createFrameReader handles newline-delimited, Content-Length multibyte UTF-8, and errors", () => {
  /** @type {string[]} */
  const frames = [];
  /** @type {string[]} */
  const errors = [];
  const reader = createFrameReader(
    (frame) => frames.push(frame),
    (msg) => errors.push(msg),
  );

  const utf8Msg = { jsonrpc: "2.0", id: 1, method: "ping", params: { text: "你好🧠" } };
  const framed = frameContentLength(utf8Msg);
  const half = Math.floor(framed.length / 2);

  const lfMsg = '{"jsonrpc":"2.0","id":3,"method":"ping"}';
  reader.push(framed.slice(0, half));
  reader.push(framed.slice(half));
  reader.push('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
  reader.push(`Content-Type: application/json\nContent-Length: ${Buffer.byteLength(lfMsg, "utf8")}\n\n${lfMsg}`);
  reader.push('{"jsonrpc":"2.0","id":4,"method":"ping"}');
  reader.end();

  assert.equal(errors.length, 0);
  assert.equal(frames.length, 4);
  assert.deepEqual(JSON.parse(frames[0]), utf8Msg);
  assert.equal(JSON.parse(frames[1]).id, 2);
  assert.equal(JSON.parse(frames[2]).id, 3);
  assert.equal(JSON.parse(frames[3]).id, 4);

  // Invalid frame triggers onFrameError without breaking subsequent frames.
  reader.push("not-json-or-header\n");
  reader.push('{"jsonrpc":"2.0","id":5,"method":"ping"}\n');
  assert.equal(errors.length, 1);
  assert.equal(frames.length, 5);
  assert.equal(JSON.parse(frames[4]).id, 5);
});

test("handleJsonRpcMessage implements MCP handshake, lists, notifications, and error codes", async () => {
  const initRes = await handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  });
  assert.equal(initRes?.id, 1);
  assert.equal(/** @type {any} */ (initRes?.result).protocolVersion, "2024-11-05");
  assert.equal(/** @type {any} */ (initRes?.result).serverInfo.name, "mem9");

  const notifRes = await handleJsonRpcMessage({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assert.equal(notifRes, null);

  const pingRes = await handleJsonRpcMessage({ jsonrpc: "2.0", id: 2, method: "ping" });
  assert.deepEqual(pingRes?.result, {});

  const resourcesRes = await handleJsonRpcMessage({ jsonrpc: "2.0", id: 3, method: "resources/list" });
  assert.deepEqual(resourcesRes?.result, { resources: [] });

  const promptsRes = await handleJsonRpcMessage({ jsonrpc: "2.0", id: 4, method: "prompts/list" });
  assert.deepEqual(promptsRes?.result, { prompts: [] });

  const toolsRes = await handleJsonRpcMessage({ jsonrpc: "2.0", id: 5, method: "tools/list" });
  const toolNames = /** @type {any} */ (toolsRes?.result).tools.map((t) => t.name);
  assert.deepEqual(toolNames, [
    "memory_store",
    "memory_search",
    "memory_get",
    "memory_update",
    "memory_delete",
    "memory_status",
  ]);
  assert.equal(TOOL_DEFINITIONS.length, 6);

  const missingMethodRes = await handleJsonRpcMessage({ jsonrpc: "2.0", id: 6, method: "unknown/method" });
  assert.equal(/** @type {any} */ (missingMethodRes?.error).code, -32601);

  const unknownToolRes = await handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "nonexistent_tool", arguments: {} },
  });
  assert.equal(/** @type {any} */ (unknownToolRes?.error).code, -32602);
});

test("memory_status dynamically respects WORKSPACE_ROOT project overrides and redacts all API keys", async () => {
  await withTempWorkspace(async ({ mem9Home, workspaceDir }) => {
    const defaultSecret = "mk_default_super_secret_1111";
    const workSecret = "mk_work_super_secret_9999";

    seedCredentialsAndConfig(
      mem9Home,
      {
        default: { label: "Default", baseUrl: "https://default.mem9.local", apiKey: defaultSecret },
        work: { label: "Work", baseUrl: "https://work.mem9.local", apiKey: workSecret },
      },
      "default",
      "antigravity",
    );

    const projectCfgDir = path.join(workspaceDir, ".agents", "mem9");
    mkdirSync(projectCfgDir, { recursive: true });
    writeFileSync(
      path.join(projectCfgDir, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        profileId: "work",
        agentId: "project-agent",
      }),
    );

    const res = await executeToolCall("memory_status", {}, {
      mem9Home,
      env: { WORKSPACE_ROOT: workspaceDir },
    });

    assert.equal(res.ok, true);
    assert.equal(res.profileId, "work");
    assert.equal(res.agentId, "project-agent");
    assert.equal(res.configSource, "project");
    assert.equal(res.apiKeyPreview, "mk_w...9999");

    const serialized = JSON.stringify(res);
    assert.equal(serialized.includes(defaultSecret), false);
    assert.equal(serialized.includes(workSecret), false);
  });
});

test("MCP tools expose opencode-compatible shapes and structured runtime quota errors", async () => {
  await withTempWorkspace(async ({ mem9Home, workspaceDir }) => {
    seedCredentialsAndConfig(
      mem9Home,
      {
        default: { label: "Default", baseUrl: "https://mock.mem9.local", apiKey: "mk_tool_secret_12345" },
      },
      "default",
    );

    const searchResult = await executeToolCall(
      "memory_search",
      { q: "theme", limit: 5 },
      {
        mem9Home,
        env: { WORKSPACE_ROOT: workspaceDir },
        fetchJson: async () => ({
          memories: [{ id: "m1", content: "Dark theme preferred", score: 0.92 }],
          total: 1,
          limit: 5,
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
        }),
      },
    );
    assert.equal(searchResult.ok, true);
    assert.equal(searchResult.runtimeState, undefined);
    assert.match(String(searchResult.message), /82%/);

    // Quota denial maps cleanly via toolErrorPayload.
    const quotaDeniedResult = await executeToolCall(
      "memory_store",
      { content: "Use tabs" },
      {
        mem9Home,
        env: { WORKSPACE_ROOT: workspaceDir },
        fetchJson: async () => {
          const err = new Error("Spending limit exhausted");
          Object.assign(err, {
            status: 402,
            data: {
              error: "Spending limit exhausted",
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
          });
          throw err;
        },
      },
    );
    assert.equal(quotaDeniedResult.ok, false);
    assert.equal(quotaDeniedResult.code, "runtime_quota_denied");
    assert.equal(quotaDeniedResult.status_code, 402);
    assert.equal(
      quotaDeniedResult.action_url,
      "https://console.mem9.ai/console/billing/plan",
    );
  });
});

test("Spawned stdio mcp-server handles all 6 tools end-to-end without leaking API keys", async () => {
  await withTempWorkspace(async ({ mem9Home, workspaceDir }) => {
    const rawKey = "mk_stdio_secret_abcdef7890";
    /** @type {Map<string, any>} */
    const store = new Map();
    let seq = 0;

    const server = await startMockServer((req, body, res) => {
      if (req.headers["x-api-key"] !== rawKey) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      if (req.method === "GET" && req.url === "/v1alpha2/mem9s/runtime-state") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ mem9ApiKey: { status: "active" }, meters: [] }));
        return;
      }

      if (req.method === "POST" && req.url === "/v1alpha2/mem9s/memories") {
        const input = JSON.parse(body);
        seq += 1;
        const id = `mem-${seq}`;
        const record = {
          id,
          content: input.content,
          tags: input.tags ?? [],
          metadata: input.metadata ?? {},
          memory_type: input.memory_type ?? "pinned",
          created_at: "2026-11-23T00:00:00.000Z",
          updated_at: "2026-11-23T00:00:00.000Z",
        };
        store.set(id, record);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(record));
        return;
      }

      if (req.method === "GET" && req.url?.startsWith("/v1alpha2/mem9s/memories?")) {
        const memories = [...store.values()];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ memories, total: memories.length, limit: 20, offset: 0 }),
        );
        return;
      }

      const match = req.url?.match(/^\/v1alpha2\/mem9s\/memories\/([^/]+)$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const existing = store.get(id);
        if (!existing) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        if (req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(existing));
          return;
        }
        if (req.method === "PUT") {
          const patch = JSON.parse(body);
          const updated = { ...existing, ...patch, updated_at: "2026-11-23T00:01:00.000Z" };
          store.set(id, updated);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(updated));
          return;
        }
        if (req.method === "DELETE") {
          store.delete(id);
          res.writeHead(204);
          res.end();
          return;
        }
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    try {
      seedCredentialsAndConfig(
        mem9Home,
        { default: { label: "Default", baseUrl: server.baseUrl, apiKey: rawKey } },
        "default",
      );

      const child = spawn(
        process.execPath,
        [path.join(PLUGIN_ROOT, "scripts", "mcp-server.mjs")],
        {
          cwd: PLUGIN_ROOT,
          env: isolatedEnv({
            MEM9_HOME: mem9Home,
            WORKSPACE_ROOT: workspaceDir,
          }),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      const requests = [
        frameContentLength({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05" },
        }),
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
        `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "memory_status", arguments: { check_remote: true } },
        })}\n`,
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "memory_store",
            arguments: { content: "Prefer strict JSDoc", tags: ["style"] },
          },
        })}\n`,
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "memory_search", arguments: { q: "JSDoc", limit: 10 } },
        })}\n`,
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: { name: "memory_get", arguments: { id: "mem-1" } },
        })}\n`,
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "memory_update",
            arguments: { id: "mem-1", content: "Prefer strict JSDoc with ts-check" },
          },
        })}\n`,
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 8,
          method: "tools/call",
          params: { name: "memory_delete", arguments: { id: "mem-1" } },
        })}\n`,
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: { name: "memory_get", arguments: { id: "mem-1" } },
        })}\n`,
      ];

      child.stdin.end(requests.join(""));

      const exitCode = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });

      assert.equal(exitCode, 0);
      assert.equal(stderr, "");
      assert.equal(stdout.includes(rawKey), false);

      const responses = stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(responses.length, 9);

      const byId = new Map(responses.map((r) => [r.id, r]));
      assert.equal(byId.get(1).result.serverInfo.name, "mem9");
      assert.equal(byId.get(2).result.tools.length, 6);

      const statusPayload = JSON.parse(byId.get(3).result.content[0].text);
      assert.equal(statusPayload.ok, true);
      assert.equal(statusPayload.apiKeyPreview, "mk_s...7890");
      assert.equal(statusPayload.remoteStatus, "ok");

      const storePayload = JSON.parse(byId.get(4).result.content[0].text);
      assert.equal(storePayload.ok, true);
      assert.equal(storePayload.data.id, "mem-1");

      const searchPayload = JSON.parse(byId.get(5).result.content[0].text);
      assert.equal(searchPayload.ok, true);
      assert.equal(searchPayload.memories.length, 1);

      const getPayload = JSON.parse(byId.get(6).result.content[0].text);
      assert.equal(getPayload.ok, true);
      assert.equal(getPayload.data.content, "Prefer strict JSDoc");

      const updatePayload = JSON.parse(byId.get(7).result.content[0].text);
      assert.equal(updatePayload.ok, true);
      assert.equal(updatePayload.data.content, "Prefer strict JSDoc with ts-check");

      const deletePayload = JSON.parse(byId.get(8).result.content[0].text);
      assert.equal(deletePayload.ok, true);

      const missingGetPayload = JSON.parse(byId.get(9).result.content[0].text);
      assert.equal(missingGetPayload.ok, false);
      assert.equal(missingGetPayload.error, "memory not found");
      assert.equal(byId.get(9).result.isError, true);
    } finally {
      await server.close();
    }
  });
});
