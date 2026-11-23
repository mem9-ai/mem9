// @ts-check

import { createHash } from "node:crypto";

import { isInternalSystemPrompt, stripInjectedContext } from "./format.mjs";

/**
 * @typedef {{
 *   role: "user" | "assistant",
 *   content: string,
 * }} IngestMessage
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} block
 * @returns {string}
 */
function extractBlockText(block) {
  if (typeof block === "string") {
    return block.trim();
  }
  if (!isRecord(block)) {
    return "";
  }
  if (
    (block.type === "text" || block.type === "input_text" || block.type === "output_text")
    && typeof block.text === "string"
  ) {
    return block.text.trim();
  }
  return "";
}

/**
 * @param {unknown} rawContent
 * @returns {string}
 */
function extractRawTextContent(rawContent) {
  if (typeof rawContent === "string") {
    return rawContent;
  }
  if (Array.isArray(rawContent)) {
    return rawContent.map(extractBlockText).filter(Boolean).join("\n\n");
  }
  return "";
}

/**
 * @param {Record<string, unknown>} record
 * @returns {{ role: "user" | "assistant", content: string, isAntigravityUserInput: boolean } | null}
 */
function parseTranscriptRecord(record) {
  const stepType = typeof record.type === "string" ? record.type : "";

  if (stepType === "GENERIC") {
    return null;
  }

  if (stepType === "USER_INPUT") {
    const source = typeof record.source === "string" ? record.source.trim() : "";
    if (source && source !== "USER_EXPLICIT") {
      return null;
    }

    const rawText = extractRawTextContent(record.content);
    if (!rawText || isInternalSystemPrompt(rawText)) {
      return null;
    }

    const cleaned = stripInjectedContext(rawText);
    if (!cleaned || isInternalSystemPrompt(cleaned)) {
      return null;
    }

    return { role: "user", content: cleaned, isAntigravityUserInput: true };
  }

  if (stepType === "PLANNER_RESPONSE") {
    if (typeof record.content !== "string") {
      return null;
    }

    const cleaned = stripInjectedContext(record.content);
    if (!cleaned) {
      return null;
    }

    return { role: "assistant", content: cleaned, isAntigravityUserInput: false };
  }

  /** @type {"user" | "assistant" | ""} */
  let fallbackRole = "";
  let rawContent = record.content;

  if (stepType === "user" || stepType === "assistant") {
    fallbackRole = stepType;
  } else if (record.role === "user" || record.role === "assistant") {
    fallbackRole = record.role;
  } else if (isRecord(record.message)) {
    if (record.message.role === "user" || record.message.role === "assistant") {
      fallbackRole = record.message.role;
      rawContent = record.message.content;
    }
  }

  if (!fallbackRole) {
    return null;
  }

  const rawText = extractRawTextContent(rawContent);
  if (!rawText) {
    return null;
  }

  if (fallbackRole === "user" && isInternalSystemPrompt(rawText)) {
    return null;
  }

  const cleaned = stripInjectedContext(rawText);
  if (!cleaned) {
    return null;
  }

  if (fallbackRole === "user" && isInternalSystemPrompt(cleaned)) {
    return null;
  }

  return { role: fallbackRole, content: cleaned, isAntigravityUserInput: false };
}

/**
 * Parses an Antigravity `transcript.jsonl` string into normalized messages,
 * ignoring `GENERIC` and tool-only steps and deduplicating consecutive duplicates.
 *
 * @param {string} raw
 * @returns {IngestMessage[]}
 */
export function parseTranscriptText(raw) {
  if (typeof raw !== "string" || !raw) {
    return [];
  }

  /** @type {IngestMessage[]} */
  const messages = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (!isRecord(parsed)) {
        continue;
      }

      const message = parseTranscriptRecord(parsed);
      if (!message) {
        continue;
      }

      const previous = messages.at(-1);
      if (
        previous
        && previous.role === message.role
        && previous.content === message.content
      ) {
        continue;
      }

      messages.push({
        role: message.role,
        content: message.content,
      });
    } catch {
      // Ignore malformed JSONL lines so hooks degrade gracefully.
    }
  }

  return messages;
}

/**
 * Returns a stable deduplication key (`step:<stepIndex>:<sha256Prefix>`) for the
 * latest explicit non-internal user message in the transcript, or `""`.
 *
 * @param {string} raw
 * @returns {string}
 */
export function latestUserStepKey(raw) {
  if (typeof raw !== "string" || !raw) {
    return "";
  }

  let latestAntigravityKey = "";
  let latestFallbackKey = "";
  let lineIndex = 0;

  for (const line of raw.split("\n")) {
    const currentLine = lineIndex;
    lineIndex += 1;

    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (!isRecord(parsed)) {
        continue;
      }

      const message = parseTranscriptRecord(parsed);
      if (!message || message.role !== "user") {
        continue;
      }

      const rawStepIndex = parsed.step_index ?? parsed.stepIndex;
      const stepIndex =
        typeof rawStepIndex === "number" && Number.isFinite(rawStepIndex)
          ? String(rawStepIndex)
          : `line-${currentLine}`;
      const digest = createHash("sha256")
        .update(message.content)
        .digest("hex")
        .slice(0, 12);
      const key = `step:${stepIndex}:${digest}`;

      if (message.isAntigravityUserInput) {
        latestAntigravityKey = key;
      } else {
        latestFallbackKey = key;
      }
    } catch {
      // Ignore malformed JSONL lines.
    }
  }

  return latestAntigravityKey || latestFallbackKey;
}

/**
 * Selects a trailing window of up to `maxMessages` within `maxBytes` UTF-8 bytes,
 * returning `[]` unless at least one `"user"` message is included.
 *
 * @param {IngestMessage[]} messages
 * @param {number} [maxMessages]
 * @param {number} [maxBytes]
 * @returns {IngestMessage[]}
 */
export function selectStopWindow(
  messages,
  maxMessages = 20,
  maxBytes = 200_000,
) {
  if (
    !Array.isArray(messages)
    || messages.length === 0
    || !Number.isFinite(maxMessages)
    || maxMessages <= 0
    || !Number.isFinite(maxBytes)
    || maxBytes <= 0
  ) {
    return [];
  }

  /** @type {IngestMessage[]} */
  const selected = [];
  let totalBytes = 0;

  /**
   * @returns {boolean}
   */
  function hasUserMessage() {
    return selected.some((message) => message.role === "user");
  }

  for (
    let index = messages.length - 1;
    index >= 0 && selected.length < maxMessages;
    index -= 1
  ) {
    const message = messages[index];
    const size = Buffer.byteLength(message.content, "utf8");

    if (size > maxBytes) {
      if (selected.length > 0 && hasUserMessage()) {
        break;
      }

      selected.length = 0;
      totalBytes = 0;
      continue;
    }

    if (selected.length > 0 && totalBytes + size > maxBytes) {
      if (hasUserMessage()) {
        break;
      }

      selected.length = 0;
      totalBytes = 0;
    }

    selected.unshift(message);
    totalBytes += size;
  }

  return hasUserMessage() ? selected : [];
}
