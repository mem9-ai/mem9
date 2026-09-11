#!/usr/bin/env node
// @ts-check

import path from "node:path";
import os from "node:os";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mirrors claude-plugin/hooks/lib/transcript-parser.mjs so injected recall
// context is never re-ingested.
const INJECTED_BLOCK_TAGS = [
  ["<relevant-memories>", "</relevant-memories>"],
  ["<mem9-status-warning>", "</mem9-status-warning>"],
  ["<memory-context>", "</memory-context>"],
];

// Kimi wraps hook stdout as <hook_result hook_event="...">...</hook_result>;
// the opening tag carries attributes, so it needs prefix-based stripping.
const HOOK_RESULT_OPEN = "<hook_result";
const HOOK_RESULT_CLOSE = "</hook_result>";

const BLOB_REF_PREFIX = "blobref:";

const DEFAULT_MAX_MESSAGES = 8;
const DEFAULT_MAX_BYTES = 20000;

/**
 * @typedef {{
 *   role: "user" | "assistant",
 *   content: string
 * }} IngestMessage
 */

/**
 * @typedef {{
 *   maxMessages: number,
 *   maxBytes: number,
 *   mode: "stop" | "precompact" | "sessionend"
 * }} ParseOptions
 */

/**
 * @param {string} text
 * @returns {string}
 */
function stripHookResultBlocks(text) {
  let result = text;
  for (;;) {
    const start = result.indexOf(HOOK_RESULT_OPEN);
    if (start === -1) {
      break;
    }
    const openEnd = result.indexOf(">", start);
    if (openEnd === -1) {
      result = result.slice(0, start);
      break;
    }
    const close = result.indexOf(HOOK_RESULT_CLOSE, openEnd);
    if (close === -1) {
      result = result.slice(0, start);
      break;
    }
    result = result.slice(0, start) + result.slice(close + HOOK_RESULT_CLOSE.length);
  }
  return result;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripInjectedMemories(text) {
  let result = text;
  for (const [startTag, endTag] of INJECTED_BLOCK_TAGS) {
    while (result.includes(startTag)) {
      const start = result.indexOf(startTag);
      const end = result.indexOf(endTag, start);
      if (end === -1) {
        result = result.slice(0, start);
        break;
      }
      result = result.slice(0, start) + result.slice(end + endTag.length);
    }
  }
  return stripHookResultBlocks(result).trim();
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isBlobRef(text) {
  return text.trimStart().startsWith(BLOB_REF_PREFIX);
}

/**
 * Reads the protocol_version declared by the first line of a wire.jsonl
 * transcript. Returns null when the line is missing, unparseable, or does
 * not declare a version (fail-open: unknown is treated as supported).
 *
 * @param {string} raw
 * @returns {string | null}
 */
export function extractProtocolVersion(raw) {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const record = /** @type {Record<string, unknown>} */ (JSON.parse(trimmed));
      const direct = record.protocol_version ?? record.protocolVersion;
      if (typeof direct === "string") {
        return direct;
      }
      const metadata = record.metadata;
      if (metadata && typeof metadata === "object") {
        const nested = /** @type {Record<string, unknown>} */ (metadata);
        const value = nested.protocol_version ?? nested.protocolVersion;
        if (typeof value === "string") {
          return value;
        }
      }
    } catch {
      // Ignore malformed lines. Hooks should degrade gracefully.
    }
    return null;
  }
  return null;
}

/**
 * @param {string | null} version
 * @returns {boolean}
 */
export function isProtocolSupported(version) {
  if (version === null) {
    return true;
  }
  const major = Number(version.split(".")[0]);
  return Number.isFinite(major) && major === 1;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Concatenates the text parts of a user message content array.
 *
 * @param {unknown} content
 * @returns {string}
 */
function userMessageText(content) {
  /** @type {string[]} */
  const parts = [];

  if (typeof content === "string") {
    parts.push(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }
      if (part.type !== "text" || typeof part.text !== "string") {
        continue;
      }
      if (isBlobRef(part.text)) {
        continue;
      }
      parts.push(part.text);
    }
  }

  return stripInjectedMemories(parts.join("\n\n"));
}

/**
 * Extracts the text of a single streamed assistant content part.
 *
 * @param {unknown} part
 * @returns {string}
 */
function assistantPartText(part) {
  if (!isRecord(part)) {
    return "";
  }
  if (part.type !== "text" || typeof part.text !== "string") {
    return "";
  }
  if (isBlobRef(part.text)) {
    return "";
  }
  return part.text;
}

/**
 * Parses wire.jsonl content into an interleaved user/assistant message
 * stream, in file order. Assistant turns are grouped by event.turnId: the
 * turn's message is anchored at the file position of its first text part
 * and later parts are appended to it.
 *
 * Does not check the protocol version; callers should gate on
 * extractProtocolVersion/isProtocolSupported first.
 *
 * @param {string} raw
 * @returns {IngestMessage[]}
 */
export function parseWireMessages(raw) {
  /** @type {IngestMessage[]} */
  const messages = [];
  /** @type {Map<string, number>} turnId -> index into messages */
  const assistantTurns = new Map();
  let syntheticTurn = 0;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    /** @type {Record<string, unknown>} */
    let record;
    try {
      record = /** @type {Record<string, unknown>} */ (JSON.parse(trimmed));
    } catch {
      // Ignore malformed lines. Hooks should degrade gracefully.
      continue;
    }

    if (!isRecord(record)) {
      continue;
    }

    if (record.type === "context.append_message") {
      const message = record.message;
      if (!isRecord(message)) {
        continue;
      }
      const origin = message.origin;
      const kind = isRecord(origin) ? origin.kind : undefined;
      if (kind !== "user") {
        continue;
      }
      const content = userMessageText(message.content);
      if (content) {
        messages.push({ role: "user", content });
      }
      continue;
    }

    if (record.type === "context.append_loop_event") {
      const event = record.event;
      if (!isRecord(event) || event.type !== "content.part") {
        continue;
      }
      const text = assistantPartText(event.part);
      if (!text) {
        continue;
      }
      const turnId =
        typeof event.turnId === "string" && event.turnId
          ? event.turnId
          : `__synthetic_${syntheticTurn++}`;
      const existing = assistantTurns.get(turnId);
      if (existing !== undefined) {
        const current = messages[existing];
        current.content = current.content
          ? `${current.content}\n\n${text}`
          : text;
      } else {
        assistantTurns.set(turnId, messages.length);
        messages.push({ role: "assistant", content: text });
      }
      continue;
    }
  }

  for (const message of messages) {
    if (message.role === "assistant") {
      message.content = stripInjectedMemories(message.content);
    }
  }

  return messages.filter((message) => message.content !== "");
}

/**
 * @param {IngestMessage[]} messages
 * @returns {IngestMessage[]}
 */
function selectLastTurn(messages) {
  if (messages.length === 0) {
    return [];
  }

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  if (lastUserIndex === -1) {
    return messages.slice(-1);
  }

  return messages.slice(lastUserIndex);
}

/**
 * @param {IngestMessage[]} messages
 * @param {number} maxMessages
 * @returns {IngestMessage[]}
 */
function applyMessageCap(messages, maxMessages) {
  if (!Number.isFinite(maxMessages) || maxMessages <= 0) {
    return messages;
  }
  return messages.slice(-maxMessages);
}

/**
 * @param {string} text
 * @returns {number}
 */
function utf8Size(text) {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateUtf8(text, maxBytes) {
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength <= maxBytes) {
    return text;
  }
  // Back off to a code-point boundary so decoding never emits U+FFFD
  // (which would both corrupt the text and exceed the byte cap).
  let end = maxBytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(encoded.subarray(0, end));
}

/**
 * @param {IngestMessage[]} messages
 * @param {number} maxBytes
 * @returns {IngestMessage[]}
 */
function applyByteBudget(messages, maxBytes) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return messages;
  }

  let totalBytes = 0;
  /** @type {IngestMessage[]} */
  const selected = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const size = utf8Size(message.content);

    if (totalBytes + size <= maxBytes) {
      selected.unshift(message);
      totalBytes += size;
      continue;
    }

    // Oversized message: the payload cap is hard — truncate instead of
    // exceeding it — and keep a user message in the window whenever the
    // candidates contain one.
    if (selected.length === 0) {
      const earlierUser = messages
        .slice(0, index)
        .some((item) => item.role === "user");
      const limit =
        message.role === "user" || !earlierUser
          ? maxBytes
          : Math.max(Math.floor(maxBytes / 2), 1);
      const truncated = { ...message, content: truncateUtf8(message.content, limit) };
      selected.unshift(truncated);
      totalBytes += utf8Size(truncated.content);
      continue;
    }

    const hasUser = selected.some((item) => item.role === "user");
    if (message.role === "user" && !hasUser) {
      const remaining = maxBytes - totalBytes;
      if (remaining > 0) {
        selected.unshift({ ...message, content: truncateUtf8(message.content, remaining) });
      } else {
        selected.length = 0;
        const truncated = { ...message, content: truncateUtf8(message.content, maxBytes) };
        selected.unshift(truncated);
        totalBytes = utf8Size(truncated.content);
      }
    }
    break;
  }

  return selected;
}

/**
 * @param {IngestMessage[]} messages
 * @param {ParseOptions} options
 * @returns {IngestMessage[]}
 */
export function selectWindow(messages, options) {
  let selected;
  switch (options.mode) {
    case "stop":
    case "sessionend":
      selected = selectLastTurn(messages);
      break;
    case "precompact":
    default:
      selected = messages;
      break;
  }

  return applyByteBudget(
    applyMessageCap(selected, options.maxMessages),
    options.maxBytes,
  );
}

/**
 * @param {string | URL} filePathOrUrl
 * @param {ParseOptions} options
 * @returns {IngestMessage[]}
 */
export function parseWireFile(filePathOrUrl, options) {
  const raw = readFileSync(filePathOrUrl, "utf8");
  const version = extractProtocolVersion(raw);
  if (!isProtocolSupported(version)) {
    process.stderr.write(
      `wire-parser: unsupported protocol_version "${version}" in ${String(filePathOrUrl)}\n`,
    );
    return [];
  }
  return selectWindow(parseWireMessages(raw), options);
}

/**
 * Locates the wire.jsonl transcript for a session. Prefers the most recent
 * session_index.jsonl entry whose sessionId matches; falls back to scanning
 * ${KIMI_CODE_HOME}/sessions/STAR/SESSION_ID/agents/main/wire.jsonl.
 *
 * @param {string} sessionId
 * @param {string} kimiHome
 * @returns {string | null}
 */
export function findWireTranscript(sessionId, kimiHome) {
  if (!sessionId) {
    return null;
  }

  const indexPath = path.join(kimiHome, "session_index.jsonl");
  if (existsSync(indexPath)) {
    try {
      const lines = readFileSync(indexPath, "utf8").split("\n");
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const trimmed = lines[index].trim();
        if (!trimmed) {
          continue;
        }
        try {
          const entry = /** @type {Record<string, unknown>} */ (JSON.parse(trimmed));
          if (entry.sessionId !== sessionId || typeof entry.sessionDir !== "string") {
            continue;
          }
          const sessionDir = path.isAbsolute(entry.sessionDir)
            ? entry.sessionDir
            : path.join(kimiHome, entry.sessionDir);
          const candidate = path.join(sessionDir, "agents", "main", "wire.jsonl");
          if (existsSync(candidate)) {
            return candidate;
          }
        } catch {
          // Ignore malformed index lines.
        }
      }
    } catch {
      // Fall through to the directory scan.
    }
  }

  const sessionsRoot = path.join(kimiHome, "sessions");
  try {
    for (const entry of readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = path.join(
        sessionsRoot,
        entry.name,
        sessionId,
        "agents",
        "main",
        "wire.jsonl",
      );
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    // No sessions directory; nothing more to try.
  }

  return null;
}

/**
 * @returns {string}
 */
function defaultKimiHome() {
  return process.env.KIMI_CODE_HOME || path.join(os.homedir(), ".kimi-code");
}

/**
 * @param {string[]} argv
 * @returns {{sessionId: string, cwd: string, maxMessages: number, maxBytes: number, mode: ParseOptions["mode"]}}
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const flags = {};

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1] ?? "";
    if (key.startsWith("--")) {
      flags[key.slice(2)] = value;
    }
  }

  const mode =
    flags.mode === "stop" ||
    flags.mode === "precompact" ||
    flags.mode === "sessionend"
      ? flags.mode
      : "stop";

  return {
    sessionId: flags["session-id"] ?? "",
    cwd: flags.cwd ?? "",
    maxMessages: Number(flags["max-messages"] ?? String(DEFAULT_MAX_MESSAGES)),
    maxBytes: Number(flags["max-bytes"] ?? String(DEFAULT_MAX_BYTES)),
    mode,
  };
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
function main(argv) {
  const args = parseArgs(argv);
  if (!args.sessionId) {
    process.stderr.write(
      "usage: wire-parser.mjs --session-id <id> --cwd <dir> --mode <stop|precompact|sessionend> --max-messages <n> --max-bytes <n>\n",
    );
    process.stdout.write(JSON.stringify({ messages: [] }) + "\n");
    return 0;
  }

  try {
    const transcriptPath = findWireTranscript(args.sessionId, defaultKimiHome());
    if (!transcriptPath) {
      process.stderr.write(
        `wire-parser: no transcript found for session ${args.sessionId}\n`,
      );
      process.stdout.write(JSON.stringify({ messages: [] }) + "\n");
      return 0;
    }

    const messages = parseWireFile(transcriptPath, {
      maxMessages: args.maxMessages,
      maxBytes: args.maxBytes,
      mode: args.mode,
    });

    process.stdout.write(JSON.stringify({ messages }) + "\n");
    return 0;
  } catch (error) {
    process.stderr.write(
      `wire-parser: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.stdout.write(JSON.stringify({ messages: [] }) + "\n");
    return 0;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
