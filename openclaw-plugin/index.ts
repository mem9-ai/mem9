import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { MemoryBackend } from "./backend.js";
import {
  DEFAULT_SEARCH_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  ServerBackend,
  type BackendTimeouts,
} from "./server-backend.js";
import { registerHooks } from "./hooks.js";
import type {
  PluginConfig,
  Memory,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
  IngestInput,
  IngestResult,
} from "./types.js";

const DEFAULT_API_URL = "https://api.mem9.ai";
const TIMEOUT_FIELDS = ["defaultTimeoutMs", "searchTimeoutMs"] as const;
const SHARED_PROVISION_DIR = path.join(os.tmpdir(), "mem9-openclaw");
const SHARED_PROVISION_POLL_INTERVAL_MS = 250;
const SHARED_PROVISION_RESULT_TTL_MS = 2 * 60 * 1000;
const sharedProvisionPromises = new Map<string, Promise<string>>();

type SharedProvisionState =
  | {
      status: "pending";
      startedAt: number;
      pid: number;
    }
  | {
      status: "done";
      startedAt: number;
      finishedAt: number;
      apiKey: string;
    }
  | {
      status: "error";
      startedAt: number;
      finishedAt: number;
      error: string;
    };

function normalizeTimeoutMs(
  value: unknown,
  field: (typeof TIMEOUT_FIELDS)[number],
  fallback: number,
  logger: OpenClawPluginApi["logger"],
): number {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    logger.info(`[mem9] invalid ${field}; using ${fallback}ms`);
    return fallback;
  }
  return Math.floor(value);
}

function resolveTimeouts(
  cfg: PluginConfig,
  logger: OpenClawPluginApi["logger"],
): Required<BackendTimeouts> {
  const timeouts = {
    defaultTimeoutMs: normalizeTimeoutMs(
      cfg.defaultTimeoutMs,
      "defaultTimeoutMs",
      DEFAULT_TIMEOUT_MS,
      logger,
    ),
    searchTimeoutMs: normalizeTimeoutMs(
      cfg.searchTimeoutMs,
      "searchTimeoutMs",
      DEFAULT_SEARCH_TIMEOUT_MS,
      logger,
    ),
  };

  if (TIMEOUT_FIELDS.some((field) => cfg[field] != null)) {
    logger.info(
      `[mem9] timeout config: defaultTimeoutMs=${timeouts.defaultTimeoutMs}, searchTimeoutMs=${timeouts.searchTimeoutMs}`,
    );
  }

  return timeouts;
}

function jsonResult(data: unknown) {
  // Older OpenClaw versions may assume tool results have a normalized
  // assistant-content shape and can crash on plain objects that omit `content`.
  // Returning a JSON string keeps results readable while remaining compatible
  // with both old and new hosts.
  // https://github.com/openclaw/openclaw/blob/936607ca221a2f0c37ad976ddefcd39596f54793/CHANGELOG.md?plain=1#L1144
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function shouldEagerAutoProvision(cfg: PluginConfig): boolean {
  return cfg.apiUrl != null || cfg.provisionQueryParams != null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sharedProvisionKey(
  apiUrl: string,
  provisionQueryParams: Record<string, string>,
): string {
  const normalizedProvisionQueryParams = Object.fromEntries(
    Object.entries(provisionQueryParams).sort(([left], [right]) => left.localeCompare(right)),
  );

  return createHash("sha256")
    .update(
      JSON.stringify({
        apiUrl,
        provisionQueryParams: normalizedProvisionQueryParams,
      }),
    )
    .digest("hex");
}

function sharedProvisionStatePath(sharedKey: string): string {
  return path.join(SHARED_PROVISION_DIR, `${sharedKey}.json`);
}

async function readSharedProvisionState(filePath: string): Promise<SharedProvisionState | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SharedProvisionState>;
    if (parsed.status === "pending" && typeof parsed.startedAt === "number") {
      return {
        status: "pending",
        startedAt: parsed.startedAt,
        pid: typeof parsed.pid === "number" ? parsed.pid : 0,
      };
    }
    if (
      parsed.status === "done"
      && typeof parsed.startedAt === "number"
      && typeof parsed.finishedAt === "number"
      && typeof parsed.apiKey === "string"
    ) {
      return {
        status: "done",
        startedAt: parsed.startedAt,
        finishedAt: parsed.finishedAt,
        apiKey: parsed.apiKey,
      };
    }
    if (
      parsed.status === "error"
      && typeof parsed.startedAt === "number"
      && typeof parsed.finishedAt === "number"
      && typeof parsed.error === "string"
    ) {
      return {
        status: "error",
        startedAt: parsed.startedAt,
        finishedAt: parsed.finishedAt,
        error: parsed.error,
      };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
  }
  return null;
}

async function writeSharedProvisionState(
  filePath: string,
  state: SharedProvisionState,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state), "utf8");
}

async function createSharedProvisionPendingState(
  filePath: string,
  startedAt: number,
): Promise<boolean> {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        status: "pending",
        startedAt,
        pid: process.pid,
      } satisfies SharedProvisionState),
      { encoding: "utf8", flag: "wx" },
    );
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw err;
  }
}

async function removeSharedProvisionState(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

async function waitForSharedProvisionResult(
  filePath: string,
  waitTimeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + waitTimeoutMs;

  while (true) {
    const state = await readSharedProvisionState(filePath);
    const now = Date.now();

    if (!state) {
      return null;
    }

    if (state.status === "done") {
      if (now - state.finishedAt <= SHARED_PROVISION_RESULT_TTL_MS) {
        return state.apiKey;
      }
      await removeSharedProvisionState(filePath);
      return null;
    }

    if (state.status === "error") {
      await removeSharedProvisionState(filePath);
      throw new Error(state.error);
    }

    if (now - state.startedAt > waitTimeoutMs || now >= deadline) {
      await removeSharedProvisionState(filePath);
      return null;
    }

    await sleep(SHARED_PROVISION_POLL_INTERVAL_MS);
  }
}

async function resolveSharedProvisionedAPIKey(
  apiUrl: string,
  provisionQueryParams: Record<string, string>,
  timeouts: Required<BackendTimeouts>,
  logger: OpenClawPluginApi["logger"],
  registerTenant: () => Promise<string>,
): Promise<string> {
  const key = sharedProvisionKey(apiUrl, provisionQueryParams);
  const existingPromise = sharedProvisionPromises.get(key);
  if (existingPromise) {
    return existingPromise;
  }

  const waitTimeoutMs = Math.max(timeouts.defaultTimeoutMs + 5_000, 30_000);
  const filePath = sharedProvisionStatePath(key);
  const sharedPromise = (async () => {
    while (true) {
      const state = await readSharedProvisionState(filePath);
      const now = Date.now();

      if (state?.status === "done") {
        if (now - state.finishedAt <= SHARED_PROVISION_RESULT_TTL_MS) {
          logger.info("[mem9] reusing shared auto-provisioned apiKey pending config write-back");
          return state.apiKey;
        }
        await removeSharedProvisionState(filePath);
        continue;
      }

      if (state?.status === "error") {
        await removeSharedProvisionState(filePath);
      } else if (state?.status === "pending") {
        if (now - state.startedAt > waitTimeoutMs) {
          await removeSharedProvisionState(filePath);
          continue;
        }
        logger.info("[mem9] auto-provision already in progress in another mem9 instance; waiting");
        const sharedApiKey = await waitForSharedProvisionResult(filePath, waitTimeoutMs);
        if (sharedApiKey) {
          return sharedApiKey;
        }
        continue;
      }

      const startedAt = Date.now();
      const acquired = await createSharedProvisionPendingState(filePath, startedAt);
      if (!acquired) {
        continue;
      }

      try {
        const apiKey = await registerTenant();
        await writeSharedProvisionState(filePath, {
          status: "done",
          startedAt,
          finishedAt: Date.now(),
          apiKey,
        });
        return apiKey;
      } catch (err) {
        await writeSharedProvisionState(filePath, {
          status: "error",
          startedAt,
          finishedAt: Date.now(),
          error: errorMessage(err),
        });
        throw err;
      }
    }
  })().finally(() => {
    sharedProvisionPromises.delete(key);
  });

  sharedProvisionPromises.set(key, sharedPromise);
  return sharedPromise;
}

interface MemoryCapability {
  search: (query: string, opts?: { limit?: number }) => Promise<{ data: Memory[]; total: number }>;
  store: (content: string, opts?: { tags?: string[]; source?: string }) => Promise<unknown>;
  get: (id: string) => Promise<Memory | null>;
  remove: (id: string) => Promise<boolean>;
}

interface OpenClawPluginApi {
  pluginConfig?: unknown;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  registerTool: (
    factory: ToolFactory | (() => AnyAgentTool[]),
    opts: { names: string[] }
  ) => void;
  registerCapability?: (slot: string, capability: MemoryCapability) => void;
  on: (hookName: string, handler: (...args: unknown[]) => unknown, opts?: { priority?: number }) => void;
}

interface ToolContext {
  workspaceDir?: string;
  agentId?: string;
  sessionKey?: string;
  messageChannel?: string;
}

type ToolFactory = (ctx: ToolContext) => AnyAgentTool | AnyAgentTool[] | null | undefined;

interface AnyAgentTool {
  name: string;
  label: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  execute: (_id: string, params: unknown) => Promise<unknown>;
}

function buildTools(backend: MemoryBackend): AnyAgentTool[] {
  return [
    {
      name: "memory_store",
      label: "Store Memory",
      description:
        "Store a memory. Returns the stored memory with its assigned id.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Memory content (required, max 50000 chars)",
          },
          source: {
            type: "string",
            description: "Which agent wrote this memory",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Filterable tags (max 20)",
          },
          metadata: {
            type: "object",
            description: "Arbitrary structured data",
          },
        },
        required: ["content"],
      },
      async execute(_id: string, params: unknown) {
        try {
          const input = params as CreateMemoryInput;
          const result = await backend.store(input);
          return jsonResult({ ok: true, data: result });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },

    {
      name: "memory_search",
      label: "Search Memories",
      description:
        "Search memories using hybrid vector + keyword search. Higher score = more relevant.",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Search query" },
          tags: {
            type: "string",
            description: "Comma-separated tags to filter by (AND)",
          },
          source: { type: "string", description: "Filter by source agent" },
          limit: {
            type: "number",
            description: "Max results (default 20, max 200)",
          },
          offset: { type: "number", description: "Pagination offset" },
          memory_type: {
            type: "string",
            description: "Comma-separated memory types to filter by (e.g. insight,pinned)",
          },
        },
        required: [],
      },
      async execute(_id: string, params: unknown) {
        try {
          const input = (params ?? {}) as SearchInput;
          const result = await backend.search(input);
          return jsonResult({ ok: true, ...result });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },

    {
      name: "memory_get",
      label: "Get Memory",
      description: "Retrieve a single memory by its id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory id (UUID)" },
        },
        required: ["id"],
      },
      async execute(_id: string, params: unknown) {
        try {
          const { id } = params as { id: string };
          const result = await backend.get(id);
          if (!result)
            return jsonResult({ ok: false, error: "memory not found" });
          return jsonResult({ ok: true, data: result });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },

    {
      name: "memory_update",
      label: "Update Memory",
      description:
        "Update an existing memory. Only provided fields are changed.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory id to update" },
          content: { type: "string", description: "New content" },
          source: { type: "string", description: "New source" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Replacement tags",
          },
          metadata: { type: "object", description: "Replacement metadata" },
        },
        required: ["id"],
      },
      async execute(_id: string, params: unknown) {
        try {
          const { id, ...input } = params as { id: string } & UpdateMemoryInput;
          const result = await backend.update(id, input);
          if (!result)
            return jsonResult({ ok: false, error: "memory not found" });
          return jsonResult({ ok: true, data: result });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },

    {
      name: "memory_delete",
      label: "Delete Memory",
      description: "Delete a memory by id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory id to delete" },
        },
        required: ["id"],
      },
      async execute(_id: string, params: unknown) {
        try {
          const { id } = params as { id: string };
          const deleted = await backend.remove(id);
          if (!deleted)
            return jsonResult({ ok: false, error: "memory not found" });
          return jsonResult({ ok: true });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  ];
}

const mnemoPlugin = {
  id: "mem9",
  name: "Mnemo Memory",
  description:
    "AI agent memory — server mode (mnemo-server) with hybrid vector + keyword search.",

  register(api: OpenClawPluginApi) {
    const cfg = (api.pluginConfig ?? {}) as PluginConfig;
    const effectiveApiUrl = cfg.apiUrl ?? DEFAULT_API_URL;
    const provisionQueryParams = cfg.provisionQueryParams ?? {};
    const timeoutConfig = resolveTimeouts(cfg, api.logger);
    const hookAgentId = cfg.agentName ?? "agent";
    if (!cfg.apiUrl) {
      api.logger.info(`[mem9] apiUrl not configured, using default ${DEFAULT_API_URL}`);
    }

    const configuredApiKey = cfg.apiKey ?? cfg.tenantID;
    if (cfg.apiKey && cfg.tenantID) {
      api.logger.info("[mem9] both apiKey and tenantID set; using apiKey");
    } else if (cfg.tenantID) {
      api.logger.info("[mem9] tenantID is deprecated; treating it as apiKey for v1alpha2");
    }
    const registerTenant = async (agentName: string): Promise<string> => {
      const backend = new ServerBackend(
        effectiveApiUrl,
        "",
        agentName,
        {
          timeouts: timeoutConfig,
          provisionQueryParams,
        },
      );
      const result = await backend.register();
      api.logger.info(
        `[mem9] *** Auto-provisioned apiKey=${result.id} *** Save this to your config as apiKey`
      );
      return result.id;
    };
    let registrationPromise: Promise<string> | null = null;
    const resolveAPIKey = (agentName: string): Promise<string> => {
      if (configuredApiKey) return Promise.resolve(configuredApiKey);
      if (!registrationPromise) {
        registrationPromise = resolveSharedProvisionedAPIKey(
          effectiveApiUrl,
          provisionQueryParams,
          timeoutConfig,
          api.logger,
          () => registerTenant(agentName),
        ).catch((err) => {
          registrationPromise = null;
          throw err;
        });
      }
      return registrationPromise;
    };

    api.logger.info("[mem9] Server mode (v1alpha2)");

    if (!configuredApiKey && shouldEagerAutoProvision(cfg)) {
      api.logger.info("[mem9] apiKey not configured; starting auto-provision");
      void resolveAPIKey(hookAgentId).catch((err) => {
        api.logger.error(`[mem9] auto-provision failed: ${errorMessage(err)}`);
      });
    }

    const factory: ToolFactory = (ctx: ToolContext) => {
      const agentId = ctx.agentId ?? cfg.agentName ?? "agent";
      const backend = new LazyServerBackend(
        effectiveApiUrl,
        () => resolveAPIKey(agentId),
        agentId,
        timeoutConfig,
      );
      return buildTools(backend);
    };

    api.registerTool(factory, { names: toolNames });

    // Shared lazy backend for hooks and capability registration.
    const hookBackend = new LazyServerBackend(
      effectiveApiUrl,
      () => resolveAPIKey(hookAgentId),
      hookAgentId,
      timeoutConfig,
    );

    // Register memory capability so OpenClaw 2026.4.2+ binds this plugin to
    // the memory slot. Without this, the plugin is treated as a legacy
    // hook-only plugin and automatic context injection won't work.
    // Guard with typeof check for backward compatibility with older hosts.
    if (typeof api.registerCapability === "function") {
      api.registerCapability("memory", {
        search: async (query, opts) => {
          const result = await hookBackend.search({ q: query, limit: opts?.limit });
          return { data: result.data, total: result.total };
        },
        store: async (content, opts) => {
          return hookBackend.store({ content, tags: opts?.tags, source: opts?.source });
        },
        get: (id) => hookBackend.get(id),
        remove: (id) => hookBackend.remove(id),
      });
    }

    // Register hooks with lazy backend for lifecycle memory management.
    registerHooks(api, hookBackend, api.logger, {
      maxIngestBytes: cfg.maxIngestBytes,
      fallbackAgentId: hookAgentId,
    });
  },
};

const toolNames = [
  "memory_store",
  "memory_search",
  "memory_get",
  "memory_update",
  "memory_delete",
];

class LazyServerBackend implements MemoryBackend {
  private apiUrl: string;
  private apiKeyProvider: () => Promise<string>;
  private agentId: string;
  private timeouts: BackendTimeouts;
  private resolved: ServerBackend | null = null;
  private resolving: Promise<ServerBackend> | null = null;

  constructor(
    apiUrl: string,
    apiKeyProvider: () => Promise<string>,
    agentId: string,
    timeouts: BackendTimeouts,
  ) {
    this.apiUrl = apiUrl;
    this.apiKeyProvider = apiKeyProvider;
    this.agentId = agentId;
    this.timeouts = timeouts;
  }

  private async resolve(): Promise<ServerBackend> {
    if (this.resolved) return this.resolved;
    if (this.resolving) return this.resolving;

    this.resolving = this.apiKeyProvider().then((apiKey) =>
      Promise.resolve().then(() => {
        this.resolved = new ServerBackend(this.apiUrl, apiKey, this.agentId, {
          timeouts: this.timeouts,
        });
        return this.resolved;
      })
    ).catch((err) => {
      this.resolving = null; // allow retry on next call
      throw err;
    });

    return this.resolving;
  }

  async store(input: CreateMemoryInput) {
    return (await this.resolve()).store(input);
  }
  async search(input: SearchInput) {
    return (await this.resolve()).search(input);
  }
  async get(id: string) {
    return (await this.resolve()).get(id);
  }
  async update(id: string, input: UpdateMemoryInput) {
    return (await this.resolve()).update(id, input);
  }
  async remove(id: string) {
    return (await this.resolve()).remove(id);
  }
  async ingest(input: IngestInput): Promise<IngestResult> {
    return (await this.resolve()).ingest(input);
  }
}
export default mnemoPlugin;
