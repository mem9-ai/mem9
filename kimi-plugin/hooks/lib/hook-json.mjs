#!/usr/bin/env node
// @ts-check

import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {string} raw
 * @returns {Record<string, unknown>}
 */
export function parseJsonObject(raw) {
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @returns {string}
 */
export function readStdinText() {
  return readFileSync(0, "utf8");
}

/**
 * @returns {Record<string, unknown>}
 */
export function readStdinJson() {
  return parseJsonObject(readStdinText());
}

/**
 * @param {Record<string, unknown>} input
 * @param {string} key
 * @returns {string}
 */
export function getString(input, key) {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

/**
 * Normalize a Kimi hook `prompt` field to plain text. The field may be a
 * string or a content-part array like [{"type":"text","text":"..."}];
 * non-text parts are ignored.
 * @param {unknown} value
 * @returns {string}
 */
export function getPromptText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  const parts = [];
  for (const part of value) {
    if (part && typeof part === "object" && !Array.isArray(part)) {
      const record = /** @type {Record<string, unknown>} */ (part);
      if (record.type === "text" && typeof record.text === "string") {
        parts.push(record.text);
      }
    }
  }
  return parts.join("\n");
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
function main(argv) {
  const [command, ...rest] = argv;

  if (command === "get-string") {
    const [field] = rest;
    if (!field) {
      return 1;
    }
    process.stdout.write(getString(readStdinJson(), field));
    return 0;
  }

  if (command === "get-prompt") {
    process.stdout.write(getPromptText(readStdinJson().prompt));
    return 0;
  }

  if (command === "emit-context") {
    const [eventName, ...textParts] = rest;
    if (!eventName) {
      return 1;
    }
    const text = textParts.length > 0 ? textParts.join(" ") : readStdinText();
    // Kimi injects hook stdout into model context as plain text; no JSON envelope.
    process.stdout.write(text);
    return 0;
  }

  process.stderr.write(
    "usage: hook-json.mjs get-string <field> | get-prompt | emit-context <event> [text]\n",
  );
  return 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
