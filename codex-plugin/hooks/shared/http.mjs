// @ts-check

import { DEFAULT_REQUEST_TIMEOUT_MS } from "./config.mjs";

/**
 * @typedef {{
 *   method?: string,
 *   headers?: HeadersInit,
 *   body?: BodyInit | null,
 *   timeoutMs?: number,
 * }} Mem9FetchOptions
 */

/**
 * @param {string} url
 * @param {Mem9FetchOptions} [options]
 * @returns {Promise<unknown>}
 */
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
    throw new Error(`mem9 request failed (${response.status}): ${body}`);
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

/**
 * @param {string} apiKey
 * @param {string} agentId
 * @returns {Record<string, string>}
 */
export function mem9Headers(apiKey, agentId) {
  return {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
    "X-Mnemo-Agent-Id": agentId,
  };
}
