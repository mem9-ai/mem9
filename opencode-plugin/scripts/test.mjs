import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const testOutputDir = path.join(projectDir, "dist-test");
const tscEntrypoint = path.join(
  projectDir,
  "node_modules",
  "typescript",
  "lib",
  "tsc.js",
);

rmSync(testOutputDir, { recursive: true, force: true });

execFileSync(process.execPath, [tscEntrypoint, "-p", "./tsconfig.test.json"], {
  cwd: projectDir,
  stdio: "inherit",
});

execFileSync(process.execPath, ["--test", "./dist-test/*.test.js"], {
  cwd: projectDir,
  stdio: "inherit",
});
