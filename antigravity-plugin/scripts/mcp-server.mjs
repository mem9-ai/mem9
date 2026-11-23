#!/usr/bin/env node
// @ts-check

import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { loadRuntimeState, redactApiKeyPreview } from "./lib/config.mjs";
import { appendDebugError } from "./lib/debug.mjs";
import {
  Mem9HttpError,
  buildMem9Url,
  mem9FetchJson,
  mem9Headers,
} from "./lib/http.mjs";
import {
  formatRuntimeStateNotice,
  toolErrorPayload,
} from "./lib/quota-error.mjs";

const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const MAX_MEMORY_CONTENT_CHARS = 50_000;
const MAX_MEMORY_TAGS = 20;

/**
 * @typedef {Record<string, string | undefined>} EnvMap
 * @typedef {{
 *   jsonrpc?: unknown,
 *   id?: string | number | null,
 *   method?: unknown,
 *   params?: unknown,
 * }} JsonRpcRequest
 * @typedef {{
 *   loadState?: typeof loadRuntimeState,
 *   fetchJson?: typeof mem9FetchJson,
 *   env?: EnvMap,
 *   mem9Home?: string,
 *   pluginDataDir?: string,
 *   homeDir?: string,
 * }} ServerContext
 */

/**
 * @returns {string}
 */
function readPluginVersion() {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../plugin.json", import.meta.url), "utf8"),
    );
    return typeof manifest?.version === "string" && manifest.version.trim()
      ? manifest.version.trim()
      : "0.1.0";
  } catch {
    return "0.1.0";
  }
}

const PLUGIN_VERSION = readPluginVersion();

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} payload
 * @returns {{ message?: string }}
 */
function responseMessageFields(payload) {
  if (!isRecord(payload)) {
    return {};
  }
  const direct = normalizeString(payload.message);
  if (direct) {
    return { message: direct };
  }
  const runtimeNotice = normalizeString(formatRuntimeStateNotice(payload.runtimeState));
  return runtimeNotice ? { message: runtimeNotice } : {};
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
function stripNoticeFields(payload) {
  const { runtimeState: _runtimeState, message: _message, ...rest } = payload;
  return rest;
}

/**
 * @param {unknown} value
 * @param {number} maxLen
 * @param {string} field
 * @returns {string}
 */
function requireNonEmptyString(value, field, maxLen = Infinity) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required and must be a non-empty string`);
  }
  if (value.length > maxLen) {
    throw new Error(`${field} exceeds ${maxLen} characters`);
  }
  return value;
}

/**
 * @param {unknown} tags
 * @returns {string[] | undefined}
 */
function validateTags(tags) {
  if (tags === undefined) {
    return undefined;
  }
  if (!Array.isArray(tags) || tags.some((item) => typeof item !== "string")) {
    throw new Error("tags must be an array of strings");
  }
  if (tags.length > MAX_MEMORY_TAGS) {
    throw new Error(`tags exceed ${MAX_MEMORY_TAGS} entries`);
  }
  return tags;
}

/**
 * @param {unknown} metadata
 * @returns {Record<string, unknown> | undefined}
 */
function validateMetadata(metadata) {
  if (metadata === undefined) {
    return undefined;
  }
  if (!isRecord(metadata)) {
    throw new Error("metadata must be a JSON object");
  }
  return metadata;
}

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: "memory_store",
    description: "Store a memory. Returns the stored memory with its assigned id.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          maxLength: MAX_MEMORY_CONTENT_CHARS,
          description: "Memory content (required, max 50000 chars)",
        },
        source: {
          type: "string",
          description: "Which agent wrote this memory",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          maxItems: MAX_MEMORY_TAGS,
          description: "Filterable tags (max 20)",
        },
        metadata: {
          type: "object",
          additionalProperties: true,
          description: "Arbitrary structured data",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_search",
    description: "Search memories using hybrid vector + keyword search. Higher score = more relevant.",
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Search query",
        },
        tags: {
          type: "string",
          description: "Comma-separated tags to filter by (AND)",
        },
        source: {
          type: "string",
          description: "Filter by source agent",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "Max results (default 20, max 200)",
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: "Pagination offset",
        },
        memory_type: {
          type: "string",
          description: "Comma-separated memory types to filter by (e.g. insight,pinned)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memory_get",
    description: "Retrieve a single memory by its id.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Memory id (UUID)",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_update",
    description: "Update an existing memory. Only provided fields are changed.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Memory id to update",
        },
        content: {
          type: "string",
          maxLength: MAX_MEMORY_CONTENT_CHARS,
          description: "New content",
        },
        source: {
          type: "string",
          description: "New source",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          maxItems: MAX_MEMORY_TAGS,
          description: "Replacement tags",
        },
        metadata: {
          type: "object",
          additionalProperties: true,
          description: "Replacement metadata",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_delete",
    description: "Delete a memory by id.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Memory id to delete",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_status",
    description: "Inspect mem9 configuration, active profile, redacted API key status, and optional live runtime state.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Optional workspace path override to resolve project-scoped configuration",
        },
        check_remote: {
          type: "boolean",
          description: "When true, query /v1alpha2/mem9s/runtime-state for live quota and key status",
        },
      },
      additionalProperties: false,
    },
  },
]);

const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));

/**
 * @param {ReturnType<typeof loadRuntimeState>} state
 * @returns {string}
 */
function unreadyErrorMessage(state) {
  switch (state.issueCode) {
    case "disabled":
      return "mem9 is disabled for this scope";
    case "invalid_config":
      return "mem9 configuration file contains invalid JSON";
    case "invalid_credentials":
      return "mem9 credentials file contains invalid JSON";
    case "missing_profile":
      return `mem9 profile "${state.runtime.profileId}" was not found`;
    case "missing_api_key":
      return "mem9 API key is missing; run /mem9-setup or set MEM9_API_KEY";
    default:
      return "mem9 is not configured; run /mem9-setup or set MEM9_API_KEY";
  }
}

/**
 * @param {unknown} profiles
 * @returns {Record<string, { label: string, baseUrl: string, hasApiKey: boolean, apiKeyPreview: string }>}
 */
function redactProfiles(profiles) {
  /** @type {Record<string, { label: string, baseUrl: string, hasApiKey: boolean, apiKeyPreview: string }>} */
  const output = {};
  if (!isRecord(profiles)) {
    return output;
  }

  for (const [id, profile] of Object.entries(profiles)) {
    if (!isRecord(profile)) {
      continue;
    }
    const apiKey = typeof profile.apiKey === "string" ? profile.apiKey : "";
    output[id] = {
      label: typeof profile.label === "string" ? profile.label : "",
      baseUrl: typeof profile.baseUrl === "string" ? profile.baseUrl : "",
      hasApiKey: Boolean(apiKey.trim()),
      apiKeyPreview: redactApiKeyPreview(apiKey),
    };
  }

  return output;
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {ServerContext} [ctx]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function executeToolCall(name, args, ctx = {}) {
  const env = ctx.env ?? process.env;
  const loadStateFn = ctx.loadState ?? loadRuntimeState;
  const fetchJsonFn = ctx.fetchJson ?? mem9FetchJson;
  const pluginDataDir = ctx.pluginDataDir ?? normalizeString(env.PLUGIN_DATA);
  const dynamicCwd = normalizeString(args.cwd) || normalizeString(env.WORKSPACE_ROOT) || process.cwd();

  const state = loadStateFn({
    cwd: dynamicCwd,
    mem9Home: ctx.mem9Home,
    pluginDataDir,
    env,
    homeDir: ctx.homeDir,
  });

  if (name === "memory_status") {
    /** @type {Record<string, unknown>} */
    const payload = {
      ok: true,
      issueCode: state.issueCode,
      ready: state.issueCode === "ready",
      enabled: state.runtime.enabled,
      configSource: state.configSource,
      authSource: state.authSource,
      profileId: state.runtime.profileId,
      baseUrl: state.runtime.baseUrl,
      agentId: state.runtime.agentId,
      hasApiKey: Boolean(state.runtime.apiKey),
      apiKeyPreview: redactApiKeyPreview(state.runtime.apiKey),
      defaultTimeoutMs: state.runtime.defaultTimeoutMs,
      searchTimeoutMs: state.runtime.searchTimeoutMs,
      recallMinPromptLength: state.runtime.recallMinPromptLength,
      projectRoot: state.projectRoot,
      warnings: state.warnings,
      paths: {
        mem9Home: state.paths.mem9Home,
        credentialsPath: state.paths.credentialsPath,
        userConfigPath: state.paths.userConfigPath,
        projectConfigPath: state.paths.projectConfigPath,
      },
      profiles: redactProfiles(state.profiles),
    };

    if (args.check_remote === true && state.issueCode === "ready" && state.runtime.apiKey) {
      try {
        const remote = await fetchJsonFn(
          String(buildMem9Url(state.runtime.baseUrl, "v1alpha2/mem9s/runtime-state")),
          {
            method: "GET",
            headers: mem9Headers(state.runtime.apiKey),
            timeoutMs: state.runtime.defaultTimeoutMs,
          },
        );
        const notice = normalizeString(formatRuntimeStateNotice(remote));
        payload.remoteStatus = "ok";
        if (notice) {
          payload.message = notice;
        }
        if (isRecord(remote)) {
          const { mem9ApiKey, meters, recommendedAction } = remote;
          payload.runtimeState = {
            ...(mem9ApiKey !== undefined ? { mem9ApiKey } : {}),
            ...(meters !== undefined ? { meters } : {}),
            ...(isRecord(recommendedAction)
              ? {
                recommendedAction: {
                  ...(typeof recommendedAction.providerActionCode === "string"
                    ? { providerActionCode: recommendedAction.providerActionCode }
                    : {}),
                  ...(typeof recommendedAction.severity === "string"
                    ? { severity: recommendedAction.severity }
                    : {}),
                  ...(typeof recommendedAction.type === "string"
                    ? { type: recommendedAction.type }
                    : {}),
                },
              }
              : {}),
          };
        }
      } catch (error) {
        payload.remoteStatus = "error";
        payload.remoteError = error instanceof Error ? error.message : String(error);
      }
    }

    return payload;
  }

  if (state.issueCode !== "ready" || !state.runtime.apiKey) {
    return {
      ok: false,
      error: unreadyErrorMessage(state),
      issueCode: state.issueCode,
    };
  }

  const headers = mem9Headers(state.runtime.apiKey);

  try {
    switch (name) {
      case "memory_store": {
        const content = requireNonEmptyString(
          args.content,
          "content",
          MAX_MEMORY_CONTENT_CHARS,
        );
        const tags = validateTags(args.tags);
        const metadata = validateMetadata(args.metadata);
        const source = typeof args.source === "string" && args.source.trim()
          ? args.source.trim()
          : undefined;

        const body = {
          content,
          memory_type: "pinned",
          agent_id: state.runtime.agentId,
          ...(source !== undefined ? { source } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
        };

        const result = await fetchJsonFn(
          String(buildMem9Url(state.runtime.baseUrl, "v1alpha2/mem9s/memories")),
          {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            timeoutMs: state.runtime.defaultTimeoutMs,
          },
        );
        const data = isRecord(result) ? stripNoticeFields(result) : result;
        return {
          ok: true,
          data,
          ...responseMessageFields(result),
        };
      }

      case "memory_search": {
        const url = new URL(
          String(buildMem9Url(state.runtime.baseUrl, "v1alpha2/mem9s/memories")),
        );
        if (typeof args.q === "string" && args.q) {
          url.searchParams.set("q", args.q);
        }
        if (typeof args.tags === "string" && args.tags) {
          url.searchParams.set("tags", args.tags);
        }
        if (typeof args.source === "string" && args.source) {
          url.searchParams.set("source", args.source);
        }
        if (args.limit !== undefined) {
          if (
            typeof args.limit !== "number"
            || !Number.isInteger(args.limit)
            || args.limit < 1
            || args.limit > 200
          ) {
            throw new Error("limit must be an integer between 1 and 200");
          }
          url.searchParams.set("limit", String(args.limit));
        }
        if (args.offset !== undefined) {
          if (
            typeof args.offset !== "number"
            || !Number.isInteger(args.offset)
            || args.offset < 0
          ) {
            throw new Error("offset must be a non-negative integer");
          }
          url.searchParams.set("offset", String(args.offset));
        }
        if (typeof args.memory_type === "string" && args.memory_type) {
          url.searchParams.set("memory_type", args.memory_type);
        }

        const result = await fetchJsonFn(url.toString(), {
          method: "GET",
          headers,
          timeoutMs: state.runtime.searchTimeoutMs,
        });

        const searchResult = Array.isArray(result)
          ? { memories: result }
          : isRecord(result)
            ? stripNoticeFields(result)
            : { memories: [] };

        return {
          ok: true,
          ...searchResult,
          ...responseMessageFields(result),
        };
      }

      case "memory_get": {
        const id = requireNonEmptyString(args.id, "id");
        try {
          const result = await fetchJsonFn(
            String(
              buildMem9Url(
                state.runtime.baseUrl,
                `v1alpha2/mem9s/memories/${encodeURIComponent(id)}`,
              ),
            ),
            {
              method: "GET",
              headers,
              timeoutMs: state.runtime.defaultTimeoutMs,
            },
          );
          if (!result) {
            return { ok: false, error: "memory not found" };
          }
          return { ok: true, data: result };
        } catch (error) {
          if (error instanceof Mem9HttpError && error.status === 404) {
            return { ok: false, error: "memory not found" };
          }
          throw error;
        }
      }

      case "memory_update": {
        const id = requireNonEmptyString(args.id, "id");
        const content = args.content !== undefined
          ? requireNonEmptyString(args.content, "content", MAX_MEMORY_CONTENT_CHARS)
          : undefined;
        const source = typeof args.source === "string" ? args.source : undefined;
        const tags = validateTags(args.tags);
        const metadata = validateMetadata(args.metadata);

        const body = {
          ...(content !== undefined ? { content } : {}),
          ...(source !== undefined ? { source } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
        };

        try {
          const result = await fetchJsonFn(
            String(
              buildMem9Url(
                state.runtime.baseUrl,
                `v1alpha2/mem9s/memories/${encodeURIComponent(id)}`,
              ),
            ),
            {
              method: "PUT",
              headers,
              body: JSON.stringify(body),
              timeoutMs: state.runtime.defaultTimeoutMs,
            },
          );
          if (!result) {
            return { ok: false, error: "memory not found" };
          }
          return { ok: true, data: result };
        } catch (error) {
          if (error instanceof Mem9HttpError && error.status === 404) {
            return { ok: false, error: "memory not found" };
          }
          throw error;
        }
      }

      case "memory_delete": {
        const id = requireNonEmptyString(args.id, "id");
        try {
          await fetchJsonFn(
            String(
              buildMem9Url(
                state.runtime.baseUrl,
                `v1alpha2/mem9s/memories/${encodeURIComponent(id)}`,
              ),
            ),
            {
              method: "DELETE",
              headers,
              timeoutMs: state.runtime.defaultTimeoutMs,
            },
          );
          return { ok: true };
        } catch (error) {
          if (error instanceof Mem9HttpError && error.status === 404) {
            return { ok: false, error: "memory not found" };
          }
          throw error;
        }
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return toolErrorPayload(error);
  }
}

/**
 * @param {string | number | null} id
 * @param {unknown} result
 * @returns {Record<string, unknown>}
 */
function rpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

/**
 * @param {string | number | null} id
 * @param {number} code
 * @param {string} message
 * @returns {Record<string, unknown>}
 */
function rpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

/**
 * @param {unknown} rawMessage
 * @param {ServerContext} [ctx]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function handleJsonRpcMessage(rawMessage, ctx = {}) {
  if (!isRecord(rawMessage)) {
    return rpcError(null, -32600, "Invalid Request");
  }

  const hasId = Object.prototype.hasOwnProperty.call(rawMessage, "id")
    && rawMessage.id !== undefined;
  const id = hasId && (
    typeof rawMessage.id === "string"
    || typeof rawMessage.id === "number"
    || rawMessage.id === null
  )
    ? rawMessage.id
    : null;
  const method = typeof rawMessage.method === "string" ? rawMessage.method : "";

  if (!method) {
    return hasId ? rpcError(id, -32600, "Invalid Request") : null;
  }

  if (method.startsWith("notifications/")) {
    return null;
  }

  if (!hasId) {
    return null;
  }

  const params = isRecord(rawMessage.params) ? rawMessage.params : {};

  switch (method) {
    case "initialize": {
      const requestedVersion = normalizeString(params.protocolVersion);
      return rpcResult(id, {
        protocolVersion: requestedVersion || DEFAULT_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: "mem9",
          version: PLUGIN_VERSION,
        },
      });
    }

    case "ping":
      return rpcResult(id, {});

    case "resources/list":
      return rpcResult(id, { resources: [] });

    case "prompts/list":
      return rpcResult(id, { prompts: [] });

    case "tools/list":
      return rpcResult(id, { tools: TOOL_DEFINITIONS });

    case "tools/call": {
      const toolName = normalizeString(params.name);
      if (!toolName || !TOOL_NAMES.has(toolName)) {
        return rpcError(id, -32602, `Unknown tool: ${toolName || "(missing)"}`);
      }
      const args = isRecord(params.arguments) ? params.arguments : {};
      const payload = await executeToolCall(toolName, args, ctx);
      return rpcResult(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload),
          },
        ],
        isError: payload.ok === false,
      });
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

/**
 * Creates a streaming parser that supports both newline-delimited JSON and
 * Content-Length framed JSON-RPC messages over a single stdio stream.
 *
 * @param {(messageText: string) => void} onFrame
 * @param {(errorMessage: string) => void} onFrameError
 */
export function createFrameReader(onFrame, onFrameError) {
  /** @type {Buffer} */
  let buffer = Buffer.alloc(0);

  /**
   * @param {Buffer} buf
   * @returns {Buffer}
   */
  function trimLeadingWhitespace(buf) {
    let offset = 0;
    while (
      offset < buf.length
      && (buf[offset] === 0x0d || buf[offset] === 0x0a || buf[offset] === 0x20 || buf[offset] === 0x09)
    ) {
      offset += 1;
    }
    return offset > 0 ? buf.subarray(offset) : buf;
  }

  /**
   * @param {Buffer} buf
   * @returns {{ index: number, sepLength: number } | null}
   */
  function findHeaderEnd(buf) {
    const crlf = buf.indexOf("\r\n\r\n");
    const lf = buf.indexOf("\n\n");
    if (crlf === -1 && lf === -1) {
      return null;
    }
    if (crlf !== -1 && (lf === -1 || crlf < lf)) {
      return { index: crlf, sepLength: 4 };
    }
    return { index: lf, sepLength: 2 };
  }

  /**
   * @param {boolean} eof
   */
  function drain(eof) {
    while (true) {
      buffer = trimLeadingWhitespace(buffer);
      if (buffer.length === 0) {
        return;
      }

      const firstByte = buffer[0];
      if (firstByte === 0x7b || firstByte === 0x5b) {
        const nlIndex = buffer.indexOf(0x0a);
        if (nlIndex === -1) {
          if (!eof) {
            return;
          }
          const line = buffer.toString("utf8").trim();
          buffer = Buffer.alloc(0);
          if (line) {
            onFrame(line);
          }
          return;
        }
        const line = buffer.subarray(0, nlIndex).toString("utf8").trim();
        buffer = buffer.subarray(nlIndex + 1);
        if (line) {
          onFrame(line);
        }
        continue;
      }

      const headerEnd = findHeaderEnd(buffer);
      if (!headerEnd) {
        const nlIndex = buffer.indexOf(0x0a);
        if (nlIndex !== -1) {
          const firstLine = buffer.subarray(0, nlIndex).toString("utf8").trim();
          if (!/^[A-Za-z-]+:\s*.+$/.test(firstLine)) {
            buffer = buffer.subarray(nlIndex + 1);
            onFrameError("Parse error");
            continue;
          }
        }
        if (eof) {
          buffer = Buffer.alloc(0);
          onFrameError("Parse error");
        }
        return;
      }

      const headerText = buffer.subarray(0, headerEnd.index).toString("utf8");
      const match = headerText.match(/(?:^|\r?\n)Content-Length:\s*(\d+)\s*(?:\r?\n|$)/i);
      if (!match) {
        buffer = buffer.subarray(headerEnd.index + headerEnd.sepLength);
        onFrameError("Missing Content-Length header");
        continue;
      }

      const contentLength = Number.parseInt(match[1], 10);
      const bodyStart = headerEnd.index + headerEnd.sepLength;
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
        buffer = buffer.subarray(bodyStart);
        onFrameError("Invalid Content-Length header");
        continue;
      }

      if (buffer.length < bodyStart + contentLength) {
        if (eof) {
          buffer = Buffer.alloc(0);
          onFrameError("Truncated message body");
        }
        return;
      }

      const body = buffer.subarray(bodyStart, bodyStart + contentLength).toString("utf8");
      buffer = buffer.subarray(bodyStart + contentLength);
      onFrame(body);
    }
  }

  return {
    /**
     * @param {Buffer | string} chunk
     */
    push(chunk) {
      const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      buffer = buffer.length === 0 ? next : Buffer.concat([buffer, next]);
      drain(false);
    },
    end() {
      drain(true);
    },
  };
}

/**
 * @param {{
 *   stdin?: NodeJS.ReadableStream,
 *   stdout?: NodeJS.WritableStream,
 *   context?: ServerContext,
 * }} [options]
 * @returns {Promise<void>}
 */
export function startStdioServer(options = {}) {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const ctx = options.context ?? {};

  return new Promise((resolve) => {
    /** @type {Promise<void>} */
    let queue = Promise.resolve();
    let ended = false;
    let pendingCount = 0;

    const maybeResolve = () => {
      if (ended && pendingCount === 0) {
        resolve();
      }
    };

    /**
     * @param {Record<string, unknown>} payload
     */
    const writeMessage = (payload) => {
      stdout.write(`${JSON.stringify(payload)}\n`);
    };

    /**
     * @param {() => Promise<void> | void} fn
     */
    const enqueue = (fn) => {
      pendingCount += 1;
      queue = queue
        .then(fn)
        .finally(() => {
          pendingCount -= 1;
          maybeResolve();
        });
    };

    /**
     * @param {string} frameText
     */
    const dispatchFrame = (frameText) => {
      let parsed;
      try {
        parsed = JSON.parse(frameText);
      } catch {
        enqueue(() => {
          writeMessage(rpcError(null, -32700, "Parse error"));
        });
        return;
      }

      enqueue(async () => {
        try {
          if (Array.isArray(parsed)) {
            const responses = [];
            for (const item of parsed) {
              const res = await handleJsonRpcMessage(item, ctx);
              if (res) {
                responses.push(res);
              }
            }
            if (responses.length > 0) {
              stdout.write(`${JSON.stringify(responses)}\n`);
            }
            return;
          }

          const response = await handleJsonRpcMessage(parsed, ctx);
          if (response) {
            writeMessage(response);
          }
        } catch (error) {
          try {
            const state = loadRuntimeState({
              cwd: normalizeString((ctx.env ?? process.env).WORKSPACE_ROOT) || process.cwd(),
              mem9Home: ctx.mem9Home,
              pluginDataDir: ctx.pluginDataDir ?? normalizeString((ctx.env ?? process.env).PLUGIN_DATA),
              env: ctx.env,
              homeDir: ctx.homeDir,
            });
            appendDebugError({
              logPath: state.paths.debugLogPath,
              hook: "McpServer",
              stage: "dispatch_failed",
              error,
              env: ctx.env,
            });
          } catch {
            // Ignore debug write errors inside MCP server loop.
          }
          const reqId = isRecord(parsed) && (
            typeof parsed.id === "string"
            || typeof parsed.id === "number"
            || parsed.id === null
          )
            ? parsed.id
            : null;
          if (isRecord(parsed) && Object.prototype.hasOwnProperty.call(parsed, "id")) {
            writeMessage(rpcError(reqId, -32603, "Internal error"));
          }
        }
      });
    };

    const reader = createFrameReader(
      dispatchFrame,
      (message) => enqueue(() => writeMessage(rpcError(null, -32700, message))),
    );

    stdin.on("data", (chunk) => {
      reader.push(chunk);
    });

    stdin.on("end", () => {
      reader.end();
      ended = true;
      maybeResolve();
    });
  });
}

/**
 * @returns {boolean}
 */
function isMainModule() {
  if (!process.argv[1]) {
    return false;
  }
  if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    return true;
  }
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void startStdioServer();
}
