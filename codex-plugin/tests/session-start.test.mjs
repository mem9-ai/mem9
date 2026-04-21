import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionStartMessage,
  runSessionStart,
} from "../runtime/session-start.mjs";

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

test("session start reports project disable state with reset guidance", () => {
  const message = buildSessionStartMessage({
    configSource: "project",
    profileId: "work",
    issueCode: "disabled",
  });

  assert.match(message, /disabled for this project/);
  assert.match(message, /\$mem9:project-config --reset/);
  assert.match(message, /will not recall or save/);
});

test("session start reports invalid project override with project-config guidance", () => {
  const message = buildSessionStartMessage({
    configSource: "project",
    issueCode: "invalid_config",
  });

  assert.match(message, /\.codex\/mem9\/config\.json/);
  assert.match(message, /\$mem9:project-config/);
  assert.match(message, /--reset/);
});

test("session start explains how to repair a project missing profile", () => {
  const message = buildSessionStartMessage({
    configSource: "project",
    issueCode: "missing_profile",
  });

  assert.match(message, /\$mem9:setup/);
  assert.match(message, /\$mem9:project-config/);
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
