#!/usr/bin/env node
// @ts-check

import {
  copyFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_API_URL,
  DEFAULT_RECALL_MIN_PROMPT_LENGTH,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  MAX_AGENT_ID_LENGTH,
  loadRuntimeState,
  normalizeAgentId,
  redactApiKeyPreview,
  resolveMem9Home,
  resolveRuntimePaths,
  writeJsonAtomic,
} from "../../../scripts/lib/config.mjs";
import { provisionMem9Space } from "../../../scripts/lib/http.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(SCRIPT_DIR, "setup.mjs");

/**
 * @typedef {Record<string, string | undefined>} EnvMap
 */

/**
 * @typedef {{
 *   write: (chunk: string) => unknown,
 * }} WritableLike
 */

/**
 * @typedef {{
 *   label?: string,
 *   baseUrl?: string,
 *   apiKey?: string,
 * }} RawProfileRecord
 */

/**
 * @typedef {{
 *   schemaVersion?: number,
 *   profiles?: Record<string, RawProfileRecord>,
 * }} RawCredentialsFile
 */

/**
 * @typedef {{
 *   schemaVersion?: number,
 *   enabled?: boolean,
 *   profileId?: string,
 *   agentId?: string,
 *   defaultTimeoutMs?: number,
 *   searchTimeoutMs?: number,
 *   recallMinPromptLength?: number,
 * }} RawScopeConfig
 */

/**
 * @typedef {{
 *   command: string,
 *   subcommand: string,
 *   cwd: string,
 *   profileId: string,
 *   profileIdExplicit: boolean,
 *   label: string,
 *   baseUrl: string,
 *   apiKeyEnv: string,
 *   apiKeyEnvExplicit: boolean,
 *   provisionApiKey: boolean,
 *   scope: string,
 *   agentId: string,
 *   defaultTimeoutMs: number | undefined,
 *   searchTimeoutMs: number | undefined,
 *   recallMinPromptLength: number | undefined,
 * }} ParsedSetupArgs
 */

/**
 * @typedef {{
 *   cwd?: string,
 *   mem9Home?: string,
 *   pluginDataDir?: string,
 *   env?: EnvMap,
 *   homeDir?: string,
 *   fetch?: typeof fetch,
 *   provisionFn?: (baseUrl: string) => Promise<string | { apiKey?: string }>,
 *   provisionTimeoutMs?: number,
 *   stdout?: WritableLike,
 *   stderr?: WritableLike,
 * }} SetupOptions
 */

/**
 * @typedef {{
 *   sourcePath: string,
 *   backupPath: string,
 * }} BackupEntry
 */

/**
 * Check whether a value is a non-null plain object record.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Trim a string value safely, returning empty string for non-strings.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Normalize an HTTP(S) base URL without trailing slashes.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeBaseUrl(value) {
  const raw = normalizeString(value);
  if (!raw) {
    return "";
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid URL for --base-url: "${raw}".`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`--base-url must use http:// or https:// (got "${raw}").`);
  }

  return raw.replace(/\/+$/, "");
}

/**
 * Coerce a stored base URL safely without throwing on corrupted data.
 * @param {unknown} value
 * @returns {string}
 */
function safeBaseUrl(value) {
  const raw = normalizeString(value);
  return raw ? raw.replace(/\/+$/, "") : "";
}

/**
 * Normalize a positive integer with fallback.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizePositiveInt(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

/**
 * Normalize a non-negative integer with fallback.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeNonNegativeInt(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

/**
 * Read a positive integer if valid, else undefined.
 * @param {unknown} value
 * @returns {number | undefined}
 */
function pickPositiveInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.floor(value);
}

/**
 * Read a non-negative integer if valid, else undefined.
 * @param {unknown} value
 * @returns {number | undefined}
 */
function pickNonNegativeInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.floor(value);
}

/**
 * Parse a strictly positive integer CLI argument.
 * @param {string} flag
 * @param {string | undefined} value
 * @returns {number}
 */
function parsePositiveIntArg(flag, value) {
  const text = normalizeString(value);
  if (!/^\d+$/.test(text)) {
    throw new Error(`${flag} must be a positive integer.`);
  }

  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }

  return parsed;
}

/**
 * Parse a non-negative integer CLI argument.
 * @param {string} flag
 * @param {string | undefined} value
 * @returns {number}
 */
function parseNonNegativeIntArg(flag, value) {
  const text = normalizeString(value);
  if (!/^\d+$/.test(text)) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }

  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }

  return parsed;
}

/**
 * Parse and validate an agent ID CLI argument.
 * @param {string} flag
 * @param {string | undefined} value
 * @returns {string}
 */
function parseAgentIdArg(flag, value) {
  const agentId = normalizeAgentId(value);
  if (!agentId) {
    throw new Error(
      `${flag} must be 1-${MAX_AGENT_ID_LENGTH} characters with no control characters.`,
    );
  }

  return agentId;
}

/**
 * Parse and validate a profile ID CLI argument.
 * @param {string} flag
 * @param {string | undefined} value
 * @returns {string}
 */
function parseProfileIdArg(flag, value) {
  const trimmed = normalizeString(value);
  if (!trimmed || /\p{Cc}/u.test(trimmed)) {
    throw new Error(`${flag} must be a non-empty string with no control characters.`);
  }

  return trimmed;
}

/**
 * Parse and validate an environment variable name argument.
 * @param {string} flag
 * @param {string | undefined} value
 * @returns {string}
 */
function parseEnvVarNameArg(flag, value) {
  const trimmed = normalizeString(value);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(`${flag} must be a valid environment variable name.`);
  }

  return trimmed;
}

/**
 * Check whether a CLI token requests help.
 * @param {unknown} token
 * @returns {boolean}
 */
function isHelpToken(token) {
  const normalized = normalizeString(token);
  return normalized === "--help" || normalized === "-h";
}

/**
 * Detect whether argv asks for help output and which topic applies.
 * @param {string[]} [argv]
 * @returns {{ command: string, subcommand: string } | null}
 */
function detectHelpRequest(argv = process.argv.slice(2)) {
  const tokens = Array.isArray(argv)
    ? argv.map((token) => normalizeString(token)).filter(Boolean)
    : [];
  const helpIndex = tokens.findIndex(isHelpToken);

  if (tokens.length === 0 || helpIndex === 0) {
    return { command: "", subcommand: "" };
  }

  if (helpIndex === -1) {
    return null;
  }

  const [command = "", subcommand = ""] = tokens;
  if (command === "inspect") {
    return { command, subcommand: "" };
  }

  if (command === "profile" || command === "scope") {
    return {
      command,
      subcommand: subcommand.startsWith("-") ? "" : subcommand,
    };
  }

  return { command: "", subcommand: "" };
}

/**
 * Build help text for the setup CLI or a specific subcommand.
 * @param {string} [command]
 * @param {string} [subcommand]
 * @returns {string}
 */
export function buildSetupHelpText(command = "", subcommand = "") {
  const topic = `${normalizeString(command)}:${normalizeString(subcommand)}`.replace(/:$/, "");

  switch (topic) {
    case "inspect":
      return [
        "mem9 setup inspect",
        "",
        "Usage:",
        "  node scripts/setup.mjs inspect [--cwd <path>]",
        "",
        "Print the current mem9 setup state, profiles, and redacted runtime summary as JSON.",
        "",
        "Flags:",
        "  --cwd <path>    Resolve project scope paths from this directory.",
        "",
        "Example:",
        "  node scripts/setup.mjs inspect --cwd .",
        "",
      ].join("\n");
    case "profile":
      return [
        "mem9 setup profile",
        "",
        "Usage:",
        "  node scripts/setup.mjs profile create ...",
        "  node scripts/setup.mjs profile save-key ...",
        "",
        "Subcommands:",
        "  create      Create or update a profile (pass --provision-api-key to provision a new key).",
        "  save-key    Create or update a profile from an API key environment variable.",
        "",
        "Run a subcommand with --help for full flag details.",
        "",
      ].join("\n");
    case "profile:create":
      return [
        "mem9 setup profile create",
        "",
        "Usage:",
        "  node scripts/setup.mjs profile create \\",
        "    [--profile <profile-id>] \\",
        "    [--label <profile-label>] \\",
        "    [--base-url <mem9-api-base-url>] \\",
        "    [--provision-api-key] \\",
        "    [--cwd <path>]",
        "",
        "Flags:",
        "  --profile <profile-id>            Profile id (defaults to \"default\").",
        "  --label <profile-label>           Display label (defaults to \"Default\" or profile id).",
        "  --base-url <mem9-api-base-url>    API base URL (defaults to https://api.mem9.ai).",
        "  --provision-api-key               Provision a new mem9 space and API key.",
        "  --cwd <path>                      Resolve project scope paths from this directory.",
        "",
        "Example:",
        "  node scripts/setup.mjs profile create --profile default --label Default --provision-api-key",
        "",
      ].join("\n");
    case "profile:save-key":
      return [
        "mem9 setup profile save-key",
        "",
        "Usage:",
        "  node scripts/setup.mjs profile save-key \\",
        "    [--profile <profile-id>] \\",
        "    [--label <profile-label>] \\",
        "    [--base-url <mem9-api-base-url>] \\",
        "    [--api-key-env <env-var>] \\",
        "    [--cwd <path>]",
        "",
        "Flags:",
        "  --profile <profile-id>            Profile id (defaults to \"default\").",
        "  --label <profile-label>           Display label (defaults to \"Default\" or profile id).",
        "  --base-url <mem9-api-base-url>    API base URL (defaults to https://api.mem9.ai).",
        "  --api-key-env <env-var>           Env var holding the API key (defaults to MEM9_API_KEY).",
        "  --cwd <path>                      Resolve project scope paths from this directory.",
        "",
        "Example:",
        "  MEM9_API_KEY='<your-mem9-api-key>' node scripts/setup.mjs profile save-key --profile default --label Default --base-url https://api.mem9.ai --api-key-env MEM9_API_KEY",
        "",
      ].join("\n");
    case "scope":
      return [
        "mem9 setup scope",
        "",
        "Usage:",
        "  node scripts/setup.mjs scope apply ...",
        "  node scripts/setup.mjs scope clear ...",
        "",
        "Subcommands:",
        "  apply      Write user or project mem9 scope configuration.",
        "  clear      Remove the current project's mem9 override.",
        "",
        "Run a subcommand with --help for full flag details.",
        "",
      ].join("\n");
    case "scope:apply":
      return [
        "mem9 setup scope apply",
        "",
        "Usage:",
        "  node scripts/setup.mjs scope apply \\",
        "    --scope <user|project> \\",
        "    [--profile <profile-id>] \\",
        "    [--agent-id <id>] \\",
        "    [--default-timeout-ms <ms>] \\",
        "    [--search-timeout-ms <ms>] \\",
        "    [--recall-min-prompt-length <chars>] \\",
        "    [--cwd <path>]",
        "",
        "Required flags:",
        "  --scope <user|project>",
        "",
        "Optional flags:",
        `  --profile <profile-id>                Profile id (defaults to target scope, user scope, or "default").`,
        `  --agent-id <id>                       Memory bucket id (1-${MAX_AGENT_ID_LENGTH} chars, no control chars).`,
        `  --default-timeout-ms <ms>             Request timeout in ms (default ${DEFAULT_REQUEST_TIMEOUT_MS}).`,
        `  --search-timeout-ms <ms>              Search timeout in ms (default ${DEFAULT_SEARCH_TIMEOUT_MS}).`,
        `  --recall-min-prompt-length <chars>    Minimum prompt length for recall (default ${DEFAULT_RECALL_MIN_PROMPT_LENGTH}; 0 recalls all non-empty prompts).`,
        "  --cwd <path>                          Resolve project scope paths from this directory.",
        "",
        "Examples:",
        "  node scripts/setup.mjs scope apply --scope user --profile default",
        "  node scripts/setup.mjs scope apply --scope project --profile work --agent-id work-repo --cwd .",
        "",
      ].join("\n");
    case "scope:clear":
      return [
        "mem9 setup scope clear",
        "",
        "Usage:",
        "  node scripts/setup.mjs scope clear --scope project [--cwd <path>]",
        "",
        "Required flags:",
        "  --scope project",
        "",
        "Optional flags:",
        "  --cwd <path>    Resolve project scope paths from this directory.",
        "",
        "Example:",
        "  node scripts/setup.mjs scope clear --scope project --cwd .",
        "",
      ].join("\n");
    default:
      return [
        "mem9 setup",
        "",
        "Inspect and configure mem9 profiles and scopes for Antigravity.",
        "",
        "Usage:",
        "  node scripts/setup.mjs inspect [--cwd <path>]",
        "  node scripts/setup.mjs profile create [--profile <id>] [--label <label>] [--base-url <url>] [--provision-api-key] [--cwd <path>]",
        "  node scripts/setup.mjs profile save-key [--profile <id>] [--label <label>] [--base-url <url>] [--api-key-env <ENV>] [--cwd <path>]",
        "  node scripts/setup.mjs scope apply --scope <user|project> [--profile <id>] [--agent-id <id>] [--default-timeout-ms <ms>] [--search-timeout-ms <ms>] [--recall-min-prompt-length <n>] [--cwd <path>]",
        "  node scripts/setup.mjs scope clear --scope project [--cwd <path>]",
        "",
        "Commands:",
        "  inspect              Print the current mem9 setup state as redacted JSON.",
        "  profile create       Create or update a profile (optionally provisioning a new API key).",
        "  profile save-key     Create or update a profile from an API key environment variable.",
        "  scope apply          Write user or project scope config.",
        "  scope clear          Remove the current project's mem9 override.",
        "",
        "Notes:",
        "  - Full API keys are never printed to stdout or stderr.",
        "  - Save existing API keys from a trusted shell with MEM9_API_KEY.",
        "",
        "Run a subcommand with --help for more detail.",
        "",
      ].join("\n");
  }
}

/**
 * Expand `--flag=value` tokens into `--flag`, `value` pairs while preserving flag-only tokens.
 * @param {string[]} tokens
 * @returns {string[]}
 */
function expandEqualsTokens(tokens) {
  /** @type {string[]} */
  const expanded = [];

  for (const token of tokens) {
    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex !== -1) {
        expanded.push(token.slice(0, eqIndex), token.slice(eqIndex + 1));
        continue;
      }
    }
    expanded.push(token);
  }

  return expanded;
}

/**
 * Parse and validate CLI arguments for setup subcommands.
 * @param {string[]} [argv]
 * @returns {ParsedSetupArgs}
 */
export function parseArgs(argv = process.argv.slice(2)) {
  /** @type {ParsedSetupArgs} */
  const args = {
    command: "",
    subcommand: "",
    cwd: "",
    profileId: "",
    profileIdExplicit: false,
    label: "",
    baseUrl: "",
    apiKeyEnv: "MEM9_API_KEY",
    apiKeyEnvExplicit: false,
    provisionApiKey: false,
    scope: "",
    agentId: "",
    defaultTimeoutMs: undefined,
    searchTimeoutMs: undefined,
    recallMinPromptLength: undefined,
  };

  const [rawCommand = "", maybeSubcommand = "", ...rest] = argv;
  args.command = normalizeString(rawCommand);

  if (!args.command) {
    throw new Error("Expected one of: inspect, profile, scope.");
  }

  if (!["inspect", "profile", "scope"].includes(args.command)) {
    throw new Error(`Unknown command "${args.command}". Expected one of: inspect, profile, scope.`);
  }

  if (args.command === "profile" || args.command === "scope") {
    args.subcommand = normalizeString(maybeSubcommand);
    if (!args.subcommand) {
      throw new Error(`Expected a subcommand after \`${args.command}\`.`);
    }
  }

  const rawFlagTokens = args.command === "inspect"
    ? [maybeSubcommand, ...rest].filter((token, index) => index > 0 || normalizeString(token) !== "")
    : rest;
  const flagArgs = expandEqualsTokens(rawFlagTokens);

  /**
   * Read the next argument value or fail clearly if missing.
   * @param {string} flag
   * @param {number} index
   * @returns {string}
   */
  const requireNextValue = (flag, index) => {
    if (index + 1 >= flagArgs.length) {
      throw new Error(`Missing value for ${flag}.`);
    }
    return flagArgs[index + 1];
  };

  for (let index = 0; index < flagArgs.length; index += 1) {
    const token = flagArgs[index];

    switch (token) {
      case "--cwd":
        args.cwd = normalizeString(requireNextValue(token, index));
        if (!args.cwd) {
          throw new Error("--cwd requires a non-empty path.");
        }
        index += 1;
        break;
      case "--profile":
        args.profileId = parseProfileIdArg(token, requireNextValue(token, index));
        args.profileIdExplicit = true;
        index += 1;
        break;
      case "--label":
        args.label = normalizeString(requireNextValue(token, index));
        if (!args.label) {
          throw new Error("--label requires a non-empty value.");
        }
        index += 1;
        break;
      case "--base-url":
        args.baseUrl = normalizeBaseUrl(requireNextValue(token, index));
        if (!args.baseUrl) {
          throw new Error("--base-url requires a non-empty URL.");
        }
        index += 1;
        break;
      case "--api-key-env":
        args.apiKeyEnv = parseEnvVarNameArg(token, requireNextValue(token, index));
        args.apiKeyEnvExplicit = true;
        index += 1;
        break;
      case "--api-key":
        throw new Error(
          "`--api-key` is not supported so secrets never enter CLI arguments. Use `profile save-key --api-key-env MEM9_API_KEY` from a trusted shell.",
        );
      case "--provision-api-key":
        args.provisionApiKey = true;
        break;
      case "--scope":
        args.scope = normalizeString(requireNextValue(token, index));
        index += 1;
        break;
      case "--agent-id":
        args.agentId = parseAgentIdArg(token, requireNextValue(token, index));
        index += 1;
        break;
      case "--default-timeout-ms":
        args.defaultTimeoutMs = parsePositiveIntArg(token, requireNextValue(token, index));
        index += 1;
        break;
      case "--search-timeout-ms":
        args.searchTimeoutMs = parsePositiveIntArg(token, requireNextValue(token, index));
        index += 1;
        break;
      case "--recall-min-prompt-length":
        args.recallMinPromptLength = parseNonNegativeIntArg(token, requireNextValue(token, index));
        index += 1;
        break;
      case "":
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (args.command === "inspect") {
    if (
      args.profileIdExplicit
      || args.label
      || args.baseUrl
      || args.apiKeyEnvExplicit
      || args.provisionApiKey
      || args.scope
      || args.agentId
      || args.defaultTimeoutMs !== undefined
      || args.searchTimeoutMs !== undefined
      || args.recallMinPromptLength !== undefined
    ) {
      throw new Error("`inspect` only accepts `--cwd`.");
    }
  }

  if (args.command === "profile" && !["create", "save-key"].includes(args.subcommand)) {
    throw new Error("Profile subcommands must be `create` or `save-key`.");
  }

  if (args.command === "scope" && !["apply", "clear"].includes(args.subcommand)) {
    throw new Error("Scope subcommands must be `apply` or `clear`.");
  }

  if (args.command === "profile" && args.subcommand === "create") {
    if (args.scope || args.agentId || args.apiKeyEnvExplicit) {
      throw new Error("`profile create` does not accept `--scope`, `--agent-id`, or `--api-key-env`.");
    }
    if (
      args.defaultTimeoutMs !== undefined
      || args.searchTimeoutMs !== undefined
      || args.recallMinPromptLength !== undefined
    ) {
      throw new Error("Timeout and recall flags belong to `scope apply`.");
    }
  }

  if (args.command === "profile" && args.subcommand === "save-key") {
    if (args.provisionApiKey || args.scope || args.agentId) {
      throw new Error("`profile save-key` does not accept `--provision-api-key`, `--scope`, or `--agent-id`.");
    }
    if (
      args.defaultTimeoutMs !== undefined
      || args.searchTimeoutMs !== undefined
      || args.recallMinPromptLength !== undefined
    ) {
      throw new Error("Timeout and recall flags belong to `scope apply`.");
    }
  }

  if (args.command === "scope" && args.subcommand === "apply") {
    if (!["user", "project"].includes(args.scope)) {
      throw new Error("`scope apply` requires `--scope user` or `--scope project`.");
    }
    if (args.label || args.baseUrl || args.apiKeyEnvExplicit || args.provisionApiKey) {
      throw new Error("Profile flags belong to `profile create` or `profile save-key`.");
    }
  }

  if (args.command === "scope" && args.subcommand === "clear") {
    if (args.scope !== "project") {
      throw new Error("`scope clear` requires `--scope project`.");
    }
    if (
      args.profileIdExplicit
      || args.label
      || args.baseUrl
      || args.apiKeyEnvExplicit
      || args.provisionApiKey
      || args.agentId
      || args.defaultTimeoutMs !== undefined
      || args.searchTimeoutMs !== undefined
      || args.recallMinPromptLength !== undefined
    ) {
      throw new Error("`scope clear` only accepts `--scope project` and `--cwd`.");
    }
  }

  return args;
}

/**
 * Inspect a JSON file, distinguishing missing, valid, and malformed states.
 * @param {string} filePath
 * @param {unknown} fallback
 * @returns {{ state: "missing" | "valid" | "invalid", exists: boolean, value: unknown }}
 */
function inspectJsonFile(filePath, fallback) {
  if (!filePath || !existsSync(filePath)) {
    return {
      state: "missing",
      exists: false,
      value: fallback,
    };
  }

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return {
      state: "valid",
      exists: true,
      value: fallback,
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {
        state: "invalid",
        exists: true,
        value: fallback,
      };
    }

    return {
      state: "valid",
      exists: true,
      value: parsed,
    };
  } catch {
    return {
      state: "invalid",
      exists: true,
      value: fallback,
    };
  }
}

/**
 * Create a unique `.bak` backup path next to a corrupt file.
 * @param {string} filePath
 * @returns {string}
 */
function buildBackupPath(filePath) {
  let attempt = `${filePath}.bak`;
  let index = 1;

  while (existsSync(attempt)) {
    attempt = `${filePath}.bak.${index}`;
    index += 1;
  }

  return attempt;
}

/**
 * Back up corrupt JSON files before overwriting them.
 * @param {string[]} filePaths
 * @returns {BackupEntry[]}
 */
function backupFiles(filePaths) {
  /** @type {BackupEntry[]} */
  const backups = [];

  for (const filePath of new Set(filePaths)) {
    if (!filePath || !existsSync(filePath)) {
      continue;
    }

    const backupPath = buildBackupPath(filePath);
    copyFileSync(filePath, backupPath);
    backups.push({
      sourcePath: filePath,
      backupPath,
    });
  }

  return backups;
}

/**
 * Quote a shell token safely for POSIX or Windows shells.
 * @param {string} value
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
function shellQuote(value, platform = process.platform) {
  const text = String(value);
  if (platform === "win32") {
    return `"${text.replaceAll("\"", "\"\"").replaceAll("%", "%%")}"`;
  }

  return `'${text.replaceAll("'", `'\"'\"'`)}'`;
}

/**
 * Format a path safely without leaking home usernames when inside MEM9_HOME or projectRoot.
 * @param {string} filePath
 * @param {{ mem9Home: string, projectRoot: string | null, cwd: string }} pathContext
 * @returns {string}
 */
function sanitizeDisplayPath(filePath, pathContext) {
  if (!filePath) {
    return "";
  }

  const resolved = path.resolve(filePath);
  const resolvedMem9Home = pathContext.mem9Home ? path.resolve(pathContext.mem9Home) : "";
  const resolvedProjectRoot = pathContext.projectRoot ? path.resolve(pathContext.projectRoot) : "";
  const resolvedCwd = pathContext.cwd ? path.resolve(pathContext.cwd) : "";

  if (
    resolvedMem9Home
    && (resolved === resolvedMem9Home || resolved.startsWith(`${resolvedMem9Home}${path.sep}`))
  ) {
    const suffix = path.relative(resolvedMem9Home, resolved).replaceAll(path.sep, "/");
    return suffix ? `$MEM9_HOME/${suffix}` : "$MEM9_HOME";
  }

  if (
    resolvedProjectRoot
    && (resolved === resolvedProjectRoot || resolved.startsWith(`${resolvedProjectRoot}${path.sep}`))
  ) {
    const suffix = path.relative(resolvedProjectRoot, resolved).replaceAll(path.sep, "/");
    return suffix || ".";
  }

  if (
    resolvedCwd
    && (resolved === resolvedCwd || resolved.startsWith(`${resolvedCwd}${path.sep}`))
  ) {
    const suffix = path.relative(resolvedCwd, resolved).replaceAll(path.sep, "/");
    return suffix || ".";
  }

  return path.basename(resolved);
}

/**
 * Build a trusted-shell command template for saving an API key without pasting it into chat.
 * @param {string} profileId
 * @param {string} label
 * @param {string} baseUrl
 * @param {{ apiKeyEnv?: string }} [options]
 * @returns {string}
 */
function buildManualSaveKeyShellCommand(profileId, label, baseUrl, options = {}) {
  const nextProfileId = normalizeString(profileId) || "<profile-id>";
  const nextLabel = normalizeString(label) || nextProfileId || "<profile-label>";
  const nextBaseUrl = safeBaseUrl(baseUrl) || DEFAULT_API_URL;
  const apiKeyEnv = normalizeString(options.apiKeyEnv) || "MEM9_API_KEY";

  return [
    `${apiKeyEnv}=${shellQuote("<your-mem9-api-key>")} node ${shellQuote(SCRIPT_PATH)} profile save-key`,
    `--profile ${shellQuote(nextProfileId)}`,
    `--label ${shellQuote(nextLabel)}`,
    `--base-url ${shellQuote(nextBaseUrl)}`,
    `--api-key-env ${apiKeyEnv}`,
  ].join(" ");
}

/**
 * Summarize a scope configuration object without any secret values.
 * @param {unknown} config
 * @returns {{
 *   enabled: boolean,
 *   profileId: string,
 *   agentId?: string,
 *   defaultTimeoutMs: number,
 *   searchTimeoutMs: number,
 *   recallMinPromptLength: number,
 * } | null}
 */
function summarizeScopeConfig(config) {
  if (!isRecord(config)) {
    return null;
  }

  const agentId = normalizeAgentId(config.agentId);
  return {
    enabled: config.enabled !== false,
    profileId: normalizeString(config.profileId),
    ...(agentId ? { agentId } : {}),
    defaultTimeoutMs: normalizePositiveInt(config.defaultTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    searchTimeoutMs: normalizePositiveInt(config.searchTimeoutMs, DEFAULT_SEARCH_TIMEOUT_MS),
    recallMinPromptLength: normalizeNonNegativeInt(
      config.recallMinPromptLength,
      DEFAULT_RECALL_MIN_PROMPT_LENGTH,
    ),
  };
}

/**
 * Summarize a single profile safely using redacted key previews.
 * @param {string} profileId
 * @param {unknown} rawProfile
 * @returns {{
 *   profileId: string,
 *   label: string,
 *   baseUrl: string,
 *   hasApiKey: boolean,
 *   apiKeyPreview: string,
 *   displayName: string,
 *   displaySummary: string,
 *   manualSaveKeyCommand: string,
 * }}
 */
function summarizeProfile(profileId, rawProfile) {
  const record = isRecord(rawProfile) ? rawProfile : {};
  const label = normalizeString(record.label) || (profileId === "default" ? "Default" : profileId);
  const baseUrl = safeBaseUrl(record.baseUrl) || DEFAULT_API_URL;
  const apiKey = normalizeString(record.apiKey);
  const apiKeyPreview = redactApiKeyPreview(apiKey);
  const keyStatus = apiKeyPreview || "API key pending";

  return {
    profileId,
    label,
    baseUrl,
    hasApiKey: Boolean(apiKey),
    apiKeyPreview,
    displayName: label,
    displaySummary: `${label} (${keyStatus}) · ${baseUrl}`,
    manualSaveKeyCommand: buildManualSaveKeyShellCommand(profileId, label, baseUrl),
  };
}

/**
 * Build a redacted runtime summary object safe for JSON output.
 * @param {ReturnType<typeof loadRuntimeState>} runtimeState
 * @returns {{
 *   issueCode: string,
 *   configSource: string,
 *   authSource: string,
 *   enabled: boolean,
 *   profileId: string,
 *   baseUrl: string,
 *   agentId: string,
 *   hasApiKey: boolean,
 *   apiKeyPreview: string,
 *   defaultTimeoutMs: number,
 *   searchTimeoutMs: number,
 *   recallMinPromptLength: number,
 *   warnings: string[],
 * }}
 */
function sanitizeRuntimeSummary(runtimeState) {
  const rt = runtimeState.runtime;
  return {
    issueCode: runtimeState.issueCode,
    configSource: runtimeState.configSource,
    authSource: runtimeState.authSource,
    enabled: rt.enabled,
    profileId: rt.profileId,
    baseUrl: rt.baseUrl,
    agentId: rt.agentId,
    hasApiKey: Boolean(rt.apiKey),
    apiKeyPreview: redactApiKeyPreview(rt.apiKey),
    defaultTimeoutMs: rt.defaultTimeoutMs,
    searchTimeoutMs: rt.searchTimeoutMs,
    recallMinPromptLength: rt.recallMinPromptLength,
    warnings: Array.isArray(runtimeState.warnings) ? runtimeState.warnings : [],
  };
}

/**
 * Resolve runtime context paths and options.
 * @param {ParsedSetupArgs} args
 * @param {SetupOptions} [options]
 */
function resolveSetupContext(args, options = {}) {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const cwd = path.resolve(
    normalizeString(args.cwd) || normalizeString(options.cwd) || process.cwd(),
  );
  const mem9Home = resolveMem9Home(options.mem9Home, env, homeDir);
  const pluginDataDir = options.pluginDataDir ?? env.PLUGIN_DATA ?? "";
  const paths = resolveRuntimePaths({
    cwd,
    mem9Home,
    pluginDataDir,
    env,
    homeDir,
  });

  return {
    env,
    homeDir,
    cwd,
    mem9Home: paths.mem9Home,
    pluginDataDir,
    paths,
    pathContext: {
      mem9Home: paths.mem9Home,
      projectRoot: paths.projectRoot,
      cwd,
    },
  };
}

/**
 * Emit a JSON summary line to stdout.
 * @param {unknown} payload
 * @param {WritableLike | undefined} stdout
 */
function emitJson(payload, stdout = process.stdout) {
  stdout?.write(`${JSON.stringify(payload)}\n`);
}

/**
 * Load credentials file for writing, backing up malformed JSON if present.
 * @param {string} credentialsPath
 * @returns {{ credentials: { schemaVersion: number, profiles: Record<string, RawProfileRecord> }, backups: BackupEntry[] }}
 */
function loadCredentialsForWrite(credentialsPath) {
  const inspected = inspectJsonFile(credentialsPath, { schemaVersion: 1, profiles: {} });
  if (inspected.state === "invalid") {
    const backups = backupFiles([credentialsPath]);
    return {
      credentials: { schemaVersion: 1, profiles: {} },
      backups,
    };
  }

  const record = isRecord(inspected.value) ? inspected.value : {};
  const rawProfiles = isRecord(record.profiles) ? record.profiles : {};
  /** @type {Record<string, RawProfileRecord>} */
  const profiles = {};

  for (const [id, profile] of Object.entries(rawProfiles)) {
    if (isRecord(profile)) {
      profiles[id] = {
        ...(typeof profile.label === "string" ? { label: profile.label } : {}),
        ...(typeof profile.baseUrl === "string" ? { baseUrl: profile.baseUrl } : {}),
        ...(typeof profile.apiKey === "string" ? { apiKey: profile.apiKey } : {}),
      };
    }
  }

  return {
    credentials: {
      schemaVersion: 1,
      profiles,
    },
    backups: [],
  };
}

/**
 * Inspect current mem9 state, profiles, and scope files without modifying disk.
 * @param {ParsedSetupArgs | string[]} [argv]
 * @param {SetupOptions} [options]
 */
export function inspectSetup(argv = process.argv.slice(2), options = {}) {
  const args = Array.isArray(argv) ? parseArgs(argv) : argv;
  const context = resolveSetupContext(args, options);
  const runtimeState = loadRuntimeState({
    cwd: context.cwd,
    mem9Home: context.mem9Home,
    pluginDataDir: context.pluginDataDir,
    env: context.env,
    homeDir: context.homeDir,
  });

  const credentialsInspection = inspectJsonFile(
    context.paths.credentialsPath,
    { schemaVersion: 1, profiles: {} },
  );
  const credentialsRecord = isRecord(credentialsInspection.value)
    ? credentialsInspection.value
    : {};
  const rawProfiles = isRecord(credentialsRecord.profiles)
    ? credentialsRecord.profiles
    : {};
  const items = Object.entries(rawProfiles)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([profileId, profile]) => summarizeProfile(profileId, profile));
  const usableProfileIds = items
    .filter((item) => item.hasApiKey)
    .map((item) => item.profileId);

  const userConfigInspection = inspectJsonFile(context.paths.userConfigPath, {});
  const projectConfigInspection = context.paths.projectConfigPath
    ? inspectJsonFile(context.paths.projectConfigPath, {})
    : { state: "not_in_repo", exists: false, value: null };

  const defaultProfileId = items.some((item) => item.profileId === "default")
    ? "default"
    : (items[0]?.profileId ?? "default");

  const result = {
    status: "ok",
    command: "inspect",
    runtime: sanitizeRuntimeSummary(runtimeState),
    userConfig: {
      state: userConfigInspection.state,
      exists: userConfigInspection.exists,
      path: sanitizeDisplayPath(context.paths.userConfigPath, context.pathContext),
      summary: userConfigInspection.state === "valid"
        ? summarizeScopeConfig(userConfigInspection.value)
        : null,
    },
    projectConfig: {
      state: projectConfigInspection.state,
      exists: projectConfigInspection.exists,
      path: sanitizeDisplayPath(context.paths.projectConfigPath, context.pathContext),
      summary: projectConfigInspection.state === "valid"
        ? summarizeScopeConfig(projectConfigInspection.value)
        : null,
    },
    profiles: {
      credentialsState: credentialsInspection.state,
      credentialsPath: sanitizeDisplayPath(context.paths.credentialsPath, context.pathContext),
      defaultProfileId,
      hasUsableProfiles: usableProfileIds.length > 0,
      usableProfileIds,
      manualSaveKeyTemplate: buildManualSaveKeyShellCommand(
        "<profile-id>",
        "<profile-label>",
        DEFAULT_API_URL,
      ),
      items,
    },
    paths: {
      mem9Home: "$MEM9_HOME",
      credentialsPath: sanitizeDisplayPath(context.paths.credentialsPath, context.pathContext),
      userConfigPath: sanitizeDisplayPath(context.paths.userConfigPath, context.pathContext),
      projectConfigPath: sanitizeDisplayPath(context.paths.projectConfigPath, context.pathContext),
      pluginAuthFallbackPath: context.paths.pluginAuthFallbackPath
        ? "${PLUGIN_DATA}/auth.json"
        : "",
    },
  };

  emitJson(result, options.stdout ?? process.stdout);
  return result;
}

/**
 * Create or update a profile, optionally provisioning a fresh mem9 API key.
 * @param {ParsedSetupArgs} args
 * @param {SetupOptions} [options]
 */
async function runProfileCreate(args, options = {}) {
  const context = resolveSetupContext(args, options);
  const { credentials, backups } = loadCredentialsForWrite(context.paths.credentialsPath);
  const profileId = args.profileId || "default";
  const existing = credentials.profiles[profileId];
  const existed = Boolean(existing);

  const label = args.label
    || normalizeString(existing?.label)
    || (profileId === "default" ? "Default" : profileId);
  const baseUrl = args.baseUrl
    || safeBaseUrl(existing?.baseUrl)
    || DEFAULT_API_URL;
  let apiKey = normalizeString(existing?.apiKey);

  if (args.provisionApiKey) {
    if (options.provisionFn) {
      const provisioned = await options.provisionFn(baseUrl);
      apiKey = normalizeString(
        typeof provisioned === "string" ? provisioned : provisioned?.apiKey,
      );
    } else {
      const provisioned = await provisionMem9Space(baseUrl, {
        timeoutMs: options.provisionTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        fetchImpl: options.fetch ?? fetch,
      });
      apiKey = normalizeString(provisioned?.apiKey);
    }

    if (!apiKey) {
      throw new Error("mem9 profile provisioning did not return an API key.");
    }
  }

  credentials.profiles[profileId] = {
    label,
    baseUrl,
    apiKey,
  };

  writeJsonAtomic(context.paths.credentialsPath, credentials, { mode: 0o600 });

  const result = {
    status: "ok",
    command: "profile.create",
    action: existed ? "updated" : "created",
    profileId,
    label,
    baseUrl,
    hasApiKey: Boolean(apiKey),
    apiKeyPreview: redactApiKeyPreview(apiKey),
    provisioned: args.provisionApiKey,
    credentialsPath: sanitizeDisplayPath(context.paths.credentialsPath, context.pathContext),
    backups: backups.map((entry) => ({
      sourcePath: sanitizeDisplayPath(entry.sourcePath, context.pathContext),
      backupPath: sanitizeDisplayPath(entry.backupPath, context.pathContext),
    })),
  };

  emitJson(result, options.stdout ?? process.stdout);
  return result;
}

/**
 * Save an API key from an environment variable into ~/.mem9/.credentials.json.
 * @param {ParsedSetupArgs} args
 * @param {SetupOptions} [options]
 */
async function runProfileSaveKey(args, options = {}) {
  const context = resolveSetupContext(args, options);
  const profileId = args.profileId || "default";
  const apiKeyEnv = args.apiKeyEnv || "MEM9_API_KEY";
  const { credentials, backups } = loadCredentialsForWrite(context.paths.credentialsPath);
  const existing = credentials.profiles[profileId];
  const existed = Boolean(existing);

  const label = args.label
    || normalizeString(existing?.label)
    || (profileId === "default" ? "Default" : profileId);
  const baseUrl = args.baseUrl
    || safeBaseUrl(existing?.baseUrl)
    || DEFAULT_API_URL;
  const apiKey = normalizeString(context.env[apiKeyEnv]);

  if (!apiKey) {
    const shellCmd = buildManualSaveKeyShellCommand(profileId, label, baseUrl, { apiKeyEnv });
    throw new Error(
      `Environment variable \`${apiKeyEnv}\` is empty or unset. Run from a trusted shell instead of pasting keys into chat: ${shellCmd}`,
    );
  }

  credentials.profiles[profileId] = {
    label,
    baseUrl,
    apiKey,
  };

  writeJsonAtomic(context.paths.credentialsPath, credentials, { mode: 0o600 });

  const result = {
    status: "ok",
    command: "profile.save-key",
    action: existed ? "updated" : "created",
    profileId,
    label,
    baseUrl,
    apiKeyEnv,
    hasApiKey: true,
    apiKeyPreview: redactApiKeyPreview(apiKey),
    credentialsPath: sanitizeDisplayPath(context.paths.credentialsPath, context.pathContext),
    backups: backups.map((entry) => ({
      sourcePath: sanitizeDisplayPath(entry.sourcePath, context.pathContext),
      backupPath: sanitizeDisplayPath(entry.backupPath, context.pathContext),
    })),
  };

  emitJson(result, options.stdout ?? process.stdout);
  return result;
}

/**
 * Apply user or project scope configuration referencing an existing usable profile.
 * @param {ParsedSetupArgs} args
 * @param {SetupOptions} [options]
 */
async function runScopeApply(args, options = {}) {
  const context = resolveSetupContext(args, options);

  if (args.scope === "project" && (!context.paths.projectRoot || !context.paths.projectConfigPath)) {
    throw new Error("Could not resolve a project directory for `--scope project`.");
  }

  const credentialsInspection = inspectJsonFile(
    context.paths.credentialsPath,
    { schemaVersion: 1, profiles: {} },
  );
  if (credentialsInspection.state === "invalid") {
    throw new Error(
      "Shared mem9 credentials contain invalid JSON. Run `profile create --provision-api-key` or `profile save-key` to repair.",
    );
  }

  const credentialsRecord = isRecord(credentialsInspection.value)
    ? credentialsInspection.value
    : {};
  const rawProfiles = isRecord(credentialsRecord.profiles) ? credentialsRecord.profiles : {};

  /** @type {string[]} */
  const invalidFiles = [];
  const userConfigInspection = inspectJsonFile(context.paths.userConfigPath, {});
  if (userConfigInspection.state === "invalid") {
    invalidFiles.push(context.paths.userConfigPath);
  }
  const userConfig = userConfigInspection.state === "valid" && isRecord(userConfigInspection.value)
    ? /** @type {RawScopeConfig} */ (userConfigInspection.value)
    : {};

  const targetConfigPath = args.scope === "project"
    ? context.paths.projectConfigPath
    : context.paths.userConfigPath;
  const targetInspection = args.scope === "project"
    ? inspectJsonFile(targetConfigPath, {})
    : userConfigInspection;
  if (args.scope === "project" && targetInspection.state === "invalid") {
    invalidFiles.push(targetConfigPath);
  }
  const targetConfig = targetInspection.state === "valid" && isRecord(targetInspection.value)
    ? /** @type {RawScopeConfig} */ (targetInspection.value)
    : {};

  const profileId = args.profileId
    || normalizeString(targetConfig.profileId)
    || normalizeString(userConfig.profileId)
    || "default";

  const selectedProfile = isRecord(rawProfiles[profileId]) ? rawProfiles[profileId] : null;
  if (!selectedProfile) {
    throw new Error(
      `Profile "${profileId}" was not found in $MEM9_HOME/.credentials.json. Run \`profile create --profile ${profileId} --provision-api-key\` or \`profile save-key\` first.`,
    );
  }
  if (!normalizeString(selectedProfile.apiKey)) {
    throw new Error(
      `Profile "${profileId}" does not have an API key. Run \`profile create --profile ${profileId} --provision-api-key\` or \`profile save-key\` first.`,
    );
  }

  const backups = backupFiles(invalidFiles);

  // Project scope inherits userConfig.agentId dynamically at runtime when unset locally.
  const resolvedAgentId = args.agentId || normalizeAgentId(targetConfig.agentId);
  const baseDefaults = args.scope === "project"
    ? {
      defaultTimeoutMs: pickPositiveInt(targetConfig.defaultTimeoutMs)
        ?? pickPositiveInt(userConfig.defaultTimeoutMs)
        ?? DEFAULT_REQUEST_TIMEOUT_MS,
      searchTimeoutMs: pickPositiveInt(targetConfig.searchTimeoutMs)
        ?? pickPositiveInt(userConfig.searchTimeoutMs)
        ?? DEFAULT_SEARCH_TIMEOUT_MS,
      recallMinPromptLength: pickNonNegativeInt(targetConfig.recallMinPromptLength)
        ?? pickNonNegativeInt(userConfig.recallMinPromptLength)
        ?? DEFAULT_RECALL_MIN_PROMPT_LENGTH,
    }
    : {
      defaultTimeoutMs: pickPositiveInt(targetConfig.defaultTimeoutMs) ?? DEFAULT_REQUEST_TIMEOUT_MS,
      searchTimeoutMs: pickPositiveInt(targetConfig.searchTimeoutMs) ?? DEFAULT_SEARCH_TIMEOUT_MS,
      recallMinPromptLength:
        pickNonNegativeInt(targetConfig.recallMinPromptLength) ?? DEFAULT_RECALL_MIN_PROMPT_LENGTH,
    };

  /** @type {RawScopeConfig} */
  const nextConfig = {
    schemaVersion: 1,
    profileId,
    ...(resolvedAgentId ? { agentId: resolvedAgentId } : {}),
    defaultTimeoutMs: args.defaultTimeoutMs ?? baseDefaults.defaultTimeoutMs,
    searchTimeoutMs: args.searchTimeoutMs ?? baseDefaults.searchTimeoutMs,
    recallMinPromptLength: args.recallMinPromptLength ?? baseDefaults.recallMinPromptLength,
  };

  writeJsonAtomic(targetConfigPath, nextConfig, { mode: 0o600 });

  const runtimeState = loadRuntimeState({
    cwd: context.cwd,
    mem9Home: context.mem9Home,
    pluginDataDir: context.pluginDataDir,
    env: context.env,
    homeDir: context.homeDir,
  });

  const result = {
    status: "ok",
    command: "scope.apply",
    action: "written",
    scope: args.scope,
    profileId,
    configPath: sanitizeDisplayPath(targetConfigPath, context.pathContext),
    configSummary: summarizeScopeConfig(nextConfig),
    runtime: sanitizeRuntimeSummary(runtimeState),
    backups: backups.map((entry) => ({
      sourcePath: sanitizeDisplayPath(entry.sourcePath, context.pathContext),
      backupPath: sanitizeDisplayPath(entry.backupPath, context.pathContext),
    })),
  };

  emitJson(result, options.stdout ?? process.stdout);
  return result;
}

/**
 * Remove the project-scoped mem9 override config file.
 * @param {ParsedSetupArgs} args
 * @param {SetupOptions} [options]
 */
async function runScopeClear(args, options = {}) {
  const context = resolveSetupContext(args, options);

  if (!context.paths.projectRoot || !context.paths.projectConfigPath) {
    throw new Error("Could not resolve a project directory for `scope clear`.");
  }

  const existed = existsSync(context.paths.projectConfigPath);
  if (existed) {
    rmSync(context.paths.projectConfigPath, { force: true });
  }

  const runtimeState = loadRuntimeState({
    cwd: context.cwd,
    mem9Home: context.mem9Home,
    pluginDataDir: context.pluginDataDir,
    env: context.env,
    homeDir: context.homeDir,
  });

  const result = {
    status: "ok",
    command: "scope.clear",
    action: existed ? "removed" : "already-clear",
    scope: "project",
    configPath: sanitizeDisplayPath(context.paths.projectConfigPath, context.pathContext),
    runtime: sanitizeRuntimeSummary(runtimeState),
    backups: [],
  };

  emitJson(result, options.stdout ?? process.stdout);
  return result;
}

/**
 * Execute a mem9 setup command programmatically or from CLI arguments.
 * @param {string[] | ParsedSetupArgs} [argv]
 * @param {SetupOptions} [options]
 */
export async function runSetup(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout ?? process.stdout;

  if (Array.isArray(argv)) {
    const helpRequest = detectHelpRequest(argv);
    if (helpRequest) {
      stdout?.write(buildSetupHelpText(helpRequest.command, helpRequest.subcommand));
      return {
        status: "ok",
        command: "help",
        topic: helpRequest.command
          ? [helpRequest.command, helpRequest.subcommand].filter(Boolean).join(" ")
          : "root",
      };
    }
  }

  const args = Array.isArray(argv) ? parseArgs(argv) : argv;

  if (args.command === "inspect") {
    return inspectSetup(args, options);
  }

  if (args.command === "profile" && args.subcommand === "create") {
    return runProfileCreate(args, options);
  }

  if (args.command === "profile" && args.subcommand === "save-key") {
    return runProfileSaveKey(args, options);
  }

  if (args.command === "scope" && args.subcommand === "apply") {
    return runScopeApply(args, options);
  }

  if (args.command === "scope" && args.subcommand === "clear") {
    return runScopeClear(args, options);
  }

  throw new Error("Unsupported mem9 setup command.");
}

/**
 * CLI entrypoint wrapper with standardized error output.
 * @param {string[]} [argv]
 * @param {SetupOptions} [options]
 */
export async function main(argv = process.argv.slice(2), options = {}) {
  const stderr = options.stderr ?? process.stderr;

  try {
    return await runSetup(argv, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr?.write(`${JSON.stringify({ status: "error", error: message })}\n`);
    process.exitCode = 1;
    return null;
  }
}

function isDirectCliExecution() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  }
}

if (isDirectCliExecution()) {
  await main();
}
