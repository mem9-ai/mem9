import path from "node:path";

export interface Mem9PathInput {
  configDir: string;
  dataDir: string;
  projectDir: string;
}

export interface Mem9ResolvedPaths {
  globalConfigFile: string;
  projectConfigFile: string;
  credentialsFile: string;
}

export function resolveMem9Paths(input: Mem9PathInput): Mem9ResolvedPaths {
  return {
    globalConfigFile: path.join(input.configDir, "mem9.json"),
    projectConfigFile: path.join(input.projectDir, ".opencode", "mem9.json"),
    credentialsFile: path.join(
      input.dataDir,
      "plugins",
      "mem9",
      ".credentials.json",
    ),
  };
}
