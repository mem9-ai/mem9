import { readFileSync } from "node:fs";

function readPackageVersion(): string {
  for (const relativePath of ["../../package.json", "../../../package.json"]) {
    try {
      const pkg = JSON.parse(
        readFileSync(new URL(relativePath, import.meta.url), "utf8"),
      );
      if (typeof pkg.version === "string" && pkg.version.trim()) {
        return pkg.version.trim();
      }
    } catch {
      continue;
    }
  }

  return "unknown";
}

export const MEM9_PLUGIN_USER_AGENT = `mem9-plugin/opencode/${readPackageVersion()}`;
