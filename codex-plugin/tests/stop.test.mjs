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

import { buildIngestUrl, runStop } from "../hooks/stop.mjs";
import {
  parseTranscriptText,
  selectStopWindow,
} from "../hooks/shared/transcript.mjs";
import { createTempRoot } from "./test-temp.mjs";

const STOP_ENTRY = path.resolve("./hooks/stop.mjs");
/** @type {Array<"plugin_disabled" | "plugin_missing" | "legacy_paused">} */
const NON_READY_ISSUE_CODES = ["plugin_disabled", "plugin_missing", "legacy_paused"];

test("buildIngestUrl keeps a configured base path", () => {
  assert.equal(
    buildIngestUrl("https://api.mem9.ai/base"),
    "https://api.mem9.ai/base/v1alpha2/mem9s/memories",
  );
});

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
  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"complete"}');
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
      ? '[plugins."mem9@mem9-ai"] # disabled for this run\nenabled = false\n'
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

test("transcript parser falls back to response messages when event messages are absent", () => {
  const transcript = [
    JSON.stringify({ item: { type: "response_item", type2: "ignored" } }),
    JSON.stringify({
      item: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "## Skills" }],
      },
    }),
    JSON.stringify({ item: { type: "function_call", name: "shell_command" } }),
    JSON.stringify({
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    }),
    JSON.stringify({
      item: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "<relevant-memories>\n1. old\n</relevant-memories>\nreply",
          },
        ],
      },
    }),
  ].join("\n");

  const messages = parseTranscriptText(transcript);
  assert.deepEqual(messages, [
    { role: "user", content: "hello" },
    { role: "assistant", content: "reply" },
  ]);
});

test("transcript parser prefers event messages over response message context", () => {
  const transcript = [
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "# AGENTS.md instructions for ~/repo\n<INSTRUCTIONS>\n...\n</INSTRUCTIONS>",
          },
        ],
      },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "real user prompt" }],
      },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "real user prompt",
      },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "visible assistant reply",
      },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "visible assistant reply" }],
      },
    }),
  ].join("\n");

  const messages = parseTranscriptText(transcript);
  assert.deepEqual(messages, [
    { role: "user", content: "real user prompt" },
    { role: "assistant", content: "visible assistant reply" },
  ]);
});

test("transcript parser supports Codex response_item rollout payloads as fallback", () => {
  const transcript = [
    JSON.stringify({
      type: "session_meta",
      payload: { session_id: "session-1" },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "system" }],
      },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello from Codex" }],
      },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "reply from Codex" }],
      },
    }),
    JSON.stringify({
      type: "response_item",
      payload: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "follow up" }],
        },
        {
          type: "function_call",
          name: "shell",
          arguments: "{}",
          call_id: "call-1",
        },
      ],
    }),
  ].join("\n");

  const messages = parseTranscriptText(transcript);
  assert.deepEqual(messages, [
    { role: "user", content: "hello from Codex" },
    { role: "assistant", content: "reply from Codex" },
    { role: "user", content: "follow up" },
  ]);
});

test("selectStopWindow keeps the newest budget-fitting slice", () => {
  /** @type {import("../hooks/shared/transcript.mjs").IngestMessage[]} */
  const messages = [
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
    { role: "assistant", content: "a2" },
  ];

  assert.deepEqual(
    selectStopWindow(messages, 2, 200_000),
    [
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ],
  );
});

test("selectStopWindow drops an oversized newest message instead of exceeding the byte cap", () => {
  const oversized = "x".repeat(210_000);

  assert.deepEqual(
    selectStopWindow(
      [{ role: "assistant", content: oversized }],
      20,
      200_000,
    ),
    [],
  );
});

test("selectStopWindow skips an oversized newest message and keeps the next recent fitting window", () => {
  const oversized = "x".repeat(210_000);

  assert.deepEqual(
    selectStopWindow(
      [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "assistant", content: oversized },
      ],
      20,
      200_000,
    ),
    [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ],
  );
});

test("selectStopWindow falls back to the newest window that still includes a user message", () => {
  const oversized = "x".repeat(210_000);

  assert.deepEqual(
    selectStopWindow(
      [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: oversized },
        { role: "assistant", content: "a2" },
      ],
      20,
      200_000,
    ),
    [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ],
  );
});

test("stop posts smart ingest with a recent message window", async () => {
  /** @type {unknown} */
  let requestBody = null;
  /** @type {number | null} */
  let timeoutMs = null;
  /** @type {Array<{stage: string, fields: Record<string, unknown> | undefined}>} */
  const debugEvents = [];

  const result = await runStop({
    sessionId: "session-1",
    runtime: {
      baseUrl: "https://api.mem9.ai",
      apiKey: "key-1",
      agentId: "codex",
      defaultTimeoutMs: 8_000,
    },
    transcriptMessages: [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ],
    async post(_url, body, options) {
      requestBody = body;
      timeoutMs = options.timeoutMs;
      return { status: "complete" };
    },
    debug(stage, fields) {
      debugEvents.push({ stage, fields });
    },
  });

  assert.equal(timeoutMs, 8_000);
  assert.deepEqual(requestBody, {
    session_id: "session-1",
    agent_id: "codex",
    mode: "smart",
    messages: [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ],
  });
  assert.deepEqual(result, requestBody);
  assert.deepEqual(
    debugEvents.map((event) => event.stage),
    ["ingest_window_selected", "ingest_sent"],
  );
});

for (const issueCode of NON_READY_ISSUE_CODES) {
  test(`stop entrypoint skips ${issueCode} without calling the mem9 api`, async () => {
    const tempRoot = createTempRoot();
    const server = await createCountingServer();

    try {
      const runtime = createRuntimeLayout(tempRoot, issueCode, server.origin);
      const transcriptPath = path.join(tempRoot, "session.jsonl");
      writeFileSync(
        transcriptPath,
        [
          JSON.stringify({
            type: "event_msg",
            payload: { type: "user_message", message: "hello" },
          }),
          JSON.stringify({
            type: "event_msg",
            payload: { type: "agent_message", message: "world" },
          }),
        ].join("\n"),
      );

      const result = await runNodeHook(STOP_ENTRY, {
        cwd: runtime.cwd,
        env: {
          ...process.env,
          CODEX_HOME: runtime.codexHome,
          MEM9_HOME: runtime.mem9Home,
        },
        input: JSON.stringify({
          cwd: runtime.cwd,
          session_id: "session-1",
          transcript_path: transcriptPath,
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
