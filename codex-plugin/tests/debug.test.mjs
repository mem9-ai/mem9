import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  appendDebugLog,
  debugEnabled,
  resolveDebugLogFile,
} from "../runtime/shared/debug.mjs";

function createTempRoot() {
  const parent = path.join(process.cwd(), ".tmp-debug-tests");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, "case-"));
}

test("debugEnabled only turns on for MEM9_DEBUG=1", () => {
  assert.equal(debugEnabled({ MEM9_DEBUG: "1" }), true);
  assert.equal(debugEnabled({ MEM9_DEBUG: "true" }), false);
  assert.equal(debugEnabled({}), false);
});

test("resolveDebugLogFile defaults to the codex global logs path", () => {
  assert.equal(
    resolveDebugLogFile({ codexHome: "/CODEX_HOME", env: {} }),
    path.join("/CODEX_HOME", "mem9", "logs", "codex-hooks.jsonl"),
  );
});

test("appendDebugLog writes sanitized jsonl records to the codex-local log path", () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");

    const wrote = appendDebugLog({
      hook: "Stop",
      stage: "hook_failed",
      env: { MEM9_DEBUG: "1" },
      cwd: projectRoot,
      codexHome,
      mem9Home,
      fields: {
        configSource: "project",
        profileId: "work",
        projectConfigMatched: true,
        projectPath: path.join(projectRoot, ".codex", "hooks.json"),
        credentialsPath: path.join(mem9Home, ".credentials.json"),
      },
      now: () => new Date("2026-04-21T10:11:12.000Z"),
    });

    assert.equal(wrote, true);

    const logFile = path.join(codexHome, "mem9", "logs", "codex-hooks.jsonl");
    assert.equal(existsSync(logFile), true);

    const entry = JSON.parse(readFileSync(logFile, "utf8").trim());
    assert.deepEqual(entry, {
      ts: "2026-04-21T10:11:12.000Z",
      hook: "Stop",
      stage: "hook_failed",
      configSource: "project",
      profileId: "work",
      projectConfigMatched: true,
      projectPath: "$PROJECT_ROOT/.codex/hooks.json",
      credentialsPath: "$MEM9_HOME/.credentials.json",
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
