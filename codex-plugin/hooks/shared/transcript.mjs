// @ts-check

import { stripInjectedMemories } from "./format.mjs";

/**
 * @typedef {{
 *   role: "user" | "assistant",
 *   content: string,
 * }} IngestMessage
 */

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
    if (
      (typedBlock.type === "input_text"
        || typedBlock.type === "output_text"
        || typedBlock.type === "text")
      && typeof typedBlock.text === "string"
    ) {
      return typedBlock.text.trim();
    }
  }

  return "";
}

/**
 * @param {"user" | "assistant"} role
 * @param {string} content
 * @returns {IngestMessage | null}
 */
function normalizeVisibleMessage(role, content) {
  const cleaned = stripInjectedMemories(content).trim();

  if (!cleaned) {
    return null;
  }

  return {
    role,
    content: cleaned,
  };
}

/**
 * @param {unknown} lineValue
 * @returns {IngestMessage | null}
 */
function extractEventMessage(lineValue) {
  if (!lineValue || typeof lineValue !== "object") {
    return null;
  }

  const root = /** @type {{item?: unknown, type?: unknown, payload?: unknown}} */ (lineValue);
  const candidate = root.item && typeof root.item === "object" ? root.item : lineValue;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const wrapped = /** @type {{type?: unknown, payload?: unknown}} */ (candidate);
  if (wrapped.type !== "event_msg" || !wrapped.payload || typeof wrapped.payload !== "object") {
    return null;
  }

  const payload = /** @type {{type?: unknown, message?: unknown}} */ (wrapped.payload);
  if (payload.type === "user_message" && typeof payload.message === "string") {
    return normalizeVisibleMessage("user", payload.message);
  }
  if (payload.type === "agent_message" && typeof payload.message === "string") {
    return normalizeVisibleMessage("assistant", payload.message);
  }

  return null;
}

/**
 * @param {unknown} lineValue
 * @returns {unknown[]}
 */
function extractResponseCandidates(lineValue) {
  if (!lineValue || typeof lineValue !== "object") {
    return [];
  }

  const root = /** @type {{item?: unknown, type?: unknown, payload?: unknown}} */ (lineValue);
  const candidate = root.item && typeof root.item === "object" ? root.item : lineValue;
  if (!candidate || typeof candidate !== "object") {
    return [];
  }

  const wrapped = /** @type {{type?: unknown, payload?: unknown}} */ (candidate);
  if (wrapped.type === "response_item") {
    if (Array.isArray(wrapped.payload)) {
      return wrapped.payload;
    }
    if (wrapped.payload && typeof wrapped.payload === "object") {
      return [wrapped.payload];
    }
  }

  return [candidate];
}

/**
 * @param {unknown} candidate
 * @returns {IngestMessage | null}
 */
function normalizeTranscriptItem(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const item = /** @type {{type?: unknown, role?: unknown, content?: unknown}} */ (candidate);
  if (item.type !== "message") {
    return null;
  }
  if (item.role !== "user" && item.role !== "assistant") {
    return null;
  }

  const content = Array.isArray(item.content)
    ? item.content.map(blockText).filter(Boolean).join("\n\n")
    : "";
  return normalizeVisibleMessage(item.role, content);
}

/**
 * @param {string} raw
 * @returns {IngestMessage[]}
 */
export function parseTranscriptText(raw) {
  /** @type {IngestMessage[]} */
  const eventMessages = [];
  /** @type {IngestMessage[]} */
  const responseMessages = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const value = JSON.parse(trimmed);
      const eventMessage = extractEventMessage(value);
      if (eventMessage) {
        eventMessages.push(eventMessage);
      }

      for (const candidate of extractResponseCandidates(value)) {
        const message = normalizeTranscriptItem(candidate);
        if (message) {
          responseMessages.push(message);
        }
      }
    } catch {
      // Ignore malformed lines. Hooks should degrade gracefully.
    }
  }

  if (eventMessages.some((message) => message.role === "user")) {
    return eventMessages;
  }

  return responseMessages;
}

/**
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
  /**
   * @returns {boolean}
   */
  function hasUserMessage() {
    return selected.some((message) => message.role === "user");
  }

  /** @type {IngestMessage[]} */
  const selected = [];
  let total = 0;

  for (
    let index = messages.length - 1;
    index >= 0 && selected.length < maxMessages;
    index -= 1
  ) {
    const message = messages[index];
    const size = new TextEncoder().encode(message.content).byteLength;
    if (size > maxBytes) {
      if (selected.length > 0 && hasUserMessage()) {
        break;
      }

      selected.length = 0;
      total = 0;
      continue;
    }
    if (selected.length > 0 && total + size > maxBytes) {
      if (hasUserMessage()) {
        break;
      }

      selected.length = 0;
      total = 0;
    }

    selected.unshift(message);
    total += size;
  }

  return hasUserMessage() ? selected : [];
}
