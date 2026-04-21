// @ts-check

import path from "node:path";

/**
 * @param {string | undefined} inputPath
 * @returns {string}
 */
function normalizePath(inputPath) {
  if (typeof inputPath === "string" && inputPath.trim()) {
    return path.resolve(inputPath.trim());
  }

  return path.resolve(process.cwd());
}

/**
 * @param {{
 *   cwd?: string,
 *   exists?: (filePath: string) => boolean,
 * }} [input]
 * @returns {string | null}
 */
export function resolveProjectRoot(input = {}) {
  const exists = input.exists ?? (() => false);
  let current = normalizePath(input.cwd);

  for (;;) {
    if (exists(path.join(current, ".git"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}
