import type { Mem9ConfigFile } from "./types.js";

const DEFAULT_CONFIG: Required<
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

export function mergeConfigLayers(
  globalConfig?: Mem9ConfigFile,
  projectConfig?: Mem9ConfigFile,
): Mem9ConfigFile {
  return {
    ...DEFAULT_CONFIG,
    ...globalConfig,
    ...projectConfig,
  };
}
