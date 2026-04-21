import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildRuntimeIssueMessage } from "../lib/skill-runtime.mjs";
import { runStore } from "../skills/store/scripts/store.mjs";

function createTempRoot() {
  const parent = path.join(process.cwd(), ".tmp-store-tests");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, "case-"));
}

test("runStore posts a synchronous memory create and prints a safe summary", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "project");
    mkdirSync(projectRoot, { recursive: true });
    let stdoutText = "";
    /** @type {{url?: string, options?: any}} */
    const request = {};

    const result = await runStore(
      ["--content", "The user prefers concise release notes."],
      {
        cwd: projectRoot,
        state: {
          configSource: "global",
          runtime: {
            profileId: "default",
            baseUrl: "https://api.mem9.ai",
            apiKey: "key-save",
            agentId: "codex",
            defaultTimeoutMs: 8100,
          },
        },
        fetchJson: async (
          /** @type {string} */ url,
          /** @type {{method: string, headers: Record<string, string>, body: string, timeoutMs: number}} */ options,
        ) => {
          request.url = url;
          request.options = options;
          return { status: "ok" };
        },
        stdout: {
          write(/** @type {string} */ chunk) {
            stdoutText += chunk;
          },
        },
      },
    );

    assert.equal(request.url, "https://api.mem9.ai/v1alpha2/mem9s/memories");
    assert.deepEqual(request.options, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "key-save",
        "X-Mnemo-Agent-Id": "codex",
      },
      body: JSON.stringify({
        content: "The user prefers concise release notes.",
        sync: true,
      }),
      timeoutMs: 8100,
    });
    assert.equal(result.profileId, "default");
    assert.equal(result.configSource, "global");
    assert.equal(result.content, "The user prefers concise release notes.");
    assert.deepEqual(JSON.parse(stdoutText), result);
    assert.equal(stdoutText.includes("key-save"), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runStore accepts the content from stdin text", async () => {
  const result = await runStore(
    [],
    {
      stdinText: "Remember that release notes should stay short.",
      state: {
        configSource: "global",
        runtime: {
          profileId: "default",
          baseUrl: "https://api.mem9.ai",
          apiKey: "key-save",
          agentId: "codex",
          defaultTimeoutMs: 8000,
        },
      },
      fetchJson: async () => ({ status: "ok" }),
      stdout: { write() {} },
    },
  );

  assert.equal(result.content, "Remember that release notes should stay short.");
});

test("runtime helper explains plugin disabled in Codex settings for manual store", () => {
  const message = buildRuntimeIssueMessage({
    issueCode: "plugin_disabled",
    configSource: "global",
  });

  assert.match(message, /disabled in the Codex plugin settings/);
  assert.match(message, /re-enable the mem9 plugin/i);
});

test("runtime helper explains global legacy pause migration for manual store", () => {
  const message = buildRuntimeIssueMessage({
    issueCode: "legacy_paused",
    configSource: "global",
    effectiveLegacyPausedSource: "global",
  });

  assert.match(message, /paused globally/);
  assert.match(message, /legacy `enabled = false` config/);
  assert.match(message, /\$mem9:setup/);
});

test("runtime helper keeps setup-based repair guidance aligned for manual store", () => {
  const missingConfig = buildRuntimeIssueMessage({
    issueCode: "missing_config",
    configSource: "global",
  });
  const invalidCredentials = buildRuntimeIssueMessage({
    issueCode: "invalid_credentials",
    configSource: "global",
  });
  const missingProfile = buildRuntimeIssueMessage({
    issueCode: "missing_profile",
    configSource: "project",
  });

  assert.match(missingConfig, /not set up/);
  assert.match(missingConfig, /\$mem9:setup/);

  assert.match(invalidCredentials, /\$MEM9_HOME\/\.credentials\.json/);
  assert.match(invalidCredentials, /\$mem9:setup/);

  assert.match(missingProfile, /selected profile/);
  assert.match(missingProfile, /\$mem9:setup/);
  assert.doesNotMatch(missingProfile, /\$mem9:project-config/);
});
