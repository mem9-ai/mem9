import type { Mem9ConfigFile } from "./types.ts";

export const DEFAULT_SCOPE_CONFIG: Required<
  Pick<
    Mem9ConfigFile,
    "schemaVersion" | "debug" | "defaultTimeoutMs" | "searchTimeoutMs"
  >
> = {
  schemaVersion: 1,
  debug: false,
  defaultTimeoutMs: 8000,
  searchTimeoutMs: 15000,
};
