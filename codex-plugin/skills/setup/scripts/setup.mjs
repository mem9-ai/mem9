#!/usr/bin/env node
// @ts-nocheck

import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  loadRuntimeStateFromDisk,
  resolveCodexHome,
  resolveMem9Home,
} from "../../../lib/config.mjs";
import { resolveProjectRoot } from "../../../lib/project-root.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const HOOK_SHIM_SOURCE_DIR = path.join(PACKAGE_ROOT, "bootstrap-hooks");
const HOOK_TEMPLATE_PATH = path.join(PACKAGE_ROOT, "templates", "hooks.json");
const DEFAULT_BASE_URL = "https://api.mem9.ai";
const DEFAULT_UPDATE_CHECK = Object.freeze({
  enabled: true,
  intervalHours: 24,
});
const DEFAULT_INSTALL_METADATA = {
  schemaVersion: 1,
  marketplaceName: "mem9-ai",
  pluginName: "mem9",
  shimVersion: 1,
};
const MEM9_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop"];
const HOOK_TEMPLATE_KEYS = {
  sessionStartCommand: "__MEM9_SESSION_START_COMMAND__",
  userPromptSubmitCommand: "__MEM9_USER_PROMPT_SUBMIT_COMMAND__",
  stopCommand: "__MEM9_STOP_COMMAND__",
};
const MEM9_MANAGED_HOOKS = {
  SessionStart: {
    statusMessage: "[mem9] session start",
    scriptName: "session-start.mjs",
  },
  UserPromptSubmit: {
    statusMessage: "[mem9] recall",
    scriptName: "user-prompt-submit.mjs",
  },
  Stop: {
    statusMessage: "[mem9] save",
    scriptName: "stop.mjs",
  },
};

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.replace(/\/+$/, "") : "";
}

function normalizeTimeoutMs(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function parseIntegerArg(flag, value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }

  return parsed;
}

function parseUpdateCheckMode(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "enabled" || normalized === "disabled") {
    return normalized;
  }

  throw new Error("`--update-check` must be `enabled` or `disabled`.");
}

function readTextFile(filePath, readFile = readFileSync) {
  return readFile(filePath, "utf8");
}

function getProfiles(credentials) {
  return isRecord(credentials?.profiles) ? credentials.profiles : {};
}

function hasApiKey(profile) {
  return Boolean(normalizeString(profile?.apiKey));
}

function buildDefaultProfileId(profiles) {
  const profileIds = Object.keys(profiles).sort();
  if (profileIds.includes("default")) {
    return "default";
  }

  return profileIds[0] ?? "default";
}

function normalizeProfileRecord(profileId, profile) {
  const current = isRecord(profile) ? profile : {};

  return {
    label: normalizeString(current.label) || profileId,
    baseUrl: normalizeBaseUrl(current.baseUrl) || DEFAULT_BASE_URL,
    apiKey: typeof current.apiKey === "string" ? current.apiKey : "",
  };
}

function readJsonFileOrDefault(filePath, fallback, fsOps = {}, options = {}) {
  const exists = fsOps.existsSync ?? existsSync;
  const readFile = fsOps.readFileSync ?? readFileSync;

  if (!exists(filePath)) {
    return fallback;
  }

  const raw = readTextFile(filePath, readFile).trim();
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    if (options.fallbackOnParseError) {
      options.onParseError?.(filePath, error);
      return fallback;
    }

    throw error;
  }
}

function readTextFileOrDefault(filePath, fallback, fsOps = {}) {
  const exists = fsOps.existsSync ?? existsSync;
  const readFile = fsOps.readFileSync ?? readFileSync;

  if (!exists(filePath)) {
    return fallback;
  }

  return readTextFile(filePath, readFile);
}

function writeJsonFile(filePath, value, fsOps = {}) {
  const mkdir = fsOps.mkdirSync ?? mkdirSync;
  const writeFile = fsOps.writeFileSync ?? writeFileSync;

  mkdir(path.dirname(filePath), { recursive: true });
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTextFile(filePath, text, fsOps = {}) {
  const mkdir = fsOps.mkdirSync ?? mkdirSync;
  const writeFile = fsOps.writeFileSync ?? writeFileSync;

  mkdir(path.dirname(filePath), { recursive: true });
  writeFile(filePath, text);
}

function buildBackupPath(filePath, fsOps = {}) {
  const exists = fsOps.existsSync ?? existsSync;
  let attempt = `${filePath}.bak`;
  let index = 1;

  while (exists(attempt)) {
    attempt = `${filePath}.bak.${index}`;
    index += 1;
  }

  return attempt;
}

function backupFiles(filePaths, fsOps = {}) {
  const exists = fsOps.existsSync ?? existsSync;
  const copyFile = fsOps.copyFileSync ?? copyFileSync;
  const backups = [];

  for (const filePath of new Set(filePaths)) {
    if (!exists(filePath)) {
      continue;
    }

    const backupPath = buildBackupPath(filePath, fsOps);
    copyFile(filePath, backupPath);
    backups.push({
      sourcePath: filePath,
      backupPath,
    });
  }

  return backups;
}

function sanitizeDisplayPath(filePath, { cwd, codexHome, mem9Home }) {
  const resolved = path.resolve(filePath);
  const resolvedCwd = normalizeString(cwd) ? path.resolve(cwd) : "";
  const resolvedCodexHome = normalizeString(codexHome) ? path.resolve(codexHome) : "";
  const resolvedMem9Home = normalizeString(mem9Home) ? path.resolve(mem9Home) : "";

  if (
    resolved === resolvedMem9Home
    || resolved.startsWith(`${resolvedMem9Home}${path.sep}`)
  ) {
    const suffix = path.relative(resolvedMem9Home, resolved).replaceAll(path.sep, "/");
    return suffix ? `$MEM9_HOME/${suffix}` : "$MEM9_HOME";
  }

  if (
    resolved === resolvedCodexHome
    || resolved.startsWith(`${resolvedCodexHome}${path.sep}`)
  ) {
    const suffix = path.relative(resolvedCodexHome, resolved).replaceAll(path.sep, "/");
    return suffix ? `$CODEX_HOME/${suffix}` : "$CODEX_HOME";
  }

  if (
    resolved === resolvedCwd
    || resolved.startsWith(`${resolvedCwd}${path.sep}`)
  ) {
    const suffix = path.relative(resolvedCwd, resolved).replaceAll(path.sep, "/");
    return suffix || ".";
  }

  return path.basename(resolved);
}

function sanitizeRelativePath(filePath, basePath, options = {}) {
  const resolvedBase = normalizeString(basePath) ? path.resolve(basePath) : "";
  if (!resolvedBase) {
    return "";
  }

  const resolved = path.resolve(filePath);
  if (!options.allowParentTraversal) {
    if (resolved === resolvedBase) {
      return ".";
    }

    if (resolved.startsWith(`${resolvedBase}${path.sep}`)) {
      return path.relative(resolvedBase, resolved).replaceAll(path.sep, "/");
    }

    return "";
  }

  const relative = path.relative(resolvedBase, resolved).replaceAll(path.sep, "/");
  if (!relative) {
    return ".";
  }

  return path.isAbsolute(relative) ? "" : relative;
}

function sanitizeProjectPath(filePath, context) {
  const projectRelative = sanitizeRelativePath(filePath, context.projectRoot);
  return projectRelative || sanitizeDisplayPath(filePath, context);
}

function sanitizeBackupsForOutput(backups, context) {
  return backups.map((backup) => ({
    sourcePath: sanitizeDisplayPath(backup.sourcePath, context),
    backupPath: sanitizeDisplayPath(backup.backupPath, context),
  }));
}

function sanitizeOptionalPath(filePath, context) {
  return normalizeString(filePath)
    ? sanitizeDisplayPath(filePath, context)
    : "";
}

function requireString(flag, value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`${flag} is required.`);
  }

  return normalized;
}

function summarizeApiKeyPreview(apiKey) {
  const normalized = normalizeString(apiKey);
  if (!normalized) {
    return "";
  }

  if (normalized.length <= 4) {
    return normalized[0] ? `${normalized[0]}...` : "";
  }

  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}...${normalized.slice(-2)}`;
  }

  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function summarizeProfileDisplayName(profileId, label) {
  const nextProfileId = normalizeString(profileId);
  return normalizeString(label) || nextProfileId;
}

function summarizeProfileDisplaySummary(profile) {
  const profileId = normalizeString(profile.profileId);
  const displayName = summarizeProfileDisplayName(profileId, profile.label);
  const baseUrl = normalizeString(profile.baseUrl);
  const apiKeyPreview = summarizeApiKeyPreview(profile.apiKey);
  const keyStatus = apiKeyPreview || "API key pending";

  return `${displayName} (${keyStatus}) · ${baseUrl}`;
}

function summarizeProfiles(profiles) {
  return Object.entries(isRecord(profiles) ? profiles : {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([profileId, profile]) => {
      const current = normalizeProfileRecord(profileId, profile);
      return {
        profileId,
        label: current.label,
        baseUrl: current.baseUrl,
        hasApiKey: hasApiKey(current),
        apiKeyPreview: summarizeApiKeyPreview(current.apiKey),
        displayName: summarizeProfileDisplayName(profileId, current.label),
        displaySummary: summarizeProfileDisplaySummary({
          profileId,
          label: current.label,
          baseUrl: current.baseUrl,
          apiKey: current.apiKey,
        }),
      };
    });
}

function normalizeUpdateCheckConfig(value) {
  const current = isRecord(value) ? value : {};

  return {
    enabled: current.enabled !== false,
    intervalHours: normalizeTimeoutMs(
      current.intervalHours,
      DEFAULT_UPDATE_CHECK.intervalHours,
    ),
  };
}

function stripTomlLineComment(line) {
  const text = String(line ?? "");
  let quotedBy = "";
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];

    if (quotedBy) {
      if (quotedBy === "\"" && ch === "\\" && !escaped) {
        escaped = true;
        continue;
      }

      if (ch === quotedBy && !escaped) {
        quotedBy = "";
      }

      escaped = false;
      continue;
    }

    if (ch === "\"" || ch === "'") {
      quotedBy = ch;
      escaped = false;
      continue;
    }

    if (ch === "#") {
      return text.slice(0, index);
    }
  }

  return text;
}

function parseFeaturesCodexHooksEnabled(configTomlText = "") {
  const lines = String(configTomlText ?? "").split(/\r?\n/);
  let inFeatures = false;

  for (const line of lines) {
    const normalized = stripTomlLineComment(line).trim();

    if (/^\[[^\]]+\]$/.test(normalized)) {
      inFeatures = normalized === "[features]";
      continue;
    }

    if (!inFeatures) {
      continue;
    }

    const match = normalized.match(/^codex_hooks\s*=\s*(true|false)$/i);
    if (match) {
      return match[1].toLowerCase() === "true";
    }
  }

  return false;
}

function inspectJsonFile(filePath, fallback, fsOps = {}) {
  const exists = fsOps.existsSync ?? existsSync;
  const readFile = fsOps.readFileSync ?? readFileSync;

  if (!exists(filePath)) {
    return {
      state: "missing",
      exists: false,
      value: fallback,
    };
  }

  const raw = readTextFile(filePath, readFile).trim();
  if (!raw) {
    return {
      state: "valid",
      exists: true,
      value: fallback,
    };
  }

  try {
    return {
      state: "valid",
      exists: true,
      value: JSON.parse(raw),
    };
  } catch {
    return {
      state: "invalid",
      exists: true,
      value: fallback,
    };
  }
}

function summarizeScopeConfigState(config, options = {}) {
  if (!isRecord(config)) {
    return null;
  }

  const summary = {
    profileId: normalizeString(config.profileId),
    defaultTimeoutMs: normalizeTimeoutMs(
      config.defaultTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    searchTimeoutMs: normalizeTimeoutMs(
      config.searchTimeoutMs,
      DEFAULT_SEARCH_TIMEOUT_MS,
    ),
    legacyEnabledFalse: config.enabled === false,
  };

  if (options.includeUpdateCheck) {
    summary.updateCheck = normalizeUpdateCheckConfig(config.updateCheck);
  }

  return summary;
}

function summarizeScopeFile(filePath, context, fsOps = {}, options = {}) {
  const inspected = inspectJsonFile(filePath, {}, fsOps);
  const summary = inspected.state === "valid"
    ? summarizeScopeConfigState(inspected.value, options)
    : null;

  return {
    state: inspected.state,
    exists: inspected.exists,
    path: options.projectRelative
      ? sanitizeProjectPath(filePath, context)
      : sanitizeDisplayPath(filePath, context),
    summary,
  };
}

function inspectInstallMetadata(filePath, context, fsOps = {}) {
  const inspected = inspectJsonFile(filePath, {}, fsOps);
  const install = isRecord(inspected.value) ? inspected.value : {};
  const ready = inspected.state === "valid"
    && normalizeString(install.marketplaceName)
    && normalizeString(install.pluginName);

  return {
    state: ready ? "ready" : inspected.state,
    present: inspected.exists,
    path: sanitizeDisplayPath(filePath, context),
  };
}

function listRelativeFiles(dirPath, fsOps = {}, prefix = "") {
  const readDir = fsOps.readdirSync ?? readdirSync;

  return readDir(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = prefix
      ? path.join(prefix, entry.name)
      : entry.name;
    const sourcePath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      return listRelativeFiles(sourcePath, fsOps, relativePath);
    }

    return [relativePath];
  });
}

function detectHookShimsInstalled(sourceDir, targetDir, fsOps = {}) {
  const exists = fsOps.existsSync ?? existsSync;

  try {
    return listRelativeFiles(sourceDir, fsOps)
      .every((relativePath) => exists(path.join(targetDir, relativePath)));
  } catch {
    return false;
  }
}

function detectManagedHooksInstalled(existingHooks) {
  for (const eventName of MEM9_EVENTS) {
    const groups = Array.isArray(existingHooks?.hooks?.[eventName])
      ? existingHooks.hooks[eventName]
      : [];
    const hasManagedHook = groups.some((group) =>
      Array.isArray(group?.hooks)
      && group.hooks.some((hook) => isMem9ManagedHook(eventName, hook)),
    );

    if (!hasManagedHook) {
      return false;
    }
  }

  return true;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    command: "",
    subcommand: "",
    cwd: "",
    profileId: "",
    label: "",
    baseUrl: "",
    apiKeyEnv: "",
    provisionApiKey: false,
    scope: "",
    defaultTimeoutMs: undefined,
    searchTimeoutMs: undefined,
    updateCheck: "",
    updateCheckIntervalHours: undefined,
  };

  const [command = "", maybeSubcommand = "", ...rest] = argv;
  args.command = normalizeString(command);

  if (!args.command) {
    throw new Error("Expected one of: inspect, profile, scope.");
  }

  if (args.command === "profile" || args.command === "scope") {
    args.subcommand = normalizeString(maybeSubcommand);
    if (!args.subcommand) {
      throw new Error(`Expected a subcommand after \`${args.command}\`.`);
    }
  }

  const flagArgs = args.command === "inspect"
    ? [maybeSubcommand, ...rest].filter((token, index) =>
      index > 0 || normalizeString(token).startsWith("--"),
    )
    : rest;

  for (let index = 0; index < flagArgs.length; index += 1) {
    const token = flagArgs[index];
    const nextValue = flagArgs[index + 1];

    switch (token) {
      case "--cwd":
        args.cwd = normalizeString(nextValue);
        index += 1;
        break;
      case "--profile":
        args.profileId = normalizeString(nextValue);
        index += 1;
        break;
      case "--label":
        args.label = normalizeString(nextValue);
        index += 1;
        break;
      case "--base-url":
        args.baseUrl = normalizeBaseUrl(nextValue);
        index += 1;
        break;
      case "--api-key-env":
        args.apiKeyEnv = normalizeString(nextValue);
        index += 1;
        break;
      case "--provision-api-key":
        args.provisionApiKey = true;
        break;
      case "--scope":
        args.scope = normalizeString(nextValue);
        index += 1;
        break;
      case "--default-timeout-ms":
        args.defaultTimeoutMs = parseIntegerArg(token, nextValue);
        index += 1;
        break;
      case "--search-timeout-ms":
        args.searchTimeoutMs = parseIntegerArg(token, nextValue);
        index += 1;
        break;
      case "--update-check":
        args.updateCheck = parseUpdateCheckMode(nextValue);
        index += 1;
        break;
      case "--update-check-interval-hours":
        args.updateCheckIntervalHours = parseIntegerArg(token, nextValue);
        index += 1;
        break;
      case "":
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  const hasUpdateCheckFlags = Boolean(args.updateCheck)
    || args.updateCheckIntervalHours !== undefined;

  if (
    hasUpdateCheckFlags
    && !(args.command === "scope" && args.subcommand === "apply")
  ) {
    throw new Error("`--update-check` flags only support `scope apply`.");
  }

  if (args.command === "profile" && !["create", "save-key"].includes(args.subcommand)) {
    throw new Error("Profile subcommands must be `create` or `save-key`.");
  }

  if (args.command === "scope" && !["apply", "clear"].includes(args.subcommand)) {
    throw new Error("Scope subcommands must be `apply` or `clear`.");
  }

  if (args.command === "profile" && args.subcommand === "create") {
    requireString("--profile", args.profileId);
    if (!args.provisionApiKey) {
      throw new Error("`profile create` requires `--provision-api-key`.");
    }
  }

  if (args.command === "profile" && args.subcommand === "save-key") {
    requireString("--profile", args.profileId);
    requireString("--api-key-env", args.apiKeyEnv);
  }

  if (args.command === "scope" && args.subcommand === "apply") {
    requireString("--scope", args.scope);
    if (!["user", "project"].includes(args.scope)) {
      throw new Error("`scope apply` requires `--scope user` or `--scope project`.");
    }
    if (args.scope !== "user" && hasUpdateCheckFlags) {
      throw new Error("`--update-check` flags only support `--scope user`.");
    }
    requireString("--profile", args.profileId);
  }

  if (args.command === "scope" && args.subcommand === "clear") {
    if (args.scope !== "project") {
      throw new Error("`scope clear` only supports `--scope project`.");
    }
    if (
      args.profileId
      || args.label
      || args.baseUrl
      || args.apiKeyEnv
      || args.provisionApiKey
      || args.defaultTimeoutMs !== undefined
      || args.searchTimeoutMs !== undefined
      || args.updateCheck
      || args.updateCheckIntervalHours !== undefined
    ) {
      throw new Error("`scope clear` only accepts `--scope project` and `--cwd`.");
    }
  }

  return args;
}

export function assertNodeVersion(nodeVersion = process.versions.node) {
  const major = Number.parseInt(String(nodeVersion).split(".")[0] ?? "", 10);
  if (!Number.isFinite(major) || major < 22) {
    throw new Error("Node.js 22+ is required before installing mem9 hooks.");
  }

  return major;
}

export function isWritablePath(targetPath, fsOps = {}) {
  const exists = fsOps.existsSync ?? existsSync;
  const access = fsOps.accessSync ?? accessSync;
  const accessConstants = fsOps.constants ?? constants;
  let probe = path.resolve(targetPath);

  while (!exists(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) {
      return false;
    }

    probe = parent;
  }

  try {
    access(probe, accessConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveGlobalPaths(codexHome) {
  const mem9Dir = path.join(codexHome, "mem9");
  return {
    mem9Dir,
    hooksDir: path.join(mem9Dir, "hooks"),
    installPath: path.join(mem9Dir, "install.json"),
    configPath: path.join(mem9Dir, "config.json"),
    hooksPath: path.join(codexHome, "hooks.json"),
    configTomlPath: path.join(codexHome, "config.toml"),
  };
}

export function resolveInstalledPluginIdentity(codexHome, packageRoot = PACKAGE_ROOT) {
  const cacheRoot = path.join(codexHome, "plugins", "cache");
  const relativeRoot = path.relative(cacheRoot, path.resolve(packageRoot));

  if (!relativeRoot.startsWith("..") && !path.isAbsolute(relativeRoot)) {
    const segments = relativeRoot.split(path.sep).filter(Boolean);
    if (segments.length >= 3) {
      return {
        marketplaceName: segments[0],
        pluginName: segments[1],
      };
    }
  }

  return {
    marketplaceName: DEFAULT_INSTALL_METADATA.marketplaceName,
    pluginName: DEFAULT_INSTALL_METADATA.pluginName,
  };
}

export function buildInstallMetadata(codexHome, packageRoot = PACKAGE_ROOT) {
  return {
    ...DEFAULT_INSTALL_METADATA,
    ...resolveInstalledPluginIdentity(codexHome, packageRoot),
  };
}

export function shellQuote(value, platform = process.platform) {
  const text = String(value);
  if (platform === "win32") {
    return `"${text
      .replaceAll("\"", "\"\"")
      .replaceAll("%", "%%")}"`;
  }

  return `'${text.replaceAll("'", `'\"'\"'`)}'`;
}

export function buildNodeCommand(scriptPath, platform = process.platform) {
  const resolved = path.resolve(scriptPath);
  return `node ${shellQuote(resolved, platform)}`;
}

export function buildHookCommands(hooksDir) {
  return {
    sessionStartCommand: buildNodeCommand(
      path.join(hooksDir, "session-start.mjs"),
    ),
    userPromptSubmitCommand: buildNodeCommand(
      path.join(hooksDir, "user-prompt-submit.mjs"),
    ),
    stopCommand: buildNodeCommand(path.join(hooksDir, "stop.mjs")),
  };
}

/**
 * @param {{
 *   templateText?: string,
 *   hooksDir?: string,
 *   commands?: {
 *     sessionStartCommand: string,
 *     userPromptSubmitCommand: string,
 *     stopCommand: string,
 *   },
 * }} [input]
 */
export function renderHooksTemplate({
  templateText = readTextFile(HOOK_TEMPLATE_PATH),
  hooksDir,
  commands,
} = {}) {
  const nextCommands = commands ?? buildHookCommands(hooksDir);
  let rendered = templateText;

  for (const [key, placeholder] of Object.entries(HOOK_TEMPLATE_KEYS)) {
    rendered = rendered.replaceAll(
      placeholder,
      JSON.stringify(nextCommands[key]).slice(1, -1),
    );
  }

  return JSON.parse(rendered);
}

function normalizeHookCommand(command) {
  return String(command).replaceAll("\\", "/");
}

function managedHookCommandFragments(scriptName) {
  return [
    `mem9/hooks/${scriptName}`,
    `mem9/runtime/${scriptName}`,
  ];
}

function isMem9ManagedHook(eventName, hook) {
  if (!isRecord(hook) || typeof hook.command !== "string") {
    return false;
  }

  const expected = MEM9_MANAGED_HOOKS[eventName];
  if (!expected) {
    return false;
  }

  return hook.statusMessage === expected.statusMessage
    && managedHookCommandFragments(expected.scriptName)
      .some((fragment) => normalizeHookCommand(hook.command).includes(fragment));
}

export function removeManagedHooks(existingHooks) {
  const next = isRecord(existingHooks) ? structuredClone(existingHooks) : {};
  next.hooks = isRecord(next.hooks) ? next.hooks : {};

  for (const eventName of MEM9_EVENTS) {
    const groups = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : [];
    next.hooks[eventName] = groups
      .map((group) => {
        if (!isRecord(group) || !Array.isArray(group.hooks)) {
          return group;
        }

        const remainingHooks = group.hooks.filter(
          (hook) => !isMem9ManagedHook(eventName, hook),
        );
        if (remainingHooks.length === 0) {
          return null;
        }

        return {
          ...group,
          hooks: remainingHooks,
        };
      })
      .filter(Boolean);
  }

  return next;
}

export function mergeMem9Hooks(existingHooks, mem9Hooks) {
  const next = removeManagedHooks(existingHooks);
  const managed = isRecord(mem9Hooks) ? structuredClone(mem9Hooks) : {};

  next.hooks = isRecord(next.hooks) ? next.hooks : {};
  const managedHooks = isRecord(managed.hooks) ? managed.hooks : {};

  for (const eventName of MEM9_EVENTS) {
    const foreignGroups = Array.isArray(next.hooks[eventName])
      ? structuredClone(next.hooks[eventName])
      : [];
    const nextManagedGroups = Array.isArray(managedHooks[eventName])
      ? structuredClone(managedHooks[eventName])
      : [];

    next.hooks[eventName] = [...nextManagedGroups, ...foreignGroups];
  }

  return next;
}

export function applyCodexHooksPatch(sourceText = "") {
  const text = String(sourceText ?? "");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text ? text.split(/\r?\n/) : [];
  const normalizedTableHeader = (line) => {
    const normalized = stripTomlLineComment(line).trim();
    return /^\[[^\]]+\]$/.test(normalized) ? normalized : "";
  };

  if (lines.at(-1) === "") {
    lines.pop();
  }

  let sectionStart = -1;
  let sectionEnd = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    if (normalizedTableHeader(lines[index]) === "[features]") {
      sectionStart = index;
      for (let probe = index + 1; probe < lines.length; probe += 1) {
        if (normalizedTableHeader(lines[probe])) {
          sectionEnd = probe;
          break;
        }
      }
      break;
    }
  }

  if (sectionStart === -1) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("[features]", "codex_hooks = true");
    return `${lines.join(eol)}${eol}`;
  }

  const before = lines.slice(0, sectionStart + 1);
  const inside = lines.slice(sectionStart + 1, sectionEnd);
  const after = lines.slice(sectionEnd);
  let seenCodexHooks = false;
  const normalizedInside = [];

  for (const line of inside) {
    if (/^\s*codex_hooks\s*=/.test(line)) {
      if (seenCodexHooks) {
        continue;
      }
      seenCodexHooks = true;
      normalizedInside.push("codex_hooks = true");
      continue;
    }

    normalizedInside.push(line);
  }

  if (!seenCodexHooks) {
    normalizedInside.unshift("codex_hooks = true");
  }

  const rebuilt = [
    ...before,
    ...normalizedInside,
    ...after,
  ];

  return `${rebuilt.join(eol)}${eol}`;
}

export function upsertCredentialsProfile(credentials, profile) {
  const next = isRecord(credentials) ? structuredClone(credentials) : {};
  const profiles = getProfiles(next);
  const current = normalizeProfileRecord(profile.profileId, profiles[profile.profileId]);

  next.schemaVersion = 1;
  next.profiles = {
    ...profiles,
    [profile.profileId]: {
      label: normalizeString(profile.label) || current.label,
      baseUrl: normalizeBaseUrl(profile.baseUrl) || current.baseUrl,
      apiKey: typeof profile.apiKey === "string"
        ? profile.apiKey
        : current.apiKey,
    },
  };

  return next;
}

function buildManualProfileGuidance(profileId, label, baseUrl = DEFAULT_BASE_URL) {
  const nextProfileId = normalizeString(profileId) || "default";
  const nextLabel = normalizeString(label) || nextProfileId;
  const nextBaseUrl = normalizeBaseUrl(baseUrl) || DEFAULT_BASE_URL;

  return [
    "Prefer saving the API key from a trusted shell instead of pasting secrets into Codex.",
    `Export \`MEM9_API_KEY\`, then run \`node ./scripts/setup.mjs profile save-key --profile ${nextProfileId} --label ${nextLabel} --base-url ${nextBaseUrl} --api-key-env MEM9_API_KEY\`.`,
    "You can also edit `$MEM9_HOME/.credentials.json` directly.",
  ].join(" ");
}

async function provisionApiKey({
  baseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8_000,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Global fetch is unavailable, so mem9 profile creation cannot provision an API key.");
  }

  const targetBaseUrl = normalizeBaseUrl(baseUrl) || DEFAULT_BASE_URL;
  let response;

  try {
    response = await fetchImpl(`${targetBaseUrl}/v1alpha1/mem9s`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`mem9 profile creation timed out after ${timeoutMs}ms.`);
    }

    throw new Error(
      `mem9 profile creation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response?.ok) {
    throw new Error(`mem9 profile creation failed with HTTP ${response?.status ?? "unknown"}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(
      `mem9 profile creation returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const apiKey = normalizeString(payload?.id);
  if (!apiKey) {
    throw new Error("mem9 profile creation did not return an API key.");
  }

  return apiKey;
}

export function buildScopeConfig(profileId, options = {}) {
  const existingConfig = isRecord(options.existingConfig) ? options.existingConfig : {};
  const scope = normalizeString(options.scope);
  const currentUpdateCheck = normalizeUpdateCheckConfig(existingConfig.updateCheck);

  return {
    schemaVersion: 1,
    profileId,
    defaultTimeoutMs: normalizeTimeoutMs(
      options.defaultTimeoutMs ?? existingConfig.defaultTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    searchTimeoutMs: normalizeTimeoutMs(
      options.searchTimeoutMs ?? existingConfig.searchTimeoutMs,
      DEFAULT_SEARCH_TIMEOUT_MS,
    ),
    updateCheck: scope === "user"
      ? {
        enabled: options.updateCheck === "enabled"
          ? true
          : options.updateCheck === "disabled"
            ? false
            : currentUpdateCheck.enabled,
        intervalHours: normalizeTimeoutMs(
          options.updateCheckIntervalHours,
          currentUpdateCheck.intervalHours,
        ),
      }
      : undefined,
  };
}

export function installHookShims(sourceDir, targetDir, fsOps = {}) {
  const mkdir = fsOps.mkdirSync ?? mkdirSync;
  const readDir = fsOps.readdirSync ?? readdirSync;
  const copyFile = fsOps.copyFileSync ?? copyFileSync;

  mkdir(targetDir, { recursive: true });

  for (const entry of readDir(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      installHookShims(sourcePath, targetPath, fsOps);
      continue;
    }

    copyFile(sourcePath, targetPath);
  }
}

function resolveCommandContext(args = {}, options = {}) {
  const env = options.env ?? process.env;
  const cwd = path.resolve(
    normalizeString(options.cwd)
      || normalizeString(args.cwd)
      || process.cwd(),
  );
  const codexHome = resolveCodexHome(options.codexHome, env, options.homeDir);
  const mem9Home = resolveMem9Home(options.mem9Home, env, options.homeDir);
  const fsOps = {
    accessSync: options.accessSync,
    constants: options.constants,
    copyFileSync: options.copyFileSync,
    existsSync: options.existsSync,
    mkdirSync: options.mkdirSync,
    readFileSync: options.readFileSync,
    readdirSync: options.readdirSync,
    writeFileSync: options.writeFileSync,
  };
  const globalPaths = resolveGlobalPaths(codexHome);
  const projectRoot = resolveProjectRoot({
    cwd,
    exists: fsOps.existsSync ?? existsSync,
  });
  const legacyProjectHooksPath = projectRoot
    ? path.join(projectRoot, ".codex", "hooks.json")
    : "";

  return {
    args,
    env,
    cwd,
    codexHome,
    mem9Home,
    fsOps,
    globalPaths,
    projectRoot,
    legacyProjectHooksPath,
    pathContext: {
      cwd,
      codexHome,
      mem9Home,
      projectRoot,
    },
  };
}

function emitMachineSummary(summary, context, stdout) {
  stdout?.write?.(`${JSON.stringify(summary)}\n`);
}

function sanitizeScopeResultForOutput(result, context) {
  return {
    status: result.status,
    command: result.command,
    scope: result.scope,
    profileId: result.profileId ?? "",
    action: result.action,
    configSummary: result.configSummary ?? null,
    configPath: result.scope === "project"
      ? sanitizeProjectPath(result.configPath, context)
      : sanitizeDisplayPath(result.configPath, context),
    installPath: sanitizeDisplayPath(result.installPath, context),
    hooksPath: sanitizeDisplayPath(result.hooksPath, context),
    hooksDir: sanitizeDisplayPath(result.hooksDir, context),
    configTomlPath: sanitizeDisplayPath(result.configTomlPath, context),
    legacyProjectHooksPath: normalizeString(result.legacyProjectHooksPath)
      ? sanitizeProjectPath(result.legacyProjectHooksPath, context)
      : "",
    backups: sanitizeBackupsForOutput(result.backups, context),
  };
}

function sanitizeProfileResultForOutput(result, context) {
  return {
    status: result.status,
    command: result.command,
    profileId: result.profileId,
    action: result.action,
    baseUrl: result.baseUrl,
    credentialsPath: sanitizeDisplayPath(result.credentialsPath, context),
    apiKeyEnv: result.apiKeyEnv ?? "",
    backups: sanitizeBackupsForOutput(result.backups, context),
  };
}

function prepareManagedRuntimeRepair(context, noteInvalidJson, options = {}) {
  const fsOps = context.fsOps;
  const existingConfigToml = readTextFileOrDefault(
    context.globalPaths.configTomlPath,
    "",
    fsOps,
  );
  const existingHooks = readJsonFileOrDefault(
    context.globalPaths.hooksPath,
    { hooks: {} },
    fsOps,
    {
      fallbackOnParseError: true,
      onParseError: noteInvalidJson,
    },
  );
  const existingLegacyProjectHooks = context.legacyProjectHooksPath
    ? readJsonFileOrDefault(
      context.legacyProjectHooksPath,
      { hooks: {} },
      fsOps,
      {
        fallbackOnParseError: true,
        onParseError: noteInvalidJson,
      },
    )
    : { hooks: {} };
  readJsonFileOrDefault(
    context.globalPaths.installPath,
    {},
    fsOps,
    {
      fallbackOnParseError: true,
      onParseError: noteInvalidJson,
    },
  );

  return {
    existingConfigToml,
    existingHooks,
    existingLegacyProjectHooks,
    installMetadata: buildInstallMetadata(
      context.codexHome,
      options.packageRoot ?? PACKAGE_ROOT,
    ),
    mem9Hooks: renderHooksTemplate({
      templateText: options.hooksTemplateText
        ?? readTextFile(HOOK_TEMPLATE_PATH),
      hooksDir: context.globalPaths.hooksDir,
    }),
  };
}

function applyManagedRuntimeRepair(context, prepared, options = {}) {
  installHookShims(
    options.hookShimSourceDir ?? HOOK_SHIM_SOURCE_DIR,
    context.globalPaths.hooksDir,
    context.fsOps,
  );
  writeJsonFile(
    context.globalPaths.installPath,
    prepared.installMetadata,
    context.fsOps,
  );
  writeTextFile(
    context.globalPaths.configTomlPath,
    applyCodexHooksPatch(prepared.existingConfigToml),
    context.fsOps,
  );
  writeJsonFile(
    context.globalPaths.hooksPath,
    mergeMem9Hooks(prepared.existingHooks, prepared.mem9Hooks),
    context.fsOps,
  );

  if (
    context.legacyProjectHooksPath
    && (context.fsOps.existsSync ?? existsSync)(context.legacyProjectHooksPath)
  ) {
    writeJsonFile(
      context.legacyProjectHooksPath,
      removeManagedHooks(prepared.existingLegacyProjectHooks),
      context.fsOps,
    );
  }
}

function loadCredentialsForWrite(context, noteInvalidJson) {
  return readJsonFileOrDefault(
    path.join(context.mem9Home, ".credentials.json"),
    {
      schemaVersion: 1,
      profiles: {},
    },
    context.fsOps,
    {
      fallbackOnParseError: true,
      onParseError: noteInvalidJson,
    },
  );
}

function resolveWritableFlags(context, options = {}) {
  const projectConfigPath = context.projectRoot
    ? path.join(context.projectRoot, ".codex", "mem9", "config.json")
    : "";

  return {
    globalWritable: typeof options.userWritable === "boolean"
      ? options.userWritable
      : isWritablePath(context.codexHome, context.fsOps),
    credentialsWritable: typeof options.credentialsWritable === "boolean"
      ? options.credentialsWritable
      : isWritablePath(context.mem9Home, context.fsOps),
    projectWritable: typeof options.projectWritable === "boolean"
      ? options.projectWritable
      : (projectConfigPath ? isWritablePath(projectConfigPath, context.fsOps) : false),
  };
}

function resolveProfileForWrite(args, profiles) {
  const profileId = requireString("--profile", args.profileId);
  const current = normalizeProfileRecord(profileId, profiles[profileId]);

  return {
    profileId,
    label: normalizeString(args.label) || current.label,
    baseUrl: normalizeBaseUrl(args.baseUrl) || current.baseUrl || DEFAULT_BASE_URL,
    current,
    existed: Boolean(profiles[profileId]),
  };
}

export function inspectSetup(argv = process.argv.slice(2), options = {}) {
  const args = Array.isArray(argv) ? parseArgs(argv) : argv;
  const context = resolveCommandContext(args, options);
  const runtimeState = loadRuntimeStateFromDisk({
    cwd: context.cwd,
    codexHome: context.codexHome,
    mem9Home: context.mem9Home,
    env: context.env,
    exists: context.fsOps.existsSync,
    readJson(filePath) {
      return JSON.parse(readTextFile(filePath, context.fsOps.readFileSync ?? readFileSync));
    },
    readText(filePath) {
      return readTextFile(filePath, context.fsOps.readFileSync ?? readFileSync);
    },
    readDirNames(dirPath) {
      return (context.fsOps.readdirSync ?? readdirSync)(dirPath, {
        withFileTypes: true,
      })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    },
  });
  const hooksTomlText = readTextFileOrDefault(
    context.globalPaths.configTomlPath,
    "",
    context.fsOps,
  );
  const hooksJson = inspectJsonFile(
    context.globalPaths.hooksPath,
    { hooks: {} },
    context.fsOps,
  );
  const credentialsPath = path.join(context.mem9Home, ".credentials.json");
  const credentialsInspection = inspectJsonFile(
    credentialsPath,
    {
      schemaVersion: 1,
      profiles: {},
    },
    context.fsOps,
  );
  const profiles = getProfiles(credentialsInspection.value);
  const profileSummaries = summarizeProfiles(profiles);
  const usableProfileIds = profileSummaries
    .filter((profile) => profile.hasApiKey)
    .map((profile) => profile.profileId);
  const globalConfigSummary = summarizeScopeFile(
    context.globalPaths.configPath,
    context.pathContext,
    context.fsOps,
    { includeUpdateCheck: true },
  );
  const projectConfigSummary = context.projectRoot
    ? summarizeScopeFile(
      path.join(context.projectRoot, ".codex", "mem9", "config.json"),
      context.pathContext,
      context.fsOps,
      {
        includeUpdateCheck: false,
        projectRelative: true,
      },
    )
    : {
      state: "not_in_repo",
      exists: false,
      path: "",
      summary: null,
    };
  const installMetadata = inspectInstallMetadata(
    context.globalPaths.installPath,
    context.pathContext,
    context.fsOps,
  );
  const nodeMajor = Number.parseInt(
    String(options.nodeVersion ?? process.versions.node).split(".")[0] ?? "",
    10,
  );

  return {
    status: "ok",
    command: "inspect",
    environment: {
      nodeVersion: String(options.nodeVersion ?? process.versions.node),
      nodeVersionSupported: Number.isFinite(nodeMajor) && nodeMajor >= 22,
    },
    runtime: {
      issueCode: runtimeState.issueCode,
      pluginState: runtimeState.pluginState,
      pluginIssueDetail: runtimeState.pluginIssueDetail,
      scope: runtimeState.scope,
      configSource: runtimeState.configSource,
      projectConfigMatched: runtimeState.projectConfigMatched,
      profileId: runtimeState.runtime.profileId,
      defaultTimeoutMs: runtimeState.runtime.defaultTimeoutMs,
      searchTimeoutMs: runtimeState.runtime.searchTimeoutMs,
      warnings: runtimeState.warnings,
      legacyPausedSources: runtimeState.legacyPausedSources,
      effectiveLegacyPausedSource: runtimeState.effectiveLegacyPausedSource,
    },
    plugin: {
      hooksFeatureEnabled: parseFeaturesCodexHooksEnabled(hooksTomlText),
      hooksInstalled: hooksJson.state === "valid"
        && detectManagedHooksInstalled(hooksJson.value),
      hookShimsInstalled: detectHookShimsInstalled(
        options.hookShimSourceDir ?? HOOK_SHIM_SOURCE_DIR,
        context.globalPaths.hooksDir,
        context.fsOps,
      ),
      installMetadataState: installMetadata.state,
      installMetadataPresent: installMetadata.present,
    },
    globalConfig: globalConfigSummary,
    projectConfig: projectConfigSummary,
    profiles: {
      credentialsState: credentialsInspection.state,
      credentialsPath: sanitizeDisplayPath(credentialsPath, context.pathContext),
      defaultProfileId: buildDefaultProfileId(profiles),
      hasUsableProfiles: usableProfileIds.length > 0,
      usableProfileIds,
      items: profileSummaries,
    },
    paths: {
      configTomlPath: sanitizeDisplayPath(
        context.globalPaths.configTomlPath,
        context.pathContext,
      ),
      hooksPath: sanitizeDisplayPath(
        context.globalPaths.hooksPath,
        context.pathContext,
      ),
      hooksDir: sanitizeDisplayPath(
        context.globalPaths.hooksDir,
        context.pathContext,
      ),
      installPath: sanitizeDisplayPath(
        context.globalPaths.installPath,
        context.pathContext,
      ),
    },
  };
}

async function runProfileCreate(args, options = {}) {
  assertNodeVersion(options.nodeVersion);
  const context = resolveCommandContext(args, options);
  const { credentialsWritable } = resolveWritableFlags(context, options);
  if (!credentialsWritable) {
    throw new Error("Shared mem9 home is not writable.");
  }

  const invalidJsonFiles = new Set();
  const credentialsPath = path.join(context.mem9Home, ".credentials.json");
  const credentials = loadCredentialsForWrite(context, (filePath) => {
    invalidJsonFiles.add(filePath);
  });
  const profiles = getProfiles(credentials);
  const nextProfile = resolveProfileForWrite(args, profiles);
  const apiKey = await provisionApiKey({
    baseUrl: nextProfile.baseUrl,
    fetchImpl: options.fetch,
    timeoutMs: options.provisionTimeoutMs,
  });
  const backups = backupFiles([...invalidJsonFiles], context.fsOps);
  const nextCredentials = upsertCredentialsProfile(credentials, {
    profileId: nextProfile.profileId,
    label: nextProfile.label,
    baseUrl: nextProfile.baseUrl,
    apiKey,
  });

  writeJsonFile(credentialsPath, nextCredentials, context.fsOps);

  const result = {
    status: "ok",
    command: "profile.create",
    action: nextProfile.existed ? "updated" : "created",
    profileId: nextProfile.profileId,
    label: nextProfile.label,
    baseUrl: nextProfile.baseUrl,
    credentialsPath,
    backups,
  };

  emitMachineSummary(
    sanitizeProfileResultForOutput(result, context.pathContext),
    context.pathContext,
    options.stdout,
  );

  return result;
}

async function runProfileSaveKey(args, options = {}) {
  assertNodeVersion(options.nodeVersion);
  const context = resolveCommandContext(args, options);
  const { credentialsWritable } = resolveWritableFlags(context, options);
  if (!credentialsWritable) {
    throw new Error("Shared mem9 home is not writable.");
  }

  const apiKey = normalizeString(context.env[args.apiKeyEnv]);
  const invalidJsonFiles = new Set();
  const credentialsPath = path.join(context.mem9Home, ".credentials.json");
  const credentials = loadCredentialsForWrite(context, (filePath) => {
    invalidJsonFiles.add(filePath);
  });
  const profiles = getProfiles(credentials);
  const nextProfile = resolveProfileForWrite(args, profiles);

  if (!apiKey) {
    throw new Error(
      `Environment variable \`${args.apiKeyEnv}\` is empty. ${buildManualProfileGuidance(nextProfile.profileId, nextProfile.label, nextProfile.baseUrl)}`,
    );
  }

  const backups = backupFiles([...invalidJsonFiles], context.fsOps);
  const nextCredentials = upsertCredentialsProfile(credentials, {
    profileId: nextProfile.profileId,
    label: nextProfile.label,
    baseUrl: nextProfile.baseUrl,
    apiKey,
  });

  writeJsonFile(credentialsPath, nextCredentials, context.fsOps);

  const result = {
    status: "ok",
    command: "profile.save-key",
    action: nextProfile.existed ? "updated" : "created",
    profileId: nextProfile.profileId,
    label: nextProfile.label,
    baseUrl: nextProfile.baseUrl,
    credentialsPath,
    apiKeyEnv: args.apiKeyEnv,
    backups,
  };

  emitMachineSummary(
    sanitizeProfileResultForOutput(result, context.pathContext),
    context.pathContext,
    options.stdout,
  );

  return result;
}

function readValidatedCredentials(context) {
  const credentialsPath = path.join(context.mem9Home, ".credentials.json");
  const inspected = inspectJsonFile(
    credentialsPath,
    {
      schemaVersion: 1,
      profiles: {},
    },
    context.fsOps,
  );

  if (inspected.state === "invalid") {
    throw new Error("Shared mem9 credentials are invalid. Run `$mem9:setup` to repair the saved profiles.");
  }

  return {
    credentialsPath,
    credentials: inspected.value,
  };
}

function resolveConfigWriteFallback(scope, targetConfig, globalConfig) {
  if (scope !== "project") {
    return targetConfig;
  }

  return {
    defaultTimeoutMs: targetConfig?.defaultTimeoutMs ?? globalConfig?.defaultTimeoutMs,
    searchTimeoutMs: targetConfig?.searchTimeoutMs ?? globalConfig?.searchTimeoutMs,
  };
}

async function runScopeApply(args, options = {}) {
  assertNodeVersion(options.nodeVersion);
  const context = resolveCommandContext(args, options);
  const { globalWritable, projectWritable } = resolveWritableFlags(context, options);
  if (!globalWritable) {
    throw new Error("Global Codex home is not writable.");
  }

  if (args.scope === "project" && !context.projectRoot) {
    throw new Error("Current directory is not inside a Git repository. Run `$mem9:setup` from a project before applying project scope.");
  }

  if (args.scope === "project" && !projectWritable) {
    throw new Error("Current project mem9 config path is not writable.");
  }

  const { credentials } = readValidatedCredentials(context);
  const profiles = getProfiles(credentials);
  const currentProfile = normalizeProfileRecord(args.profileId, profiles[args.profileId]);

  if (!profiles[args.profileId]) {
    throw new Error(`Profile "${args.profileId}" was not found. Run \`$mem9:setup\` to create or repair global profiles.`);
  }

  if (!hasApiKey(currentProfile)) {
    throw new Error(`Profile "${args.profileId}" is missing an API key. ${buildManualProfileGuidance(args.profileId, currentProfile.label, currentProfile.baseUrl)}`);
  }

  const invalidJsonFiles = new Set();
  const globalConfig = readJsonFileOrDefault(
    context.globalPaths.configPath,
    {},
    context.fsOps,
    {
      fallbackOnParseError: true,
      onParseError(filePath) {
        invalidJsonFiles.add(filePath);
      },
    },
  );
  const targetConfigPath = args.scope === "project"
    ? path.join(context.projectRoot, ".codex", "mem9", "config.json")
    : context.globalPaths.configPath;
  const targetConfig = readJsonFileOrDefault(
    targetConfigPath,
    {},
    context.fsOps,
    {
      fallbackOnParseError: true,
      onParseError(filePath) {
        invalidJsonFiles.add(filePath);
      },
    },
  );
  const preparedRepair = prepareManagedRuntimeRepair(
    context,
    (filePath) => {
      invalidJsonFiles.add(filePath);
    },
    options,
  );
  const backups = backupFiles([...invalidJsonFiles], context.fsOps);
  const nextConfig = buildScopeConfig(args.profileId, {
    scope: args.scope,
    existingConfig: resolveConfigWriteFallback(args.scope, targetConfig, globalConfig),
    defaultTimeoutMs: args.defaultTimeoutMs,
    searchTimeoutMs: args.searchTimeoutMs,
    updateCheck: args.updateCheck,
    updateCheckIntervalHours: args.updateCheckIntervalHours,
  });

  applyManagedRuntimeRepair(context, preparedRepair, options);
  writeJsonFile(targetConfigPath, nextConfig, context.fsOps);

  const result = {
    status: "ok",
    command: "scope.apply",
    action: "written",
    scope: args.scope,
    profileId: args.profileId,
    configSummary: summarizeScopeConfigState(nextConfig, {
      includeUpdateCheck: args.scope === "user",
    }),
    configPath: targetConfigPath,
    configTomlPath: context.globalPaths.configTomlPath,
    hooksPath: context.globalPaths.hooksPath,
    hooksDir: context.globalPaths.hooksDir,
    installPath: context.globalPaths.installPath,
    legacyProjectHooksPath: context.legacyProjectHooksPath,
    backups,
  };

  emitMachineSummary(
    sanitizeScopeResultForOutput(result, context.pathContext),
    context.pathContext,
    options.stdout,
  );

  return result;
}

async function runScopeClear(args, options = {}) {
  assertNodeVersion(options.nodeVersion);
  const context = resolveCommandContext(args, options);
  const { globalWritable, projectWritable } = resolveWritableFlags(context, options);
  if (!globalWritable) {
    throw new Error("Global Codex home is not writable.");
  }

  if (!context.projectRoot) {
    throw new Error("Current directory is not inside a Git repository. Run `$mem9:setup` from a project before clearing project scope.");
  }

  if (!projectWritable) {
    throw new Error("Current project mem9 config path is not writable.");
  }

  const invalidJsonFiles = new Set();
  const targetConfigPath = path.join(context.projectRoot, ".codex", "mem9", "config.json");
  readJsonFileOrDefault(
    targetConfigPath,
    {},
    context.fsOps,
    {
      fallbackOnParseError: true,
      onParseError(filePath) {
        invalidJsonFiles.add(filePath);
      },
    },
  );
  const existed = (context.fsOps.existsSync ?? existsSync)(targetConfigPath);
  const preparedRepair = prepareManagedRuntimeRepair(
    context,
    (filePath) => {
      invalidJsonFiles.add(filePath);
    },
    options,
  );
  const backups = backupFiles([...invalidJsonFiles], context.fsOps);

  applyManagedRuntimeRepair(context, preparedRepair, options);
  rmSync(targetConfigPath, { force: true });

  const result = {
    status: "ok",
    command: "scope.clear",
    action: existed ? "removed" : "already-clear",
    scope: "project",
    configPath: targetConfigPath,
    configTomlPath: context.globalPaths.configTomlPath,
    hooksPath: context.globalPaths.hooksPath,
    hooksDir: context.globalPaths.hooksDir,
    installPath: context.globalPaths.installPath,
    legacyProjectHooksPath: context.legacyProjectHooksPath,
    backups,
  };

  emitMachineSummary(
    sanitizeScopeResultForOutput(result, context.pathContext),
    context.pathContext,
    options.stdout,
  );

  return result;
}

export async function runSetup(argv = process.argv.slice(2), options = {}) {
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

export async function main(argv = process.argv.slice(2), options = {}) {
  const args = Array.isArray(argv) ? parseArgs(argv) : argv;
  const stdout = options.stdout ?? process.stdout;

  if (args.command === "inspect") {
    const summary = inspectSetup(args, options);
    emitMachineSummary(summary, undefined, stdout);
    return summary;
  }

  return runSetup(args, {
    ...options,
    stdout,
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
