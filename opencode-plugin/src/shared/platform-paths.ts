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
  globalPluginConfigFile: string;
  projectPluginConfigFile: string;
  credentialsFile: string;
  logDir: string;
}

export interface OpenCodeBasePaths {
  configDir: string;
  dataDir: string;
}

function normalizeDir(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveMem9Home(
  env: Record<string, string | undefined>,
  homeDir = os.homedir(),
): string {
  const override = normalizeDir(env.MEM9_HOME);
  if (override) {
    return override;
  }

  return path.join(homeDir, ".mem9");
}

export function resolveOpenCodeBasePaths(
  env: Record<string, string | undefined>,
  homeDir = os.homedir(),
  platform = process.platform,
): OpenCodeBasePaths {
  if (platform === "win32") {
    const configRoot = normalizeDir(env.APPDATA) ?? path.join(homeDir, "AppData", "Roaming");
    const dataRoot = normalizeDir(env.LOCALAPPDATA) ?? path.join(homeDir, "AppData", "Local");
    return {
      configDir: path.join(configRoot, "opencode"),
      dataDir: path.join(dataRoot, "opencode"),
    };
  }

  const configRoot = normalizeDir(env.XDG_CONFIG_HOME) ?? path.join(homeDir, ".config");
  const dataRoot = normalizeDir(env.XDG_DATA_HOME) ?? path.join(homeDir, ".local", "share");
  return {
    configDir: path.join(configRoot, "opencode"),
    dataDir: path.join(dataRoot, "opencode"),
  };
}

export function resolveMem9Paths(input: Mem9PathInput): Mem9ResolvedPaths {
  return {
    globalConfigFile: path.join(input.configDir, "mem9.json"),
    projectConfigFile: path.join(input.projectDir, ".opencode", "mem9.json"),
    globalPluginConfigFile: path.join(input.configDir, "opencode.json"),
    projectPluginConfigFile: path.join(input.projectDir, ".opencode", "opencode.json"),
    credentialsFile: path.join(input.mem9Home, ".credentials.json"),
    logDir: path.join(input.dataDir, "plugins", "mem9", "log"),
  };
}
