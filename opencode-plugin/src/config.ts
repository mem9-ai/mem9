export interface Mem9ConfigFile {
  schemaVersion: number;
  profileId?: string;
  debug?: boolean;
  defaultTimeoutMs?: number;
  searchTimeoutMs?: number;
}

export function mergeConfigLayers(
  globalConfig: Mem9ConfigFile,
  projectConfig?: Mem9ConfigFile,
): Mem9ConfigFile {
  return {
    ...globalConfig,
    ...projectConfig,
  };
}
