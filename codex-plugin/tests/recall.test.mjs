import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildRecallUrl,
  main,
  runRecall,
} from "../skills/recall/scripts/recall.mjs";
import { buildRuntimeIssueMessage } from "../lib/skill-runtime.mjs";
import { createTempRoot } from "./test-temp.mjs";

test("buildRecallUrl encodes q and limit", () => {
  const url = buildRecallUrl("https://api.mem9.ai/", "remember rust tips", 7);
  assert.equal(
    url,
    "https://api.mem9.ai/v1alpha2/mem9s/memories?q=remember+rust+tips&limit=7",
  );
});

test("buildRecallUrl keeps a configured base path", () => {
  const url = buildRecallUrl("https://api.mem9.ai/base", "remember rust tips", 7);
  assert.equal(
    url,
    "https://api.mem9.ai/base/v1alpha2/mem9s/memories?q=remember+rust+tips&limit=7",
  );
});

test("main prints recall help without calling mem9", async () => {
  let stdoutText = "";

  const result = /** @type {{status: string, command: string, topic: string}} */ (
    await main(
      ["--help"],
      {
        stdout: {
          write(/** @type {string} */ chunk) {
            stdoutText += chunk;
          },
        },
      },
    )
  );

  assert.equal(result.command, "help");
  assert.equal(result.topic, "root");
  assert.match(stdoutText, /^mem9 recall\n/m);
  assert.match(stdoutText, /--query <query>/);
  assert.match(stdoutText, /Successful non-help commands print a sanitized JSON summary\./);
});

test("runRecall calls mem9 with the current runtime and prints a safe summary", async () => {
  const tempRoot = createTempRoot("recall");

  try {
    const projectRoot = path.join(tempRoot, "project");
    mkdirSync(projectRoot, { recursive: true });
    let stdoutText = "";
    /** @type {{url?: string, options?: any}} */
    const request = {};

    const result = await runRecall(
      ["--query", "team preferences"],
      {
        cwd: projectRoot,
        state: {
          configSource: "project",
          runtime: {
            profileId: "work",
            baseUrl: "https://api.mem9.ai",
            apiKey: "key-search",
            agentId: "codex",
            searchTimeoutMs: 15200,
          },
        },
        fetchJson: async (
          /** @type {string} */ url,
          /** @type {{method: string, headers: Record<string, string>, timeoutMs: number}} */ options,
        ) => {
          request.url = url;
          request.options = options;
          return {
            memories: [
              {
                id: "m1",
                content: "The team prefers small focused commits.",
                memory_type: "insight",
                tags: ["workflow"],
                score: 0.84,
                relative_age: "2 days ago",
              },
            ],
          };
        },
        stdout: {
          write(/** @type {string} */ chunk) {
            stdoutText += chunk;
          },
        },
      },
    );

    assert.equal(
      request.url,
      "https://api.mem9.ai/v1alpha2/mem9s/memories?q=team+preferences&limit=10",
    );
    assert.deepEqual(request.options, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "key-search",
        "X-Mnemo-Agent-Id": "codex",
      },
      timeoutMs: 15200,
    });
    assert.equal(result.profileId, "work");
    assert.equal(result.configSource, "project");
    assert.equal(result.memoryCount, 1);
    assert.deepEqual(result.memories, [
      {
        id: "m1",
        content: "The team prefers small focused commits.",
        memoryType: "insight",
        tags: ["workflow"],
        score: 0.84,
        relativeAge: "2 days ago",
      },
    ]);
    assert.deepEqual(JSON.parse(stdoutText), result);
    assert.equal(stdoutText.includes("key-search"), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runRecall accepts the query from stdin text", async () => {
  const result = await runRecall(
    [],
    {
      stdinText: "release checklist",
      state: {
        configSource: "global",
        runtime: {
          profileId: "default",
          baseUrl: "https://api.mem9.ai",
          apiKey: "key-search",
          agentId: "codex",
          searchTimeoutMs: 15000,
        },
      },
      fetchJson: async () => ({ memories: [] }),
      stdout: { write() {} },
    },
  );

  assert.equal(result.query, "release checklist");
});

test("runtime helper explains how to repair a missing mem9 api key", () => {
  const message = buildRuntimeIssueMessage({
    issueCode: "missing_api_key",
    configSource: "global",
  });

  assert.match(message, /\$mem9:setup/);
  assert.match(message, /\$MEM9_HOME\/\.credentials\.json/);
  assert.match(message, /MEM9_API_KEY/);
});

test("runtime helper explains plugin reinstall recovery for manual recall", () => {
  const message = buildRuntimeIssueMessage({
    issueCode: "plugin_missing",
    configSource: "global",
  });

  assert.match(message, /hook runtime needs repair/);
  assert.match(message, /\/plugins/);
  assert.match(message, /\$mem9:cleanup/);
  assert.match(message, /\$mem9:setup/);
  assert.doesNotMatch(message, /`mem9` is missing from `\/plugins`/);
  assert.ok(message.indexOf("/plugins") < message.indexOf("$mem9:cleanup"));
  assert.ok(message.indexOf("$mem9:cleanup") < message.indexOf("$mem9:setup"));
});

test("runtime helper explains project legacy pause migration for manual recall", () => {
  const message = buildRuntimeIssueMessage({
    issueCode: "legacy_paused",
    configSource: "project",
    effectiveLegacyPausedSource: "project",
  });

  assert.match(message, /paused for this repository/);
  assert.match(message, /legacy `enabled = false` override/);
  assert.match(message, /run `\$mem9:setup` in this repository/i);
});

test("runtime helper explains broken project config without project-config guidance", () => {
  const message = buildRuntimeIssueMessage({
    issueCode: "invalid_config",
    configSource: "global",
    projectConfigMatched: true,
  });

  assert.match(message, /\.codex\/mem9\/config\.json/);
  assert.match(message, /\$mem9:setup/);
  assert.doesNotMatch(message, /\$mem9:project-config/);
});
