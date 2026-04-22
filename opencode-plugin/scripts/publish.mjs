// Publish helper for @mem9/opencode.
//
// Run from the package directory:
//   cd opencode-plugin
//
// Normal package-level entrypoint:
//   pnpm run publish:release current
//   pnpm run publish:release current --dry-run
//   pnpm run publish:release patch
//
// Direct script entrypoint:
//   node ./scripts/publish.mjs current
//   node ./scripts/publish.mjs current --dry-run
//
// Argument notes:
//   - `pnpm run publish:release ...` is the normal workflow.
//   - `node ./scripts/publish.mjs ...` matches the `--help` output.
//   - Both `pnpm run publish:release current` and
//     `pnpm run publish:release -- current` are accepted.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(packageDir, "package.json");
const publishEnvPath = path.join(packageDir, ".publish.env");
const publishNpmrcPath = path.join(packageDir, ".npmrc.publish.tmp");
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const gitBin = process.platform === "win32" ? "git.exe" : "git";

const STABLE_INCREMENTS = new Set(["major", "minor", "patch"]);
const PRERELEASE_INCREMENTS = new Set([
  "premajor",
  "preminor",
  "prepatch",
  "prerelease",
]);
const CHANNELS = new Set(["alpha", "beta", "rc"]);

function fail(message) {
  throw new Error(message);
}

function printHelp() {
  console.log(`Usage:
  node ./scripts/publish.mjs <current|major|minor|patch|premajor|preminor|prepatch|prerelease> [--channel <alpha|beta|rc>] [--dry-run]

Examples:
  node ./scripts/publish.mjs current
  node ./scripts/publish.mjs patch
  node ./scripts/publish.mjs patch --channel rc
  node ./scripts/publish.mjs prepatch --channel beta
  node ./scripts/publish.mjs prerelease --channel rc
  node ./scripts/publish.mjs prepatch --channel rc --dry-run

Behavior:
  - \`current\` publishes the exact version already in package.json and derives the npm tag from that version.
  - Stable releases publish to the npm \`latest\` tag.
  - Stable increments with \`--channel\` become prereleases for that channel.
  - \`prerelease\` continues the current prerelease stream for the selected channel.
  - The script reads NPM_ACCESSTOKEN from opencode-plugin/.publish.env only.
`);
}

function parseArgs(argv) {
  let increment = "";
  let channel;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--channel" || arg === "-c") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        fail("--channel requires a value");
      }
      channel = nextValue;
      index += 1;
      continue;
    }

    if (!increment) {
      increment = arg;
      continue;
    }

    fail(`unknown argument "${arg}"`);
  }

  if (!increment) {
    fail("release increment is required");
  }

  if (
    increment !== "current"
    && !STABLE_INCREMENTS.has(increment)
    && !PRERELEASE_INCREMENTS.has(increment)
  ) {
    fail(`unsupported increment "${increment}"`);
  }

  if (channel && !CHANNELS.has(channel)) {
    fail(`unsupported channel "${channel}"`);
  }

  if (increment === "current" && channel) {
    fail("current does not accept --channel; the npm tag comes from the current package version");
  }

  return {
    help: false,
    increment,
    channel,
    dryRun,
  };
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(version);
  if (!match) {
    fail(`unsupported version format "${version}"`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    channel: match[4] ?? null,
    prereleaseNumber: match[5] == null ? null : Number(match[5]),
  };
}

function formatVersion(version) {
  const stable = `${version.major}.${version.minor}.${version.patch}`;
  if (!version.channel) {
    return stable;
  }

  return `${stable}-${version.channel}.${version.prereleaseNumber ?? 0}`;
}

function toPreIncrement(increment) {
  switch (increment) {
    case "major":
      return "premajor";
    case "minor":
      return "preminor";
    case "patch":
      return "prepatch";
    default:
      return increment;
  }
}

function deriveTagFromVersion(version) {
  const parsed = parseVersion(version);
  return parsed.channel ?? "latest";
}

function normalizePublishBranch(remoteHeadRef) {
  const prefix = "origin/";
  if (!remoteHeadRef.startsWith(prefix)) {
    return "main";
  }

  const branch = remoteHeadRef.slice(prefix.length).trim();
  return branch || "main";
}

function assertGitPublishState({
  statusOutput,
  currentBranch,
  publishBranch,
  aheadCount,
  behindCount,
}) {
  if (statusOutput.trim()) {
    fail("git working tree must be clean before publishing");
  }

  if (currentBranch !== publishBranch) {
    fail(`publish from ${publishBranch}; current branch is ${currentBranch || "(detached)"}`);
  }

  if (aheadCount !== 0 || behindCount !== 0) {
    fail(`publish branch must match origin/${publishBranch} exactly before publishing`);
  }
}

function applyStableIncrement(current, increment) {
  const next = { ...current, channel: null, prereleaseNumber: null };

  if (increment === "major") {
    if (current.channel && current.minor === 0 && current.patch === 0) {
      return next;
    }

    next.major += 1;
    next.minor = 0;
    next.patch = 0;
    return next;
  }

  if (increment === "minor") {
    if (current.channel && current.patch === 0) {
      return next;
    }

    next.minor += 1;
    next.patch = 0;
    return next;
  }

  if (!current.channel) {
    next.patch += 1;
  }

  return next;
}

function resolveReleasePlan(currentVersion, increment, channel) {
  if (increment === "current") {
    return {
      currentVersion,
      nextVersion: currentVersion,
      normalizedIncrement: "current",
      tag: deriveTagFromVersion(currentVersion),
    };
  }

  const current = parseVersion(currentVersion);

  if (STABLE_INCREMENTS.has(increment) && !channel) {
    const next = applyStableIncrement(current, increment);

    return {
      currentVersion,
      nextVersion: formatVersion(next),
      normalizedIncrement: increment,
      tag: "latest",
    };
  }

  const prereleaseIncrement = toPreIncrement(increment);
  const prereleaseChannel = channel;

  if (!prereleaseChannel) {
    fail("prerelease releases require --channel <alpha|beta|rc>");
  }

  let next;
  if (prereleaseIncrement === "premajor") {
    next = {
      major: current.major + 1,
      minor: 0,
      patch: 0,
      channel: prereleaseChannel,
      prereleaseNumber: 0,
    };
  } else if (prereleaseIncrement === "preminor") {
    next = {
      major: current.major,
      minor: current.minor + 1,
      patch: 0,
      channel: prereleaseChannel,
      prereleaseNumber: 0,
    };
  } else if (prereleaseIncrement === "prepatch") {
    next = {
      major: current.major,
      minor: current.minor,
      patch: current.patch + 1,
      channel: prereleaseChannel,
      prereleaseNumber: 0,
    };
  } else {
    if (!current.channel || current.prereleaseNumber == null) {
      fail(
        "prerelease requires the current package version to already be a prerelease; use prepatch, preminor, or premajor first",
      );
    }

    next = {
      major: current.major,
      minor: current.minor,
      patch: current.patch,
      channel: prereleaseChannel,
      prereleaseNumber:
        current.channel === prereleaseChannel ? current.prereleaseNumber + 1 : 0,
    };
  }

  return {
    currentVersion,
    nextVersion: formatVersion(next),
    normalizedIncrement: prereleaseIncrement,
    tag: prereleaseChannel,
  };
}

function readPublishToken() {
  if (!existsSync(publishEnvPath)) {
    fail(`missing ${path.basename(publishEnvPath)}; add NPM_ACCESSTOKEN there before publishing`);
  }

  const raw = readFileSync(publishEnvPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?NPM_ACCESSTOKEN\s*=\s*(.+?)\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const token = match[1].replace(/^['"]|['"]$/g, "");
    if (token) {
      return token;
    }
  }

  fail(`NPM_ACCESSTOKEN is missing in ${path.basename(publishEnvPath)}`);
}

function writePublishNpmrc(token) {
  writeFileSync(
    publishNpmrcPath,
    `//registry.npmjs.org/:_authToken=${token}\n`,
    "utf8",
  );
}

function runPnpm(args) {
  const env = {
    ...process.env,
    npm_config_userconfig: publishNpmrcPath,
  };
  const result = spawnSync(pnpmBin, args, {
    cwd: packageDir,
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    fail(`command failed: pnpm ${args.join(" ")}`);
  }
}

function readCommandOutput(bin, args, cwd) {
  const result = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    fail(
      stderr
        ? `command failed: ${bin} ${args.join(" ")}: ${stderr}`
        : `command failed: ${bin} ${args.join(" ")}`,
    );
  }

  return result.stdout.trim();
}

function resolveRepoRoot() {
  return readCommandOutput(gitBin, ["rev-parse", "--show-toplevel"], packageDir);
}

function resolvePublishBranch(repoRoot) {
  try {
    const remoteHeadRef = readCommandOutput(
      gitBin,
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      repoRoot,
    );
    return normalizePublishBranch(remoteHeadRef);
  } catch {
    return "main";
  }
}

function ensureGitPublishReady(repoRoot) {
  const statusOutput = readCommandOutput(
    gitBin,
    ["status", "--porcelain", "--untracked-files=all"],
    repoRoot,
  );
  const currentBranch = readCommandOutput(gitBin, ["branch", "--show-current"], repoRoot);
  const publishBranch = resolvePublishBranch(repoRoot);
  const upstreamRef = `origin/${publishBranch}`;
  const countsOutput = readCommandOutput(
    gitBin,
    ["rev-list", "--left-right", "--count", `HEAD...${upstreamRef}`],
    repoRoot,
  );
  const [aheadRaw = "0", behindRaw = "0"] = countsOutput.split(/\s+/);
  assertGitPublishState({
    statusOutput,
    currentBranch,
    publishBranch,
    aheadCount: Number(aheadRaw),
    behindCount: Number(behindRaw),
  });
}

function buildPublishArgs(tag, dryRun) {
  const publishArgs = [
    "publish",
    "--access",
    "public",
    "--tag",
    tag,
    "--no-git-checks",
  ];
  if (dryRun) {
    publishArgs.push("--dry-run");
  }

  return publishArgs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const currentVersion = String(pkg.version ?? "");
  const plan = resolveReleasePlan(currentVersion, args.increment, args.channel);
  const repoRoot = resolveRepoRoot();
  ensureGitPublishReady(repoRoot);
  const token = readPublishToken();
  const originalPackageJson = readFileSync(packageJsonPath, "utf8");

  try {
    if (plan.nextVersion !== currentVersion) {
      writeFileSync(
        packageJsonPath,
        JSON.stringify({ ...pkg, version: plan.nextVersion }, null, 2) + "\n",
        "utf8",
      );
    }
    writePublishNpmrc(token);
    console.log(
      `[mem9] Releasing @mem9/opencode ${plan.currentVersion} -> ${plan.nextVersion} (${plan.tag})${args.dryRun ? " [dry-run]" : ""}`,
    );
    runPnpm(["test"]);
    runPnpm(["run", "typecheck"]);
    runPnpm(["run", "pack:check"]);
    runPnpm(buildPublishArgs(plan.tag, args.dryRun));
  } catch (error) {
    writeFileSync(packageJsonPath, originalPackageJson, "utf8");
    throw error;
  } finally {
    rmSync(publishNpmrcPath, { force: true });
  }

  if (args.dryRun) {
    writeFileSync(packageJsonPath, originalPackageJson, "utf8");
  }
}

const isMain =
  process.argv[1] != null
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error) => {
    console.error(
      `[mem9] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}

export {
  parseArgs,
  parseVersion,
  formatVersion,
  deriveTagFromVersion,
  normalizePublishBranch,
  assertGitPublishState,
  buildPublishArgs,
  resolveReleasePlan,
  readPublishToken,
};
