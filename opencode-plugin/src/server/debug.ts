import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DEBUG_SECRET_KEY_RE = /(api[-_ ]?key|authorization|token)/i;
const DEBUG_TEXT_KEY_RE = /(prompt|content|text|output)/i;
const EMBEDDED_MEM9_SECRET_RE = /\bmk_[A-Za-z0-9_-]+\b/g;
const EMBEDDED_OPENAI_SECRET_RE = /\b(sk(?:[_-](?:live|test|proj))?[-_])([A-Za-z0-9][A-Za-z0-9._-]{10,})\b/g;
const EMBEDDED_SLACK_SECRET_RE = /\b(xox[baprs]-)([A-Za-z0-9-]{10,})\b/g;
const EMBEDDED_BEARER_SECRET_RE = /\b(Bearer\s+)([A-Za-z0-9][A-Za-z0-9._-]{15,})\b/gi;
const MAX_DEBUG_TEXT_LENGTH = 160;

export type DebugLogger = (event: string, payload?: Record<string, unknown>) => Promise<void>;

export interface DebugLoggerOptions {
  enabled?: boolean;
  logDir?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function maskSecret(value: string): string {
  if (value.length <= 3) {
    return "***";
  }

  return `${value.slice(0, 3)}***`;
}

function truncateDebugText(value: string): string {
  if (value.length <= MAX_DEBUG_TEXT_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_DEBUG_TEXT_LENGTH)}...`;
}

function redactEmbeddedSecrets(value: string): string {
  return value
    .replace(EMBEDDED_MEM9_SECRET_RE, "mk_***")
    .replace(EMBEDDED_OPENAI_SECRET_RE, (_match, prefix: string) => `${prefix}***`)
    .replace(EMBEDDED_SLACK_SECRET_RE, (_match, prefix: string) => `${prefix}***`)
    .replace(EMBEDDED_BEARER_SECRET_RE, (_match, prefix: string) => `${prefix}***`);
}

function sanitizeDebugValue(value: unknown, key: string): unknown {
  if (typeof value === "string") {
    const redacted = redactEmbeddedSecrets(value);

    if (DEBUG_SECRET_KEY_RE.test(key)) {
      return maskSecret(redacted);
    }

    if (DEBUG_TEXT_KEY_RE.test(key)) {
      return truncateDebugText(redacted);
    }

    return redacted;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDebugValue(item, key));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeDebugValue(childValue, childKey),
      ]),
    );
  }

  return value;
}

export function redactDebugPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return sanitizeDebugValue(payload, "") as Record<string, unknown>;
}

async function writeDebugRecord(
  logDir: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const logFile = path.join(logDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  const record = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    payload: redactDebugPayload(payload),
  });

  await mkdir(logDir, { recursive: true });
  await appendFile(logFile, `${record}\n`, "utf8");
}

export function createDebugLogger(options: DebugLoggerOptions): DebugLogger {
  if (!options.enabled || !options.logDir) {
    return async (): Promise<void> => {};
  }

  const logDir = options.logDir;

  return async (event, payload = {}): Promise<void> => {
    try {
      await writeDebugRecord(logDir, event, payload);
    } catch {
      // Debug logging stays fail-soft.
    }
  };
}
