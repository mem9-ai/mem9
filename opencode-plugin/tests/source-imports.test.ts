import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(testDir, "..");
const sourceDir = path.join(projectDir, "src");

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

test("source files use .ts local imports for raw TypeScript package publishing", () => {
  assert.equal(statSync(sourceDir).isDirectory(), true);

  const offenders = collectSourceFiles(sourceDir)
    .flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      const matches = source.matchAll(
        /(?:from\s+|export\s+\{\s*default\s*\}\s+from\s+)["'](\.[^"']+\.js)["']/g,
      );

      return Array.from(matches, (match) => ({
        filePath: path.relative(projectDir, filePath),
        specifier: match[1],
      }));
    });

  assert.deepEqual(offenders, []);
});
