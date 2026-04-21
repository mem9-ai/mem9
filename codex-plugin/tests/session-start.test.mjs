import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionStartMessage,
  runSessionStart,
} from "../hooks/session-start.mjs";

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

test("session start reports plugin missing with cleanup and reinstall guidance", () => {
  const message = buildSessionStartMessage({
    configSource: "global",
    issueCode: "plugin_missing",
  });

  assert.match(message, /hooks remain installed/);
  assert.match(message, /\$mem9:cleanup/);
  assert.match(message, /reinstall the mem9 plugin/);
  assert.match(message, /\$mem9:setup/);
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
