// @ts-check

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_PLUGIN_VERSION = "local";
export const PLUGINS_CACHE_DIR = path.join("plugins", "cache");
export const DEFAULT_INSTALL_METADATA = {
  marketplaceName: "mem9-ai",
  pluginName: "mem9",
};

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {string} text
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
function replacePathToken(text, from, to) {
  if (!from) {
    return text;
  }

  return text.split(from).join(to);
}

/**
 * @param {string} value
 * @param {{
 *   codexHome?: string,
 *   homeDir?: string,
 * }} [context]
 * @returns {string}
 */
function sanitizeDebugText(value, context = {}) {
  let next = String(value);
  const homeDir = normalizeString(context.homeDir) || os.homedir();
  const replacements = [
    [normalizeString(context.codexHome), "$CODEX_HOME"],
    [homeDir, "~"],
  ];

  for (const [from, to] of replacements) {
    next = replacePathToken(next, from, to);
  }

  return next;
}

/**
 * Keeps the installed hook shim self-contained after setup copies it into
 * `$CODEX_HOME/mem9/hooks/shared/bootstrap.mjs`.
 *
 * @param {"SessionStart" | "UserPromptSubmit"} eventName
 * @param {string} text
 * @returns {string}
 */
function hookAdditionalContext(eventName, text) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: text,
    },
  });
}

/**
 * @param {string | undefined} inputCodexHome
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [homeDir]
 * @returns {string}
 */
function resolveCodexHome(inputCodexHome, env = process.env, homeDir = os.homedir()) {
  const configuredHome = normalizeString(inputCodexHome) || normalizeString(env.CODEX_HOME);
  if (configuredHome) {
    return path.resolve(configuredHome);
  }

  return path.resolve(path.join(homeDir, ".codex"));
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
function debugEnabled(env = process.env) {
  return normalizeString(env?.MEM9_DEBUG) === "1";
}

/**
 * @param {{
 *   codexHome: string,
 *   env?: Record<string, string | undefined>,
 *   homeDir?: string,
 * }} input
 * @returns {string}
 */
function resolveDebugLogFile(input) {
  const override = normalizeString(input.env?.MEM9_DEBUG_LOG_FILE);
  if (override) {
    return path.resolve(override);
  }

  return path.join(input.codexHome, "mem9", "logs", "codex-hooks.jsonl");
}

/**
 * @param {string} scriptName
 * @returns {string}
 */
function scriptHookName(scriptName) {
  if (scriptName === "session-start.mjs") {
    return "SessionStart";
  }
  if (scriptName === "user-prompt-submit.mjs") {
    return "UserPromptSubmit";
  }
  if (scriptName === "stop.mjs") {
    return "Stop";
  }

  return scriptName;
}

/**
 * @param {{
 *   scriptName: string,
 *   error: unknown,
 *   codexHome: string,
 *   hookPath?: string,
 *   pluginVersion?: string,
 *   env?: Record<string, string | undefined>,
 *   homeDir?: string,
 * }} input
 * @returns {boolean}
 */
function appendShimDebugError(input) {
  if (!debugEnabled(input.env)) {
    return false;
  }

  const logFile = resolveDebugLogFile({
    codexHome: input.codexHome,
    env: input.env,
    homeDir: input.homeDir,
  });
  const entry = {
    ts: new Date().toISOString(),
    hook: scriptHookName(input.scriptName),
    stage: "hook_failed",
    source: "bootstrap-shim",
    ...(input.pluginVersion ? { pluginVersion: input.pluginVersion } : {}),
    ...(input.hookPath
      ? {
        hookPath: sanitizeDebugText(input.hookPath, {
          codexHome: input.codexHome,
          homeDir: input.homeDir,
        }),
      }
      : {}),
    error: sanitizeDebugText(
      input.error instanceof Error ? input.error.message : String(input.error),
      {
        codexHome: input.codexHome,
        homeDir: input.homeDir,
      },
    ),
  };

  try {
    mkdirSync(path.dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${JSON.stringify(entry)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} filePath
 * @returns {unknown}
 */
function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `mem9 hook shim could not read \`${filePath.endsWith("install.json") ? "$CODEX_HOME/mem9/install.json" : path.basename(filePath)}\`: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Mirrors Codex `validate_plugin_version_segment()`.
 *
 * @param {string} pluginVersion
 * @returns {boolean}
 */
export function isValidPluginVersionSegment(pluginVersion) {
  return pluginVersion.length > 0
    && pluginVersion !== "."
    && pluginVersion !== ".."
    && [...pluginVersion].every((ch) =>
      /[A-Za-z0-9._+-]/.test(ch),
    );
}

/**
 * @param {{
 *   codexHome?: string,
 *   env?: Record<string, string | undefined>,
 *   homeDir?: string,
 * }} [input]
 */
export function readInstallMetadata(input = {}) {
  const codexHome = resolveCodexHome(input.codexHome, input.env, input.homeDir);
  const installPath = path.join(codexHome, "mem9", "install.json");

  if (!existsSync(installPath)) {
    throw new Error("mem9 hook shim could not find `$CODEX_HOME/mem9/install.json`. Run `$mem9:setup` once to reinstall the managed hooks.");
  }

  const raw = readJsonFile(installPath);
  const install = isRecord(raw) ? raw : {};
  const marketplaceName = normalizeString(install.marketplaceName);
  const pluginName = normalizeString(install.pluginName);

  if (!marketplaceName || !pluginName) {
    throw new Error("mem9 hook shim found an invalid install metadata file. Run `$mem9:setup` to repair `$CODEX_HOME/mem9/install.json`.");
  }

  return {
    codexHome,
    installPath,
    marketplaceName,
    pluginName,
  };
}

/**
 * @param {{
 *   codexHome?: string,
 *   env?: Record<string, string | undefined>,
 *   homeDir?: string,
 * }} [input]
 */
function resolveInstallMetadataForShim(input = {}) {
  const codexHome = resolveCodexHome(input.codexHome, input.env, input.homeDir);

  try {
    return {
      ...readInstallMetadata(input),
      repairNeeded: false,
    };
  } catch {
    return {
      codexHome,
      installPath: path.join(codexHome, "mem9", "install.json"),
      marketplaceName: DEFAULT_INSTALL_METADATA.marketplaceName,
      pluginName: DEFAULT_INSTALL_METADATA.pluginName,
      repairNeeded: true,
    };
  }
}

function buildPluginMissingSessionStartOutput() {
  return hookAdditionalContext(
    "SessionStart",
    "mem9 hooks remain installed, but the mem9 hook runtime needs repair. If `mem9` is missing from `/plugins`, reinstall the plugin first. Then run `$mem9:cleanup`, followed by `$mem9:setup`.",
  );
}

/**
 * @param {string} scriptName
 * @returns {string | undefined}
 */
function handleMissingPluginHook(scriptName) {
  if (scriptName === "session-start.mjs") {
    const output = buildPluginMissingSessionStartOutput();
    if (output) {
      process.stdout.write(output);
    }
    return output;
  }

  return undefined;
}

/**
 * Mirrors Codex `PluginStore::active_plugin_version()`.
 *
 * @param {{
 *   codexHome: string,
 *   marketplaceName: string,
 *   pluginName: string,
 * }} input
 * @returns {string}
 */
export function resolveActivePluginVersion(input) {
  const baseDir = path.join(
    input.codexHome,
    PLUGINS_CACHE_DIR,
    input.marketplaceName,
    input.pluginName,
  );

  let discoveredVersions;
  try {
    discoveredVersions = readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter(isValidPluginVersionSegment);
  } catch {
    return "";
  }

  discoveredVersions.sort();
  if (discoveredVersions.length === 0) {
    return "";
  }
  if (discoveredVersions.includes(DEFAULT_PLUGIN_VERSION)) {
    return DEFAULT_PLUGIN_VERSION;
  }

  return discoveredVersions.at(-1) ?? "";
}

/**
 * @param {{
 *   codexHome: string,
 *   marketplaceName: string,
 *   pluginName: string,
 * }} input
 * @returns {{ pluginVersion: string, pluginRoot: string }}
 */
export function resolveActivePluginRoot(input) {
  const pluginVersion = resolveActivePluginVersion(input);
  if (!pluginVersion) {
    return {
      pluginVersion: "",
      pluginRoot: "",
    };
  }

  return {
    pluginVersion,
    pluginRoot: path.join(
      input.codexHome,
      PLUGINS_CACHE_DIR,
      input.marketplaceName,
      input.pluginName,
      pluginVersion,
    ),
  };
}

/**
 * @param {string} scriptName
 * @param {{
 *   codexHome?: string,
 *   env?: Record<string, string | undefined>,
 *   homeDir?: string,
 * }} [input]
 */
export async function runHookShim(scriptName, input = {}) {
  const install = resolveInstallMetadataForShim(input);

  if (install.repairNeeded) {
    return handleMissingPluginHook(scriptName);
  }

  const { pluginVersion, pluginRoot } = resolveActivePluginRoot(install);

  if (!pluginVersion || !pluginRoot) {
    return handleMissingPluginHook(scriptName);
  }

  const hookPath = path.join(pluginRoot, "hooks", scriptName);
  if (!existsSync(hookPath)) {
    return handleMissingPluginHook(scriptName);
  }

  try {
    process.env.MEM9_CODEX_PLUGIN_VERSION = pluginVersion;

    const module = await import(pathToFileURL(hookPath).href);
    if (typeof module.main !== "function") {
      throw new Error(`mem9 hook shim expected \`${scriptName}\` to export \`main()\`.`);
    }

    const output = await module.main();
    if (typeof output === "string" && output) {
      process.stdout.write(output);
    }

    return output;
  } catch (error) {
    appendShimDebugError({
      scriptName,
      error,
      codexHome: install.codexHome,
      hookPath,
      pluginVersion,
      env: input.env,
      homeDir: input.homeDir,
    });
    throw error;
  }
}
