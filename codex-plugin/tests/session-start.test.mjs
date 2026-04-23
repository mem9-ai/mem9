import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  appendUpgradeNotice,
  buildSessionStartMessage,
  runSessionStart,
} from "../hooks/session-start.mjs";
import { createTempRoot } from "./test-temp.mjs";

const SESSION_START_ENTRY = path.resolve("./hooks/session-start.mjs");

/**
 * @param {string} filePath
 * @param {unknown} value
 */
function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

test("session start emits ready context for a project override", async () => {
  const output = await runSessionStart({
    state: {
      configSource: "project",
      profileId: "work",
      issueCode: "ready",
    },
  });

  const parsed = JSON.parse(output);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(parsed.hookSpecificOutput.additionalContext, /local override/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /profile `work`/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /recall on user prompt submit/);
});

test("session start mentions ready fallback when a broken project override is ignored", () => {
  const message = buildSessionStartMessage({
    configSource: "global",
    profileId: "default",
    warnings: ["invalid_project_config_ignored"],
    issueCode: "ready",
  });

  assert.match(message, /global default config/);
  assert.match(message, /fell back to the global default/);
});

test("session start reports plugin missing with reinstall-before-cleanup guidance", () => {
  const message = buildSessionStartMessage({
    configSource: "global",
    issueCode: "plugin_missing",
  });

  assert.match(message, /hooks remain installed/);
  assert.match(message, /hook runtime needs repair/);
  assert.match(message, /\/plugins/);
  assert.match(message, /\$mem9:cleanup/);
  assert.match(message, /\$mem9:setup/);
  assert.ok(message.indexOf("/plugins") < message.indexOf("$mem9:cleanup"));
  assert.ok(message.indexOf("$mem9:cleanup") < message.indexOf("$mem9:setup"));
});

test("session start appends upgrade notices after the runtime message", async () => {
  const output = await runSessionStart({
    state: {
      configSource: "global",
      profileId: "default",
      issueCode: "ready",
    },
    upgradeNotice: "mem9 upgraded to v0.2.0. Restart picked it up.",
  });

  const parsed = JSON.parse(output);
  const message = parsed.hookSpecificOutput.additionalContext;
  assert.match(message, /global default config/);
  assert.match(message, /mem9 upgraded to v0\.2\.0/);
  assert.ok(message.indexOf("global default config") < message.indexOf("mem9 upgraded to v0.2.0"));
});

test("session start keeps repair guidance ahead of upgrade notices", () => {
  const message = appendUpgradeNotice(
    buildSessionStartMessage({
      configSource: "project",
      issueCode: "missing_profile",
    }),
    "mem9 upgraded to v0.2.0. Restart picked it up.",
  );

  assert.match(message, /\$mem9:setup/);
  assert.match(message, /mem9 upgraded to v0\.2\.0/);
  assert.ok(message.indexOf("$mem9:setup") < message.indexOf("mem9 upgraded to v0.2.0"));
});

test("session start reports project legacy pause with migration guidance", () => {
  const message = buildSessionStartMessage({
    configSource: "project",
    legacyPausedSources: ["global", "project"],
    effectiveLegacyPausedSource: "project",
    issueCode: "legacy_paused",
  });

  assert.match(message, /paused for this repository/);
  assert.match(message, /legacy `enabled = false` override/);
  assert.match(message, /\$mem9:setup/);
});

test("session start reports global legacy pause with migration guidance", () => {
  const message = buildSessionStartMessage({
    configSource: "global",
    legacyPausedSources: ["global"],
    effectiveLegacyPausedSource: "global",
    issueCode: "legacy_paused",
  });

  assert.match(message, /paused globally/);
  assert.match(message, /legacy `enabled = false` config/);
  assert.match(message, /\$mem9:setup/);
});

test("session start reports invalid project override with repair guidance", () => {
  const message = buildSessionStartMessage({
    configSource: "global",
    projectConfigMatched: true,
    issueCode: "invalid_config",
  });

  assert.match(message, /\.codex\/mem9\/config\.json/);
  assert.match(message, /\$mem9:setup/);
  assert.match(message, /reapply or clear project scope/);
  assert.match(message, /\$CODEX_HOME\/mem9\/config\.json/);
});

test("session start explains how to repair a project missing profile", () => {
  const message = buildSessionStartMessage({
    configSource: "project",
    issueCode: "missing_profile",
  });

  assert.match(message, /\$mem9:setup/);
  assert.match(message, /apply project scope/);
  assert.match(message, /selected profile/);
});

test("session start explains api key repair paths", () => {
  const message = buildSessionStartMessage({
    configSource: "global",
    issueCode: "missing_api_key",
  });

  assert.match(message, /\$mem9:setup/);
  assert.match(message, /\$MEM9_HOME\/\.credentials\.json/);
  assert.match(message, /MEM9_API_KEY/);
});

test("session start skips upgrade state writes when runtime is not ready", async () => {
  const tempRoot = createTempRoot("session-start");

  try {
    const cwd = path.join(tempRoot, "workspace");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    mkdirSync(cwd, { recursive: true });
    writeJson(path.join(codexHome, "mem9", "install.json"), {
      schemaVersion: 1,
      marketplaceName: "mem9-ai",
      pluginName: "mem9",
      shimVersion: 1,
    });
    mkdirSync(
      path.join(codexHome, "plugins", "cache", "mem9-ai", "mem9", "0.2.0"),
      { recursive: true },
    );
    writeFileSync(path.join(codexHome, "config.toml"), "\n");
    mkdirSync(mem9Home, { recursive: true });

    const result = await runNodeHook(SESSION_START_ENTRY, {
      cwd,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        MEM9_HOME: mem9Home,
      },
      input: "{}",
    });

    assert.equal(result.code, 0);
    assert.equal(existsSync(path.join(codexHome, "mem9", "state.json")), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
