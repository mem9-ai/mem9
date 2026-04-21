#!/usr/bin/env node
// @ts-nocheck

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  resolveCodexHome,
  resolveMem9Home,
} from "../../../hooks/shared/config.mjs";
import { resolveProjectRoot } from "../../../hooks/shared/project-root.mjs";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseIntegerArg(flag, value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }

  return parsed;
}

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readJsonFileOrDefault(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return fallback;
  }

  return JSON.parse(raw);
}

function writeJsonFile(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createInteractivePrompter({
  input = process.stdin,
  output = process.stderr,
} = {}) {
  if (!input?.isTTY) {
    return null;
  }

  return {
    async text(label, defaultValue = "") {
      const rl = readline.createInterface({ input, output });

      try {
        const suffix = defaultValue ? ` [${defaultValue}]` : "";
        const answer = await rl.question(`${label}${suffix}: `);
        const normalized = normalizeString(answer);
        return normalized || defaultValue;
      } finally {
        rl.close();
      }
    },
    close() {},
  };
}

function printStatus(output, state) {
  output.write([
    `Project root: ${state.projectRoot}`,
    `Config source: ${state.configSource}`,
    `Enabled: ${state.enabled ? "true" : "false"}`,
    `Profile ID: ${state.profileId || "(unset)"}`,
    `Default timeout: ${state.defaultTimeoutMs}`,
    `Search timeout: ${state.searchTimeoutMs}`,
  ].join("\n") + "\n");
}

function buildOutputSummary(result) {
  return {
    status: "ok",
    action: result.action,
    profileId: result.profileId ?? "",
    configPath: ".codex/mem9/config.json",
  };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    cwd: "",
    profileId: "",
    disable: false,
    reset: false,
    defaultTimeoutMs: undefined,
    searchTimeoutMs: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const nextValue = argv[index + 1];

    switch (token) {
      case "--cwd":
        args.cwd = normalizeString(nextValue);
        index += 1;
        break;
      case "--profile":
        args.profileId = normalizeString(nextValue);
        index += 1;
        break;
      case "--disable":
        args.disable = true;
        break;
      case "--reset":
        args.reset = true;
        break;
      case "--default-timeout-ms":
        args.defaultTimeoutMs = parseIntegerArg(token, nextValue);
        index += 1;
        break;
      case "--search-timeout-ms":
        args.searchTimeoutMs = parseIntegerArg(token, nextValue);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (args.disable && args.reset) {
    throw new Error("--disable and --reset cannot be used together.");
  }

  if ((args.disable || args.reset) && (
    args.profileId
    || args.defaultTimeoutMs !== undefined
    || args.searchTimeoutMs !== undefined
  )) {
    throw new Error("--disable and --reset cannot be combined with profile or timeout flags.");
  }

  return args;
}

export async function runProjectConfig(argv = process.argv.slice(2), options = {}) {
  const args = Array.isArray(argv) ? parseArgs(argv) : argv;
  const env = options.env ?? process.env;
  const cwd = path.resolve(
    normalizeString(options.cwd)
      || normalizeString(args.cwd)
      || process.cwd(),
  );
  const projectRoot = resolveProjectRoot({
    cwd,
    exists: options.existsSync ?? existsSync,
  });

  if (!projectRoot) {
    throw new Error("Current directory is not inside a Git repository. Run `$mem9:project-config` from a project or pass --cwd.");
  }

  const codexHome = resolveCodexHome(options.codexHome, env, options.homeDir);
  const mem9Home = resolveMem9Home(options.mem9Home, env, options.homeDir);
  const stderr = options.stderr ?? process.stderr;
  const projectConfigPath = path.join(projectRoot, ".codex", "mem9", "config.json");
  const globalConfigPath = path.join(codexHome, "mem9", "config.json");
  const credentialsPath = path.join(mem9Home, ".credentials.json");
  const globalConfig = readJsonFileOrDefault(globalConfigPath, {});
  let projectConfig = {};
  let projectConfigInvalid = false;

  try {
    projectConfig = readJsonFileOrDefault(projectConfigPath, {});
  } catch {
    projectConfigInvalid = true;
  }

  const currentState = {
    projectRoot: ".",
    configSource: existsSync(projectConfigPath) ? "local override" : "global default",
    enabled: (projectConfigInvalid ? globalConfig.enabled : projectConfig.enabled) ?? globalConfig.enabled ?? true,
    profileId: (projectConfigInvalid ? globalConfig.profileId : projectConfig.profileId) ?? globalConfig.profileId ?? "",
    defaultTimeoutMs: (projectConfigInvalid ? globalConfig.defaultTimeoutMs : projectConfig.defaultTimeoutMs)
      ?? globalConfig.defaultTimeoutMs
      ?? DEFAULT_REQUEST_TIMEOUT_MS,
    searchTimeoutMs: (projectConfigInvalid ? globalConfig.searchTimeoutMs : projectConfig.searchTimeoutMs)
      ?? globalConfig.searchTimeoutMs
      ?? DEFAULT_SEARCH_TIMEOUT_MS,
  };

  printStatus(stderr, currentState);

  let prompter = options.prompter;
  let needsClose = false;
  if (!prompter && options.interactive !== false) {
    prompter = createInteractivePrompter({
      input: options.stdin,
      output: stderr,
    });
    needsClose = Boolean(prompter);
  }

  try {
    if (!args.profileId && !args.disable && !args.reset) {
      if (!prompter) {
        throw new Error("No action selected. Pass --profile, --disable, or --reset, or run `$mem9:project-config` in a TTY.");
      }

      const action = await prompter.text("Action [profile|disable|reset|keep]", "keep");
      if (action === "disable") {
        args.disable = true;
      } else if (action === "reset") {
        args.reset = true;
      } else if (action === "profile") {
        const credentials = readJsonFileOrDefault(credentialsPath, {
          schemaVersion: 1,
          profiles: {},
        });
        const profiles = isRecord(credentials.profiles) ? credentials.profiles : {};
        stderr.write(`Available profiles: ${Object.keys(profiles).sort().join(", ")}\n`);
        args.profileId = await prompter.text("Profile ID", currentState.profileId);
      } else {
        return {
          action: "keep",
          projectRoot,
          projectConfigPath,
          profileId: currentState.profileId,
        };
      }
    }

    if (args.reset) {
      rmSync(projectConfigPath, { force: true });
      const result = {
        action: "reset",
        projectRoot,
        projectConfigPath,
      };
      options.stdout?.write?.(`${JSON.stringify(buildOutputSummary(result))}\n`);
      return result;
    }

    if (args.disable) {
      writeJsonFile(projectConfigPath, {
        schemaVersion: 1,
        enabled: false,
      });
      const result = {
        action: "disable",
        projectRoot,
        projectConfigPath,
      };
      options.stdout?.write?.(`${JSON.stringify(buildOutputSummary(result))}\n`);
      return result;
    }

    const credentials = readJsonFileOrDefault(credentialsPath, {
      schemaVersion: 1,
      profiles: {},
    });
    const profiles = isRecord(credentials.profiles) ? credentials.profiles : {};
    const profile = isRecord(profiles[args.profileId]) ? profiles[args.profileId] : null;

    if (!profile) {
      throw new Error(`Profile "${args.profileId}" was not found. Run \`$mem9:setup\` to create or repair global profiles.`);
    }

    if (!normalizeString(profile.apiKey)) {
      throw new Error(`Profile "${args.profileId}" is missing an API key. Run \`$mem9:setup\` to repair it.`);
    }

    /** @type {Record<string, unknown>} */
    const nextConfig = {
      schemaVersion: 1,
      profileId: args.profileId,
    };

    if (projectConfig.defaultTimeoutMs !== undefined) {
      nextConfig.defaultTimeoutMs = projectConfig.defaultTimeoutMs;
    }
    if (projectConfig.searchTimeoutMs !== undefined) {
      nextConfig.searchTimeoutMs = projectConfig.searchTimeoutMs;
    }
    if (args.defaultTimeoutMs !== undefined) {
      nextConfig.defaultTimeoutMs = args.defaultTimeoutMs;
    }
    if (args.searchTimeoutMs !== undefined) {
      nextConfig.searchTimeoutMs = args.searchTimeoutMs;
    }
    if (currentState.enabled === false) {
      nextConfig.enabled = true;
    }

    writeJsonFile(projectConfigPath, nextConfig);

    const result = {
      action: "write",
      projectRoot,
      projectConfigPath,
      profileId: args.profileId,
    };
    options.stdout?.write?.(`${JSON.stringify(buildOutputSummary(result))}\n`);
    return result;
  } finally {
    if (needsClose) {
      prompter?.close?.();
    }
  }
}

export async function main(argv = process.argv.slice(2), options = {}) {
  return runProjectConfig(argv, {
    ...options,
    stdout: options.stdout ?? process.stdout,
    stdin: options.stdin ?? process.stdin,
    stderr: options.stderr ?? process.stderr,
  });
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
