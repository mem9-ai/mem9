#!/usr/bin/env node
// @ts-check

import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const START_TAG = "<relevant-memories>";
const END_TAG = "</relevant-memories>";

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
export function stripInjectedMemories(text) {
  let result = text;
  while (result.includes(START_TAG)) {
    const start = result.indexOf(START_TAG);
    const end = result.indexOf(END_TAG, start);
    if (end === -1) {
      result = result.slice(0, start);
      break;
    }
    result = result.slice(0, start) + result.slice(end + END_TAG.length);
  }
  return result.trim();
}

/**
 * @param {unknown} block
 * @returns {string}
 */
function blockText(block) {
  if (typeof block === "string") {
    return block.trim();
  }

  if (block && typeof block === "object") {
    const typedBlock = /** @type {{type?: unknown, text?: unknown}} */ (block);
    if (typedBlock.type === "text" && typeof typedBlock.text === "string") {
      return typedBlock.text.trim();
    }
  }

  return "";
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {"user" | "assistant" | ""}
 */
function entryRole(entry) {
  const directType = entry.type;
  if (directType === "user" || directType === "assistant") {
    return directType;
  }

  const directRole = entry.role;
  if (directRole === "user" || directRole === "assistant") {
    return directRole;
  }

  const message = entry.message;
  if (message && typeof message === "object") {
    const messageRole = /** @type {{role?: unknown}} */ (message).role;
    if (messageRole === "user" || messageRole === "assistant") {
      return messageRole;
    }
  }

  return "";
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {string}
 */
function entryContent(entry) {
  const message = entry.message;
  const rawContent =
    message && typeof message === "object"
      ? /** @type {{content?: unknown}} */ (message).content
      : entry.content;

  /** @type {string[]} */
  const parts = [];

  if (typeof rawContent === "string") {
    parts.push(rawContent.trim());
  } else if (Array.isArray(rawContent)) {
    for (const block of rawContent) {
      const text = blockText(block);
      if (text) {
        parts.push(text);
      }
    }
  }

  return stripInjectedMemories(parts.join("\n\n"));
}

const ASSISTANT_NOISE_PREFIXES = [
  "<local-command-caveat>",
  "<local-command-stdout>",
  "<command-name>",
  "<command-message>",
  "<task-notification>",
  "<system-reminder>",
];

/**
 * @param {"user" | "assistant"} role
 * @param {string} content
 * @returns {boolean}
 */
function isSystemNoise(role, content) {
  if (role !== "assistant") {
    return false;
  }

  const trimmed = content.trimStart();
  return ASSISTANT_NOISE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/**
 * @param {unknown} entry
 * @returns {IngestMessage | null}
 */
function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = /** @type {Record<string, unknown>} */ (entry);
  if (record.isSidechain === true || record.is_sidechain === true) {
    return null;
  }
  if (record.isMeta === true) {
    return null;
  }

  const role = entryRole(record);
  if (!role) {
    return null;
  }

  const content = entryContent(record);
  if (!content || isSystemNoise(role, content)) {
    return null;
  }

  return { role, content };
}

/**
 * @param {string} raw
 * @returns {IngestMessage[]}
 */
export function parseTranscriptText(raw) {
  /** @type {IngestMessage[]} */
  const messages = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const normalized = normalizeEntry(JSON.parse(trimmed));
      if (normalized) {
        messages.push(normalized);
      }
    } catch {
      // Ignore malformed lines. Hooks should degrade gracefully.
    }
  }

  return messages;
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
    const size = new TextEncoder().encode(message.content).byteLength;

    if (selected.length > 0 && totalBytes + size > maxBytes) {
      break;
    }

    selected.unshift(message);
    totalBytes += size;
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
export function parseTranscriptFile(filePathOrUrl, options) {
  const raw = readFileSync(filePathOrUrl, "utf8");
  return selectWindow(parseTranscriptText(raw), options);
}

/**
 * @param {string[]} argv
 * @returns {{transcriptPath: string, maxMessages: number, maxBytes: number, mode: ParseOptions["mode"]}}
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
    transcriptPath: flags["transcript-path"] ?? "",
    maxMessages: Number(flags["max-messages"] ?? "8"),
    maxBytes: Number(flags["max-bytes"] ?? "20000"),
    mode,
  };
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
function main(argv) {
  const args = parseArgs(argv);
  if (!args.transcriptPath) {
    process.stderr.write(
      "usage: transcript-parser.mjs --transcript-path <path> --mode <stop|precompact|sessionend> --max-messages <n> --max-bytes <n>\n",
    );
    return 1;
  }

  const messages = parseTranscriptFile(args.transcriptPath, {
    maxMessages: args.maxMessages,
    maxBytes: args.maxBytes,
    mode: args.mode,
  });

  process.stdout.write(JSON.stringify({ messages }));
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
