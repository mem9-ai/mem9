import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_UPDATE_CHECK,
  comparePluginVersions,
  normalizeUpdateCheckConfig,
  resolveUpgradeNotice,
} from "../lib/update-check.mjs";

test("normalizeUpdateCheckConfig returns the runtime defaults", () => {
  assert.deepEqual(normalizeUpdateCheckConfig(undefined), DEFAULT_UPDATE_CHECK);
  assert.deepEqual(
    normalizeUpdateCheckConfig({
      enabled: false,
      intervalHours: 48,
    }),
    {
      enabled: false,
      intervalHours: 48,
    },
  );
});

test("comparePluginVersions prefers higher semantic versions and ignores local builds", () => {
  assert.equal(comparePluginVersions("0.2.0", "0.1.9"), 1);
  assert.equal(comparePluginVersions("0.2.0-beta.1", "0.2.0-beta.2"), -1);
  assert.equal(comparePluginVersions("0.2.0", "0.2.0-beta.2"), 1);
  assert.equal(comparePluginVersions("local", "0.2.0"), null);
});

test("resolveUpgradeNotice emits a one-time local notice per plugin version", async () => {
  const first = await resolveUpgradeNotice({
    pluginVersion: "0.2.0",
    runtime: {
      updateCheck: DEFAULT_UPDATE_CHECK,
    },
    stateFile: {
      schemaVersion: 1,
      lastSeenVersion: "0.1.0",
    },
    manifest: null,
  });

  assert.match(first.message, /mem9 upgraded to v0\.2\.0/);
  assert.match(first.message, /Run `\$mem9:setup` once only if this session later asks for migration/);
  assert.equal(first.state.lastSeenVersion, "0.2.0");

  const second = await resolveUpgradeNotice({
    pluginVersion: "0.2.0",
    runtime: {
      updateCheck: DEFAULT_UPDATE_CHECK,
    },
    stateFile: first.state,
    manifest: null,
  });

  assert.equal(second.message, "");
  assert.equal(second.state.lastSeenVersion, "0.2.0");
});

test("resolveUpgradeNotice respects disabled remote update checks", async () => {
  let fetchCalls = 0;

  const result = await resolveUpgradeNotice({
    pluginVersion: "0.1.0",
    runtime: {
      updateCheck: {
        enabled: false,
        intervalHours: 24,
      },
    },
    stateFile: {
      schemaVersion: 1,
      lastSeenVersion: "0.1.0",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.message, "");
  assert.equal(result.state.lastSeenVersion, "0.1.0");
  assert.equal(result.state.lastCheckedAt, undefined);
});

test("resolveUpgradeNotice surfaces a remote update once per released version", async () => {
  const first = await resolveUpgradeNotice({
    pluginVersion: "0.1.0",
    runtime: {
      updateCheck: DEFAULT_UPDATE_CHECK,
    },
    stateFile: {
      schemaVersion: 1,
      lastSeenVersion: "0.1.0",
    },
    manifest: {
      latestVersion: "0.2.0",
      upgradeCommand: "codex plugin marketplace upgrade mem9-ai",
    },
    now: "2026-04-22T00:00:00.000Z",
  });

  assert.match(first.message, /mem9 v0\.2\.0 is available/);
  assert.match(first.message, /codex plugin marketplace upgrade mem9-ai/);
  assert.match(first.message, /then restart Codex/);
  assert.match(first.message, /local checkout updates/);
  assert.equal(first.state.lastCheckedAt, "2026-04-22T00:00:00.000Z");
  assert.equal(first.state.lastNotifiedVersion, "0.2.0");

  const second = await resolveUpgradeNotice({
    pluginVersion: "0.1.0",
    runtime: {
      updateCheck: DEFAULT_UPDATE_CHECK,
    },
    stateFile: first.state,
    manifest: {
      latestVersion: "0.2.0",
      upgradeCommand: "codex plugin marketplace upgrade mem9-ai",
    },
    now: "2026-04-23T01:00:00.000Z",
  });

  assert.equal(second.message, "");
  assert.equal(second.state.lastNotifiedVersion, "0.2.0");
});

test("resolveUpgradeNotice keeps a newer remote release pending when a local upgrade notice wins", async () => {
  const result = await resolveUpgradeNotice({
    pluginVersion: "0.2.0",
    runtime: {
      updateCheck: DEFAULT_UPDATE_CHECK,
    },
    stateFile: {
      schemaVersion: 1,
      lastSeenVersion: "0.1.0",
    },
    manifest: {
      latestVersion: "0.3.0",
      upgradeCommand: "codex plugin marketplace upgrade mem9-ai",
    },
    now: "2026-04-22T00:00:00.000Z",
  });

  assert.match(result.message, /mem9 upgraded to v0\.2\.0/);
  assert.equal(result.state.lastSeenVersion, "0.2.0");
  assert.equal(result.state.lastCheckedAt, "2026-04-22T00:00:00.000Z");
  assert.equal(result.state.lastNotifiedVersion, undefined);

  const followUp = await resolveUpgradeNotice({
    pluginVersion: "0.2.0",
    runtime: {
      updateCheck: DEFAULT_UPDATE_CHECK,
    },
    stateFile: result.state,
    manifest: {
      latestVersion: "0.3.0",
      upgradeCommand: "codex plugin marketplace upgrade mem9-ai",
    },
    now: "2026-04-23T01:00:00.000Z",
  });

  assert.match(followUp.message, /mem9 v0\.3\.0 is available/);
  assert.match(followUp.message, /then restart Codex/);
  assert.equal(followUp.state.lastNotifiedVersion, "0.3.0");
});
