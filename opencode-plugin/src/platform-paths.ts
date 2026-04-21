import os from "node:os";
import path from "node:path";

export interface Mem9PathInput {
  configDir: string;
  dataDir: string;
  projectDir: string;
  mem9Home: string;
}

export interface Mem9ResolvedPaths {
  globalConfigFile: string;
  projectConfigFile: string;
  credentialsFile: string;
  logDir: string;
}

export function resolveMem9Home(
  env: Record<string, string | undefined>,
  homeDir = os.homedir(),
): string {
  const override = env.MEM9_HOME?.trim();
  if (override) {
    return override;
  }

  return path.join(homeDir, ".mem9");
}

export function resolveMem9Paths(input: Mem9PathInput): Mem9ResolvedPaths {
  return {
    globalConfigFile: path.join(input.configDir, "mem9.json"),
    projectConfigFile: path.join(input.projectDir, ".opencode", "mem9.json"),
    credentialsFile: path.join(input.mem9Home, ".credentials.json"),
    logDir: path.join(input.dataDir, "plugins", "mem9", "log"),
  };
}
