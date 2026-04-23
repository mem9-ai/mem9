import { mkdtempSync, mkdirSync, rmSync, rmdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(TESTS_DIR, "..");
const TMP_ROOT = path.join(PACKAGE_ROOT, ".tmp");
const RUN_ROOT = path.join(TMP_ROOT, `run-${process.pid}`);

let cleanupRegistered = false;

function registerTmpCleanup() {
  if (cleanupRegistered) {
    return;
  }

  cleanupRegistered = true;
  process.once("exit", () => {
    rmSync(RUN_ROOT, { recursive: true, force: true });
    try {
      rmdirSync(TMP_ROOT);
    } catch {}
  });
}

export function createTempRoot(scope = "tests") {
  registerTmpCleanup();
  const parent = path.join(RUN_ROOT, scope);
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, "case-"));
}
