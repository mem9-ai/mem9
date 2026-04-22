import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  assertGitPublishState,
  buildPublishArgs,
  deriveTagFromVersion,
  normalizePublishBranch,
  parseArgs,
  resolveReleasePlan,
} from "./publish.mjs";

test("parseArgs accepts current release mode", () => {
  assert.deepEqual(parseArgs(["current", "--dry-run"]), {
    help: false,
    increment: "current",
    channel: undefined,
    dryRun: true,
  });
});

test("parseArgs accepts the pnpm argument separator", () => {
  assert.deepEqual(parseArgs(["--", "current", "--dry-run"]), {
    help: false,
    increment: "current",
    channel: undefined,
    dryRun: true,
  });
});

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

test("parseArgs rejects channel overrides for current mode", () => {
  assert.throws(
    () => parseArgs(["current", "--channel", "rc"]),
    /current does not accept --channel/,
  );
});

test("deriveTagFromVersion maps versions to npm tags", () => {
  assert.equal(deriveTagFromVersion("0.1.0"), "latest");
  assert.equal(deriveTagFromVersion("0.1.1-alpha.0"), "alpha");
  assert.equal(deriveTagFromVersion("0.1.1-beta.2"), "beta");
  assert.equal(deriveTagFromVersion("0.1.1-rc.3"), "rc");
});

test("resolveReleasePlan keeps the current version when current mode is used", () => {
  assert.deepEqual(resolveReleasePlan("0.1.1-rc.2", "current"), {
    currentVersion: "0.1.1-rc.2",
    nextVersion: "0.1.1-rc.2",
    normalizedIncrement: "current",
    tag: "rc",
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

test("resolveReleasePlan promotes patch prereleases to their stable version", () => {
  assert.deepEqual(resolveReleasePlan("0.1.1-rc.2", "patch"), {
    currentVersion: "0.1.1-rc.2",
    nextVersion: "0.1.1",
    normalizedIncrement: "patch",
    tag: "latest",
  });
});

test("resolveReleasePlan promotes minor prereleases to their stable version", () => {
  assert.deepEqual(resolveReleasePlan("0.2.0-rc.2", "minor"), {
    currentVersion: "0.2.0-rc.2",
    nextVersion: "0.2.0",
    normalizedIncrement: "minor",
    tag: "latest",
  });
});

test("resolveReleasePlan promotes major prereleases to their stable version", () => {
  assert.deepEqual(resolveReleasePlan("1.0.0-rc.2", "major"), {
    currentVersion: "1.0.0-rc.2",
    nextVersion: "1.0.0",
    normalizedIncrement: "major",
    tag: "latest",
  });
});

test("normalizePublishBranch prefers origin HEAD and falls back to main", () => {
  assert.equal(normalizePublishBranch("origin/main"), "main");
  assert.equal(normalizePublishBranch("origin/release"), "release");
  assert.equal(normalizePublishBranch(""), "main");
});

test("assertGitPublishState accepts a clean synced publish branch", () => {
  assert.doesNotThrow(() =>
    assertGitPublishState({
      statusOutput: "",
      currentBranch: "main",
      publishBranch: "main",
      aheadCount: 0,
      behindCount: 0,
    }),
  );
});

test("assertGitPublishState rejects dirty worktrees", () => {
  assert.throws(
    () =>
      assertGitPublishState({
        statusOutput: " M opencode-plugin/package.json",
        currentBranch: "main",
        publishBranch: "main",
        aheadCount: 0,
        behindCount: 0,
      }),
    /working tree must be clean/,
  );
});

test("assertGitPublishState rejects the wrong branch", () => {
  assert.throws(
    () =>
      assertGitPublishState({
        statusOutput: "",
        currentBranch: "feat/opencode-plugin-research",
        publishBranch: "main",
        aheadCount: 0,
        behindCount: 0,
      }),
    /publish from main/,
  );
});

test("assertGitPublishState rejects branches that diverge from origin", () => {
  assert.throws(
    () =>
      assertGitPublishState({
        statusOutput: "",
        currentBranch: "main",
        publishBranch: "main",
        aheadCount: 1,
        behindCount: 0,
      }),
    /must match origin\/main exactly/,
  );
});

test("buildPublishArgs uses explicit git-check bypass after preflight checks", () => {
  assert.deepEqual(buildPublishArgs("latest", false), [
    "publish",
    "--access",
    "public",
    "--tag",
    "latest",
    "--no-git-checks",
  ]);
});

test("buildPublishArgs forwards dry-run without extra flags", () => {
  assert.deepEqual(buildPublishArgs("rc", true), [
    "publish",
    "--access",
    "public",
    "--tag",
    "rc",
    "--no-git-checks",
    "--dry-run",
  ]);
});

test("help output documents direct script usage", () => {
  const result = spawnSync(process.execPath, ["./scripts/publish.mjs", "--help"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /node \.\/scripts\/publish\.mjs current/);
  assert.doesNotMatch(result.stdout, /pnpm run publish:release -- current/);
});
