// @ts-check

import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveCodexHome } from "../../lib/config.mjs";

/**
 * @typedef {Record<string, string | number | boolean | null | undefined>} DebugFields
 */

/**
 * @typedef {Record<string, string | undefined>} EnvMap
 */

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
 *   cwd?: string,
 *   codexHome?: string,
 *   mem9Home?: string,
 *   homeDir?: string,
 * }} [context]
 * @returns {string}
 */
function sanitizeDebugText(value, context = {}) {
  let next = String(value);
  const homeDir = normalizeString(context.homeDir) || os.homedir();
  const replacements = [
    [normalizeString(context.mem9Home), "$MEM9_HOME"],
    [normalizeString(context.codexHome), "$CODEX_HOME"],
    [normalizeString(context.cwd), "$PROJECT_ROOT"],
    [homeDir, "~"],
  ];

  for (const [from, to] of replacements) {
    next = replacePathToken(next, from, to);
  }

  return next;
}

/**
 * @param {EnvMap | undefined} env
 * @returns {boolean}
 */
export function debugEnabled(env = process.env) {
  return normalizeString(env?.MEM9_DEBUG) === "1";
}

/**
 * @param {{
 *   codexHome?: string,
 *   env?: EnvMap,
 *   homeDir?: string,
 * }} [input]
 * @returns {string}
 */
export function resolveDebugLogFile(input = {}) {
  const override = normalizeString(input.env?.MEM9_DEBUG_LOG_FILE);
  if (override) {
    return path.resolve(override);
  }

  const codexHome = resolveCodexHome(
    input.codexHome,
    input.env,
    input.homeDir,
  );
  return path.join(codexHome, "mem9", "logs", "codex-hooks.jsonl");
}

/**
 * @param {{
 *   hook: string,
 *   stage: string,
 *   fields?: DebugFields,
 *   cwd?: string,
 *   codexHome?: string,
 *   mem9Home?: string,
 *   homeDir?: string,
 *   env?: EnvMap,
 *   appendFile?: typeof appendFileSync,
 *   mkdir?: typeof mkdirSync,
 *   now?: () => Date,
 * }} input
 * @returns {boolean}
 */
export function appendDebugLog(input) {
  if (!debugEnabled(input.env)) {
    return false;
  }

  const logFile = resolveDebugLogFile({
    codexHome: input.codexHome,
    env: input.env,
    homeDir: input.homeDir,
  });
  const mkdir = input.mkdir ?? mkdirSync;
  const appendFile = input.appendFile ?? appendFileSync;
  const now = input.now ?? (() => new Date());

  /** @type {Record<string, string | number | boolean | null>} */
  const entry = {
    ts: now().toISOString(),
    hook: input.hook,
    stage: input.stage,
  };

  for (const [key, value] of Object.entries(input.fields ?? {})) {
    if (value == null) {
      entry[key] = null;
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      entry[key] = value;
      continue;
    }

    entry[key] = sanitizeDebugText(value, {
      cwd: input.cwd,
      codexHome: input.codexHome,
      mem9Home: input.mem9Home,
      homeDir: input.homeDir,
    });
  }

  try {
    mkdir(path.dirname(logFile), { recursive: true });
    appendFile(logFile, `${JSON.stringify(entry)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   hook: string,
 *   stage: string,
 *   error: unknown,
 *   fields?: DebugFields,
 *   cwd?: string,
 *   codexHome?: string,
 *   mem9Home?: string,
 *   homeDir?: string,
 *   env?: EnvMap,
 *   appendFile?: typeof appendFileSync,
 *   mkdir?: typeof mkdirSync,
 *   now?: () => Date,
 * }} input
 * @returns {boolean}
 */
export function appendDebugError(input) {
  return appendDebugLog({
    ...input,
    fields: {
      ...(input.fields ?? {}),
      error: input.error instanceof Error ? input.error.message : String(input.error),
    },
  });
}
