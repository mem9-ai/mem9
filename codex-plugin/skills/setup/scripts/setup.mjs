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
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { emitKeypressEvents } from "node:readline";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  resolveCodexHome,
  resolveMem9Home,
} from "../../../runtime/shared/config.mjs";
import { resolveProjectRoot } from "../../../runtime/shared/project-root.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const RUNTIME_SOURCE_DIR = path.join(PACKAGE_ROOT, "runtime");
const HOOK_TEMPLATE_PATH = path.join(PACKAGE_ROOT, "templates", "hooks.json");
const DEFAULT_BASE_URL = "https://api.mem9.ai";
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
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }

  return parsed;
}

function readTextFile(filePath, readFile = readFileSync) {
  return readFile(filePath, "utf8");
}

function getProfiles(credentials) {
  return isRecord(credentials?.profiles) ? credentials.profiles : {};
}

function hasProfileUpdates(args) {
  return Boolean(args.label || args.baseUrl || args.apiKey);
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

function sanitizeBackupsForOutput(backups, context) {
  return backups.map((backup) => ({
    sourcePath: sanitizeDisplayPath(backup.sourcePath, context),
    backupPath: sanitizeDisplayPath(backup.backupPath, context),
  }));
}

async function readSecretText(
  input,
  output,
  prompt,
  defaultValue = "",
) {
  if (!input?.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("A TTY is required to enter an API key interactively.");
  }

  emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  output.write(prompt);

  return await new Promise((resolve, reject) => {
    let value = "";

    /**
     * @returns {void}
     */
    function cleanup() {
      input.off("keypress", onKeypress);
      input.setRawMode(Boolean(wasRaw));
      output.write("\n");
    }

    /**
     * @param {string} chunk
     * @param {{name?: string, ctrl?: boolean}} key
     * @returns {void}
     */
    function onKeypress(chunk, key = {}) {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Setup cancelled."));
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(value || defaultValue);
        return;
      }

      if (key.name === "backspace") {
        value = value.slice(0, -1);
        return;
      }

      if (typeof chunk === "string" && chunk >= " " && chunk !== "\u007f") {
        value += chunk;
      }
    }

    input.setRawMode(true);
    input.on("keypress", onKeypress);
    input.resume();
  });
}

async function promptText(prompter, label, options = {}) {
  if (!prompter?.text) {
    if (options.required) {
      throw new Error(`${label} is required. Pass it with CLI args or run setup in a TTY.`);
    }

    return normalizeString(options.defaultValue);
  }

  const value = await prompter.text(label, options);
  const normalized = options.trim === false ? String(value ?? "") : normalizeString(value);

  if (normalized) {
    return normalized;
  }

  if (options.required) {
    throw new Error(`${label} is required.`);
  }

  return normalizeString(options.defaultValue);
}

function createInteractivePrompter({
  input = process.stdin,
  output = process.stderr,
} = {}) {
  if (!input?.isTTY) {
    return null;
  }

  return {
    async text(label, options = {}) {
      const suffix = options.defaultValue
        ? ` [${options.defaultValue}]`
        : "";
      const prompt = `${label}${suffix}: `;
      let answer = "";

      if (options.secret) {
        answer = await readSecretText(
          input,
          output,
          prompt,
          typeof options.defaultValue === "string" ? options.defaultValue : "",
        );
      } else {
        const rl = readline.createInterface({
          input,
          output,
        });

        try {
          answer = await rl.question(prompt);
        } finally {
          rl.close();
        }
      }
      const normalized = options.trim === false
        ? String(answer ?? "")
        : normalizeString(answer);

      if (normalized) {
        return normalized;
      }

      if (options.defaultValue) {
        return options.defaultValue;
      }

      if (options.required) {
        throw new Error(`${label} is required.`);
      }

      return "";
    },
    close() {},
  };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    cwd: "",
    profileId: "",
    label: "",
    baseUrl: "",
    apiKey: "",
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
      case "--label":
        args.label = normalizeString(nextValue);
        index += 1;
        break;
      case "--base-url":
        args.baseUrl = normalizeBaseUrl(nextValue);
        index += 1;
        break;
      case "--api-key":
        args.apiKey = typeof nextValue === "string" ? nextValue : "";
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
      default:
        throw new Error(`Unknown argument: ${token}`);
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
    runtimeDir: path.join(mem9Dir, "runtime"),
    configPath: path.join(mem9Dir, "config.json"),
    hooksPath: path.join(codexHome, "hooks.json"),
    configTomlPath: path.join(codexHome, "config.toml"),
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

export function buildRuntimeCommands(runtimeDir) {
  return {
    sessionStartCommand: buildNodeCommand(
      path.join(runtimeDir, "session-start.mjs"),
    ),
    userPromptSubmitCommand: buildNodeCommand(
      path.join(runtimeDir, "user-prompt-submit.mjs"),
    ),
    stopCommand: buildNodeCommand(path.join(runtimeDir, "stop.mjs")),
  };
}

/**
 * @param {{
 *   templateText?: string,
 *   runtimeDir?: string,
 *   commands?: {
 *     sessionStartCommand: string,
 *     userPromptSubmitCommand: string,
 *     stopCommand: string,
 *   },
 * }} [input]
 */
export function renderHooksTemplate({
  templateText = readTextFile(HOOK_TEMPLATE_PATH),
  runtimeDir,
  commands,
} = {}) {
  const nextCommands = commands ?? buildRuntimeCommands(runtimeDir);
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

function isMem9ManagedHook(eventName, hook) {
  if (!isRecord(hook) || typeof hook.command !== "string") {
    return false;
  }

  const expected = MEM9_MANAGED_HOOKS[eventName];
  if (!expected) {
    return false;
  }

  return hook.statusMessage === expected.statusMessage
    && normalizeHookCommand(hook.command).includes(`mem9/runtime/${expected.scriptName}`);
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

  if (lines.at(-1) === "") {
    lines.pop();
  }

  let sectionStart = -1;
  let sectionEnd = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*\[features\]\s*$/.test(lines[index])) {
      sectionStart = index;
      for (let probe = index + 1; probe < lines.length; probe += 1) {
        if (/^\s*\[[^\]]+\]\s*$/.test(lines[probe])) {
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
  const inside = lines
    .slice(sectionStart + 1, sectionEnd)
    .filter((line) => !/^\s*codex_hooks\s*=/.test(line));
  const trailingBlanks = [];

  while (inside.at(-1) === "") {
    trailingBlanks.unshift(inside.pop());
  }

  const after = lines.slice(sectionEnd);

  const rebuilt = [
    ...before,
    ...inside,
    "codex_hooks = true",
    ...trailingBlanks,
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

export function buildScopeConfig(profileId, options = {}) {
  const current = isRecord(options.existingConfig) ? options.existingConfig : {};

  return {
    ...current,
    schemaVersion: 1,
    profileId,
    defaultTimeoutMs: normalizeTimeoutMs(
      options.defaultTimeoutMs ?? current.defaultTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    searchTimeoutMs: normalizeTimeoutMs(
      options.searchTimeoutMs ?? current.searchTimeoutMs,
      DEFAULT_SEARCH_TIMEOUT_MS,
    ),
  };
}

export function installRuntime(sourceDir, targetDir, fsOps = {}) {
  const mkdir = fsOps.mkdirSync ?? mkdirSync;
  const readDir = fsOps.readdirSync ?? readdirSync;
  const copyFile = fsOps.copyFileSync ?? copyFileSync;

  mkdir(targetDir, { recursive: true });

  for (const entry of readDir(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      installRuntime(sourcePath, targetPath, fsOps);
      continue;
    }

    copyFile(sourcePath, targetPath);
  }
}

export async function resolveProfileSelection({
  args,
  credentials,
  prompter,
}) {
  const profiles = getProfiles(credentials);
  let profileId = normalizeString(args.profileId);

  if (!profileId) {
    profileId = await promptText(prompter, "Profile ID", {
      defaultValue: buildDefaultProfileId(profiles),
      required: true,
    });
  }

  const current = normalizeProfileRecord(profileId, profiles[profileId]);
  if (profiles[profileId] && !hasProfileUpdates(args)) {
    if (!current.apiKey) {
      const apiKey = await promptText(prompter, "API key", {
        required: true,
        secret: true,
        trim: false,
      });

      return {
        profileId,
        profile: {
          ...current,
          apiKey,
        },
        selection: "updated",
      };
    }

    return {
      profileId,
      profile: current,
      selection: "existing",
    };
  }

  const label = normalizeString(args.label)
    || await promptText(prompter, "Profile label", {
      defaultValue: current.label,
      required: true,
    });
  const baseUrl = normalizeBaseUrl(args.baseUrl)
    || normalizeBaseUrl(await promptText(prompter, "Base URL", {
      defaultValue: current.baseUrl,
      required: true,
    }))
    || DEFAULT_BASE_URL;
  const apiKey = args.apiKey
    || current.apiKey
    || await promptText(prompter, "API key", {
      required: true,
      secret: true,
      trim: false,
    });

  if (!apiKey) {
    throw new Error(`API key is required for profile "${profileId}".`);
  }

  return {
    profileId,
    profile: {
      label,
      baseUrl,
      apiKey,
    },
    selection: profiles[profileId] ? "updated" : "created",
  };
}

export async function runSetup(argv = process.argv.slice(2), options = {}) {
  const args = Array.isArray(argv) ? parseArgs(argv) : argv;
  assertNodeVersion(options.nodeVersion);

  const env = options.env ?? process.env;
  const cwd = path.resolve(
    normalizeString(options.cwd)
      || normalizeString(args.cwd)
      || process.cwd(),
  );
  const codexHome = resolveCodexHome(
    options.codexHome,
    env,
    options.homeDir,
  );
  const mem9Home = resolveMem9Home(
    options.mem9Home,
    env,
    options.homeDir,
  );
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
  const globalWritable = typeof options.userWritable === "boolean"
    ? options.userWritable
    : isWritablePath(codexHome, fsOps);
  const credentialsWritable = typeof options.credentialsWritable === "boolean"
    ? options.credentialsWritable
    : isWritablePath(mem9Home, fsOps);
  if (!globalWritable) {
    throw new Error("Global Codex home is not writable.");
  }
  if (!credentialsWritable) {
    throw new Error("Shared mem9 home is not writable.");
  }
  const globalPaths = resolveGlobalPaths(codexHome);
  const projectRoot = resolveProjectRoot({
    cwd,
    exists: fsOps.existsSync ?? existsSync,
  });
  const legacyProjectHooksPath = projectRoot
    ? path.join(projectRoot, ".codex", "hooks.json")
    : "";
  const credentialsPath = path.join(mem9Home, ".credentials.json");
  const invalidJsonFiles = new Set();
  const noteInvalidJson = (filePath) => {
    invalidJsonFiles.add(filePath);
  };
  const credentials = readJsonFileOrDefault(
    credentialsPath,
    {
      schemaVersion: 1,
      profiles: {},
    },
    fsOps,
    {
      fallbackOnParseError: true,
      onParseError: noteInvalidJson,
    },
  );
  const existingConfig = readJsonFileOrDefault(
    globalPaths.configPath,
    {},
    fsOps,
    {
      fallbackOnParseError: true,
      onParseError: noteInvalidJson,
    },
  );
  const hooksTemplateText = options.hooksTemplateText
    ?? readTextFile(HOOK_TEMPLATE_PATH);
  let prompter = options.prompter;
  let needsPromptClose = false;

  if (!prompter && options.interactive !== false) {
    prompter = createInteractivePrompter({
      input: options.stdin,
      output: options.stderr,
    });
    needsPromptClose = Boolean(prompter);
  }

  try {
    const selection = await resolveProfileSelection({
      args,
      credentials,
      prompter,
    });
    const nextCredentials = upsertCredentialsProfile(credentials, {
      profileId: selection.profileId,
      ...selection.profile,
    });
    const nextScopeConfig = buildScopeConfig(selection.profileId, {
      existingConfig,
      defaultTimeoutMs: args.defaultTimeoutMs,
      searchTimeoutMs: args.searchTimeoutMs,
    });
    const existingConfigToml = readTextFileOrDefault(
      globalPaths.configTomlPath,
      "",
      fsOps,
    );
    const existingHooks = readJsonFileOrDefault(
      globalPaths.hooksPath,
      { hooks: {} },
      fsOps,
      {
        fallbackOnParseError: true,
        onParseError: noteInvalidJson,
      },
    );
    const existingLegacyProjectHooks = legacyProjectHooksPath
      ? readJsonFileOrDefault(
        legacyProjectHooksPath,
        { hooks: {} },
        fsOps,
        {
          fallbackOnParseError: true,
          onParseError: noteInvalidJson,
        },
      )
      : { hooks: {} };
    const mem9Hooks = renderHooksTemplate({
      templateText: hooksTemplateText,
      runtimeDir: globalPaths.runtimeDir,
    });
    const backups = backupFiles([...invalidJsonFiles], fsOps);

    installRuntime(
      options.runtimeSourceDir ?? RUNTIME_SOURCE_DIR,
      globalPaths.runtimeDir,
      fsOps,
    );
    writeJsonFile(credentialsPath, nextCredentials, fsOps);
    writeJsonFile(globalPaths.configPath, nextScopeConfig, fsOps);
    writeTextFile(
      globalPaths.configTomlPath,
      applyCodexHooksPatch(existingConfigToml),
      fsOps,
    );
    writeJsonFile(
      globalPaths.hooksPath,
      mergeMem9Hooks(existingHooks, mem9Hooks),
      fsOps,
    );
    if (legacyProjectHooksPath && (fsOps.existsSync ?? existsSync)(legacyProjectHooksPath)) {
      writeJsonFile(
        legacyProjectHooksPath,
        removeManagedHooks(existingLegacyProjectHooks),
        fsOps,
      );
    }

    const summary = {
      status: "ok",
      scope: "global",
      profileId: selection.profileId,
      selection: selection.selection,
      paths: {
        configPath: globalPaths.configPath,
        configTomlPath: globalPaths.configTomlPath,
        hooksPath: globalPaths.hooksPath,
        runtimeDir: globalPaths.runtimeDir,
        credentialsPath,
        legacyProjectHooksPath,
      },
      backups,
    };

    if (options.stdout?.write) {
      options.stdout.write(
        `${JSON.stringify({
          status: summary.status,
          scope: summary.scope,
          profileId: summary.profileId,
          selection: summary.selection,
          backups: sanitizeBackupsForOutput(summary.backups, {
            cwd,
            codexHome,
            mem9Home,
          }),
        })}\n`,
      );
    }

    return summary;
  } finally {
    if (needsPromptClose) {
      prompter?.close?.();
    }
  }
}

export async function main(argv = process.argv.slice(2), options = {}) {
  return runSetup(argv, {
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
