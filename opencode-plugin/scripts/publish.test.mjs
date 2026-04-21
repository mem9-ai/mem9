import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, resolveReleasePlan } from "./publish.mjs";

test("parseArgs accepts stable releases", () => {
  assert.deepEqual(parseArgs(["patch"]), {
    help: false,
    increment: "patch",
    channel: undefined,
    dryRun: false,
  });
});

test("parseArgs accepts prerelease options", () => {
  assert.deepEqual(parseArgs(["prepatch", "--channel", "rc", "--dry-run"]), {
    help: false,
    increment: "prepatch",
    channel: "rc",
    dryRun: true,
  });
});

test("resolveReleasePlan keeps stable releases on latest", () => {
  assert.deepEqual(resolveReleasePlan("0.1.0", "patch"), {
    currentVersion: "0.1.0",
    nextVersion: "0.1.1",
    normalizedIncrement: "patch",
    tag: "latest",
  });
});

test("resolveReleasePlan upgrades stable increments into prereleases when channel is set", () => {
  assert.deepEqual(resolveReleasePlan("0.1.0", "patch", "rc"), {
    currentVersion: "0.1.0",
    nextVersion: "0.1.1-rc.0",
    normalizedIncrement: "prepatch",
    tag: "rc",
  });
});

test("resolveReleasePlan advances the same prerelease channel", () => {
  assert.deepEqual(resolveReleasePlan("0.1.1-rc.2", "prerelease", "rc"), {
    currentVersion: "0.1.1-rc.2",
    nextVersion: "0.1.1-rc.3",
    normalizedIncrement: "prerelease",
    tag: "rc",
  });
});

test("resolveReleasePlan switches prerelease channels on the same base version", () => {
  assert.deepEqual(resolveReleasePlan("0.1.1-alpha.4", "prerelease", "beta"), {
    currentVersion: "0.1.1-alpha.4",
    nextVersion: "0.1.1-beta.0",
    normalizedIncrement: "prerelease",
    tag: "beta",
  });
});

test("resolveReleasePlan requires a prerelease base for prerelease increments", () => {
  assert.throws(
    () => resolveReleasePlan("0.1.0", "prerelease", "rc"),
    /already be a prerelease/,
  );
});
