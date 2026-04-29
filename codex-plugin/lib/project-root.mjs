// @ts-nocheck

import { existsSync } from "node:fs";
import path from "node:path";

export function resolveProjectRoot(input = {}) {
  const cwd =
    typeof input.cwd === "string" && input.cwd.trim()
      ? path.resolve(input.cwd.trim())
      : path.resolve(process.cwd());
  const exists = input.exists ?? existsSync;

  let current = cwd;
  while (true) {
    if (
      exists(path.join(current, ".git"))
      || exists(path.join(current, ".jj"))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
