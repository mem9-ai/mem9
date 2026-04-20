import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { mergeConfigLayers } from "./config.js";
import { resolveMem9Paths } from "./platform-paths.js";

test("resolveMem9Paths uses config and data directories separately", () => {
  const configDir = path.join(path.sep, "home", "demo", ".config", "opencode");
  const dataDir = path.join(path.sep, "home", "demo", ".local", "share", "opencode");
  const projectDir = path.join(path.sep, "work", "repo");
  const paths = resolveMem9Paths({
    configDir,
    dataDir,
    projectDir,
  });

  assert.equal(paths.globalConfigFile, path.join(configDir, "mem9.json"));
  assert.equal(paths.projectConfigFile, path.join(projectDir, ".opencode", "mem9.json"));
  assert.equal(
    paths.credentialsFile,
    path.join(dataDir, "plugins", "mem9", ".credentials.json"),
  );
});

test("mergeConfigLayers applies defaults and project overrides", () => {
  const result = mergeConfigLayers(
    {
      schemaVersion: 1,
      profileId: "default",
      debug: true,
      searchTimeoutMs: 12000,
    },
    {
      schemaVersion: 1,
      profileId: "projectA",
      defaultTimeoutMs: 9000,
    },
  );

  assert.deepEqual(result, {
    schemaVersion: 1,
    profileId: "projectA",
    debug: true,
    defaultTimeoutMs: 9000,
    searchTimeoutMs: 12000,
  });
});

test("mergeConfigLayers uses built-in defaults when config layers are missing", () => {
  const result = mergeConfigLayers();

  assert.deepEqual(result, {
    schemaVersion: 1,
    debug: false,
    defaultTimeoutMs: 8000,
    searchTimeoutMs: 15000,
  });
});
