// @ts-check

import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * @typedef {Record<string, string | undefined>} EnvMap
 */

/**
 * @typedef {Record<string, unknown>} DebugFields
 */

const SECRET_KEY_RE = /(?:api[-_ ]?key|authorization|token|secret|password|credential)/i;
const SENSITIVE_TEXT_KEY_RE = /^(?:prompt|lastUserInput|content|rawContent|message|messages|transcript|body)$/i;
const EMBEDDED_MEM9_KEY_RE = /\b(?:mk|mem9|mn9)_[A-Za-z0-9_-]{6,}\b/g;
const EMBEDDED_OPENAI_KEY_RE = /\b(sk(?:[_-](?:live|test|proj))?[-_])[A-Za-z0-9._-]{10,}\b/g;
const EMBEDDED_BEARER_RE = /\b(Bearer\s+)[A-Za-z0-9._-]{10,}\b/gi;
const EMBEDDED_QUERY_SECRET_RE = /([?&](?:api[-_]?key|token|key)=)[^&\s]+/gi;
const MAX_ERROR_CHARS = 500;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {string} value
 * @returns {string}
 */
function redactEmbeddedSecrets(value) {
  return value
    .replace(EMBEDDED_MEM9_KEY_RE, "[redacted-key]")
    .replace(EMBEDDED_OPENAI_KEY_RE, "$1***")
    .replace(EMBEDDED_BEARER_RE, "$1***")
    .replace(EMBEDDED_QUERY_SECRET_RE, "$1[redacted]");
}

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
function sanitizeDebugValue(value, key) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    if (SECRET_KEY_RE.test(key)) {
      return value ? "[redacted]" : "";
    }
    if (SENSITIVE_TEXT_KEY_RE.test(key)) {
      return `[omitted:${value.length}]`;
    }
    return redactEmbeddedSecrets(value);
  }

  if (Array.isArray(value)) {
    if (SENSITIVE_TEXT_KEY_RE.test(key)) {
      return `[omitted:${value.length} items]`;
    }
    return value.map((item) => sanitizeDebugValue(item, key));
  }

  if (isRecord(value)) {
    if (SECRET_KEY_RE.test(key)) {
      return "[redacted]";
    }
    /** @type {Record<string, unknown>} */
    const next = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const sanitized = sanitizeDebugValue(childValue, childKey);
      if (sanitized !== undefined) {
        next[childKey] = sanitized;
      }
    }
    return next;
  }

  return redactEmbeddedSecrets(String(value));
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function sanitizeErrorText(error) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const redacted = redactEmbeddedSecrets(raw).trim();
  if (redacted.length <= MAX_ERROR_CHARS) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_ERROR_CHARS)}...`;
}

/**
 * @param {string | undefined} logPath
 * @param {EnvMap | undefined} env
 * @returns {string}
 */
function resolveDebugLogPath(logPath, env) {
  if (typeof logPath === "string" && logPath.trim()) {
    return path.resolve(logPath.trim());
  }

  const envLogFile = typeof env?.MEM9_DEBUG_LOG_FILE === "string"
    ? env.MEM9_DEBUG_LOG_FILE.trim()
    : "";
  if (envLogFile) {
    return path.resolve(envLogFile);
  }

  const envHome = typeof env?.MEM9_HOME === "string" ? env.MEM9_HOME.trim() : "";
  const mem9Home = envHome ? path.resolve(envHome) : path.join(os.homedir(), ".mem9");
  return path.join(mem9Home, "antigravity", "logs", "hooks.jsonl");
}

/**
 * Returns true when `MEM9_DEBUG` is enabled in the environment.
 *
 * @param {EnvMap} [env]
 * @returns {boolean}
 */
export function isDebugEnabled(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env?.MEM9_DEBUG ?? "").trim());
}

/**
 * Appends a sanitized JSONL debug log entry when `MEM9_DEBUG` is enabled.
 *
 * @param {{
 *   logPath?: string,
 *   hook: string,
 *   stage: string,
 *   fields?: DebugFields,
 *   env?: EnvMap,
 *   now?: () => Date,
 * }} input
 * @returns {boolean}
 */
export function appendDebugLog({
  logPath,
  hook,
  stage,
  fields = {},
  env = process.env,
  now = () => new Date(),
}) {
  if (!isDebugEnabled(env)) {
    return false;
  }

  const resolvedPath = resolveDebugLogPath(logPath, env);
  /** @type {Record<string, unknown>} */
  const entry = {
    ts: now().toISOString(),
    hook,
    stage,
  };

  if (isRecord(fields)) {
    for (const [key, value] of Object.entries(fields)) {
      if (key === "ts" || key === "hook" || key === "stage") {
        continue;
      }
      const sanitized = sanitizeDebugValue(value, key);
      if (sanitized !== undefined) {
        entry[key] = sanitized;
      }
    }
  }

  try {
    mkdirSync(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
    appendFileSync(resolvedPath, `${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Appends a sanitized JSONL error debug record when `MEM9_DEBUG` is enabled.
 *
 * @param {{
 *   logPath?: string,
 *   hook: string,
 *   stage: string,
 *   error: unknown,
 *   fields?: DebugFields,
 *   env?: EnvMap,
 *   now?: () => Date,
 * }} input
 * @returns {boolean}
 */
export function appendDebugError({
  logPath,
  hook,
  stage,
  error,
  fields = {},
  env = process.env,
  now = () => new Date(),
}) {
  return appendDebugLog({
    logPath,
    hook,
    stage,
    env,
    now,
    fields: {
      ...(isRecord(fields) ? fields : {}),
      error: sanitizeErrorText(error),
    },
  });
}
