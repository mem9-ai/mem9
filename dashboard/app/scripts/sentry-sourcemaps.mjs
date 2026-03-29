import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const sentryOrg = "pingcap2";
const sentryProject = "mem9-fe";
const artifactDirectory = "dist/assets";

if (!existsSync(artifactDirectory)) {
  throw new Error(
    `No Sentry sourcemap artifacts found. Missing directory: ${artifactDirectory}`,
  );
}

const sourcemapFiles = readdirSync(artifactDirectory).filter((file) =>
  file.endsWith(".map"),
);

if (sourcemapFiles.length === 0) {
  throw new Error(
    `No Sentry sourcemap artifacts found. Expected .map files in ${artifactDirectory}`,
  );
}

function runSentryCli(command, extraArgs = []) {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "sentry-cli",
      "sourcemaps",
      command,
      "--org",
      sentryOrg,
      "--project",
      sentryProject,
      ...extraArgs,
      artifactDirectory,
    ],
    {
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const sourcemapFile of sourcemapFiles) {
  if (!existsSync(join(artifactDirectory, sourcemapFile))) {
    throw new Error(`Missing sourcemap artifact: ${join(artifactDirectory, sourcemapFile)}`);
  }
}

runSentryCli("inject");
runSentryCli("upload", ["--validate"]);
