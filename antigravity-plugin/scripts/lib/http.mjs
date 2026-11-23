// @ts-check

import { readFileSync } from "node:fs";

const PLUGIN_VERSION_FALLBACK = "unknown";
const DEFAULT_API_URL = "https://api.mem9.ai";
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const MEM9_WRITER_ID = "antigravity";

/**
 * Reads the plugin version from `plugin.json`, falling back to `"unknown"`.
 *
 * @returns {string}
 */
function readAntigravityPluginVersion() {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../../plugin.json", import.meta.url), "utf8"),
    );
    return typeof manifest?.version === "string" && manifest.version.trim()
      ? manifest.version.trim()
      : PLUGIN_VERSION_FALLBACK;
  } catch {
    return PLUGIN_VERSION_FALLBACK;
  }
}

export const MEM9_PLUGIN_USER_AGENT = `mem9-plugin/antigravity/${readAntigravityPluginVersion()}`;

/**
 * @typedef {{
 *   status?: number,
 *   body?: string,
 *   data?: unknown,
 * }} Mem9HttpErrorOptions
 */

/**
 * @typedef {{
 *   method?: string,
 *   headers?: HeadersInit,
 *   body?: BodyInit | null,
 *   timeoutMs?: number,
 *   fetchImpl?: typeof fetch,
 * }} Mem9FetchOptions
 */

/**
 * @typedef {{
 *   timeoutMs?: number,
 *   fetchImpl?: typeof fetch,
 * }} ProvisionOptions
 */

/**
 * HTTP error raised by mem9 API requests with status and parsed body details.
 */
export class Mem9HttpError extends Error {
  /**
   * @param {string} message
   * @param {Mem9HttpErrorOptions} [options]
   */
  constructor(message, { status, body, data } = {}) {
    super(message);
    this.name = "Mem9HttpError";
    /** @type {number | undefined} */
    this.status = status;
    /** @type {string} */
    this.body = body ?? "";
    /** @type {unknown} */
    this.data = data;
  }
}

/**
 * @param {string} text
 * @returns {unknown}
 */
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

/**
 * @param {number} status
 * @param {string} body
 * @param {unknown} data
 * @returns {string}
 */
function errorMessageFromBody(status, body, data) {
  if (data && typeof data === "object") {
    const record = /** @type {{ message?: unknown, error?: unknown }} */ (data);
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error.trim();
    }
  }

  const text = String(body ?? "").trim();
  if (text) {
    return text;
  }

  return `HTTP ${status}`;
}

/**
 * @param {number | undefined} timeoutMs
 * @returns {number}
 */
function resolveTimeoutMs(timeoutMs) {
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.floor(timeoutMs)
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

/**
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function readResponseText(response) {
  if (typeof response.text === "function") {
    return response.text();
  }
  if (typeof response.json === "function") {
    const json = await response.json();
    return json == null ? "" : JSON.stringify(json);
  }
  return "";
}

/**
 * Builds standard mem9 HTTP request headers.
 *
 * @param {string} apiKey
 * @returns {Record<string, string>}
 */
export function mem9Headers(apiKey) {
  return {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
    "X-Mnemo-Agent-Id": MEM9_WRITER_ID,
    "User-Agent": MEM9_PLUGIN_USER_AGENT,
  };
}

/**
 * Joins a base URL and relative API path into a normalized `URL`.
 *
 * @param {string} baseUrl
 * @param {string} relativePath
 * @returns {URL}
 */
export function buildMem9Url(baseUrl, relativePath) {
  const normalizedBase =
    String(baseUrl ?? "").trim().replace(/\/+$/, "") || DEFAULT_API_URL;
  return new URL(
    String(relativePath ?? "").replace(/^\/+/, ""),
    `${normalizedBase}/`,
  );
}

/**
 * Performs a JSON HTTP request against mem9 with timeout and error parsing.
 *
 * @param {string | URL} url
 * @param {Mem9FetchOptions} [options]
 * @returns {Promise<unknown>}
 */
export async function mem9FetchJson(
  url,
  {
    method = "GET",
    headers,
    body,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable for mem9 HTTP requests");
  }

  const response = await fetchImpl(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(resolveTimeoutMs(timeoutMs)),
  });

  if (!response.ok) {
    const responseBody = await readResponseText(response);
    const data = parseJsonOrNull(responseBody);
    throw new Mem9HttpError(
      `mem9 request failed (${response.status}): ${errorMessageFromBody(response.status, responseBody, data)}`,
      {
        status: response.status,
        body: responseBody,
        data,
      },
    );
  }

  if (response.status === 204) {
    return null;
  }

  const responseBody = await readResponseText(response);
  if (!responseBody || !responseBody.trim()) {
    return null;
  }

  return JSON.parse(responseBody);
}

/**
 * Provisions a new mem9 space and returns its API key and normalized base URL.
 *
 * @param {string} [baseUrl]
 * @param {ProvisionOptions} [options]
 * @returns {Promise<{ apiKey: string, baseUrl: string }>}
 */
export async function provisionMem9Space(
  baseUrl = DEFAULT_API_URL,
  { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, fetchImpl = fetch } = {},
) {
  const normalizedBaseUrl =
    String(baseUrl ?? "").trim().replace(/\/+$/, "") || DEFAULT_API_URL;
  const targetUrl = buildMem9Url(normalizedBaseUrl, "v1alpha1/mem9s").toString();

  const data = await mem9FetchJson(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": MEM9_PLUGIN_USER_AGENT,
    },
    timeoutMs,
    fetchImpl,
  });

  const record = data && typeof data === "object" && !Array.isArray(data)
    ? /** @type {{ id?: unknown, api_key?: unknown, apiKey?: unknown }} */ (data)
    : {};
  const apiKey =
    [record.id, record.api_key, record.apiKey]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find(Boolean) ?? "";

  if (!apiKey) {
    throw new Error("mem9 provisioning response did not include an API key");
  }

  return {
    apiKey,
    baseUrl: normalizedBaseUrl,
  };
}
