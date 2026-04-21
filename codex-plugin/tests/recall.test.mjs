import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildRecallUrl,
  runRecall,
} from "../skills/recall/scripts/recall.mjs";
import { buildRuntimeIssueMessage } from "../lib/skill-runtime.mjs";

function createTempRoot() {
  const parent = path.join(process.cwd(), ".tmp-recall-tests");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, "case-"));
}

test("buildRecallUrl encodes q, agent_id, and limit", () => {
  const url = buildRecallUrl("https://api.mem9.ai/", "remember rust tips", "codex", 7);
  assert.equal(
    url,
    "https://api.mem9.ai/v1alpha2/mem9s/memories?q=remember+rust+tips&agent_id=codex&limit=7",
  );
});

test("runRecall calls mem9 with the current runtime and prints a safe summary", async () => {
  const tempRoot = createTempRoot();

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
      "https://api.mem9.ai/v1alpha2/mem9s/memories?q=team+preferences&agent_id=codex&limit=10",
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
});
