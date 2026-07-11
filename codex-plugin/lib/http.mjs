// @ts-nocheck

import { readFileSync } from "node:fs";

import { DEFAULT_REQUEST_TIMEOUT_MS } from "./config.mjs";

const CODEX_PLUGIN_VERSION_FALLBACK = "unknown";

function readCodexPluginVersion() {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8"),
    );
    return typeof manifest.version === "string" && manifest.version.trim()
      ? manifest.version.trim()
      : CODEX_PLUGIN_VERSION_FALLBACK;
  } catch {
    return CODEX_PLUGIN_VERSION_FALLBACK;
  }
}

export const MEM9_PLUGIN_USER_AGENT = `mem9-plugin/codex/${readCodexPluginVersion()}`;

/**
 * @typedef {{
 *   method?: string,
 *   headers?: HeadersInit,
 *   body?: BodyInit | null,
 *   timeoutMs?: number,
 * }} Mem9FetchOptions
 */

export class Mem9HttpError extends Error {
  constructor(message, { status, body, data } = {}) {
    super(message);
    this.name = "Mem9HttpError";
    this.status = status;
    this.body = body ?? "";
    this.data = data;
  }
}

function parseJsonOrNull(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorMessageFromBody(status, body, data) {
  if (data && typeof data === "object") {
    if (typeof data.message === "string" && data.message.trim()) {
      return data.message.trim();
    }
    if (typeof data.error === "string" && data.error.trim()) {
      return data.error.trim();
    }
  }

  const text = String(body ?? "").trim();
  if (text) {
    return text;
  }

  return `HTTP ${status}`;
}

export async function mem9FetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    signal: AbortSignal.timeout(
      options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    ),
  });

  if (!response.ok) {
    const body = await response.text();
    const data = parseJsonOrNull(body);
    throw new Mem9HttpError(
      `mem9 request failed (${response.status}): ${errorMessageFromBody(response.status, body, data)}`,
      {
        status: response.status,
        body,
        data,
      },
    );
  }

  if (response.status === 204) {
    return null;
  }

  const body = await response.text();
  if (!body) {
    return null;
  }

  return JSON.parse(body);
}

export function mem9Headers(apiKey, agentId) {
  return {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
    "X-Mnemo-Agent-Id": agentId,
    "User-Agent": MEM9_PLUGIN_USER_AGENT,
  };
}

export function buildMem9Url(baseUrl, relativePath) {
  return new URL(
    String(relativePath ?? "").replace(/^\/+/, ""),
    `${String(baseUrl ?? "").replace(/\/+$/, "")}/`,
  );
}
