import type { MemoryBackend } from "./backend.js";
import { ServerBackend } from "./server-backend.js";
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
const MEM9_MEMORY_PATH_PREFIX = "mem9/";
const MEM9_MEMORY_PROVIDER = "mem9";

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

function buildMemoryPath(id: string): string {
  return `${MEM9_MEMORY_PATH_PREFIX}${id}`;
}

function normalizeMemoryLookup(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith(MEM9_MEMORY_PATH_PREFIX)
    ? trimmed.slice(MEM9_MEMORY_PATH_PREFIX.length)
    : trimmed;
}

function normalizeSnippet(text: string, maxLength = 240): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  if (flattened.length <= maxLength) {
    return flattened;
  }
  return `${flattened.slice(0, maxLength - 3)}...`;
}

function countLines(text: string): number {
  if (!text) {
    return 1;
  }
  return text.split(/\r?\n/).length;
}

function buildPromptSection(params: {
  availableTools: Set<string>;
  citationsMode?: string;
}): string[] {
  const hasMemorySearch = params.availableTools.has("memory_search");
  const hasMemoryGet = params.availableTools.has("memory_get");

  if (!hasMemorySearch && !hasMemoryGet) {
    return [];
  }

  let toolGuidance: string;
  if (hasMemorySearch && hasMemoryGet) {
    toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run `memory_search` with `query` (or legacy `q`), then use the returned `id` with `memory_get`. Hosts that prefer path-based recall may also pass `path=mem9/<id>` to `memory_get`. If low confidence after search, say you checked.";
  } else if (hasMemorySearch) {
    toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run `memory_search` with `query` (or legacy `q`) and answer from the matching results. If low confidence after search, say you checked.";
  } else {
    toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos that already point to a specific memory id: run `memory_get` with the memory `id`, or `path=mem9/<id>` on path-based hosts. If low confidence after reading it, say you checked.";
  }

  const lines = ["## Memory Recall", toolGuidance];
  if (params.citationsMode === "off") {
    lines.push(
      "Citations are disabled: do not mention mem9 ids or synthetic mem9 paths unless the user explicitly asks.",
    );
  } else {
    lines.push(
      "Citations: mention `mem9/<id>` when it helps the user verify a recalled memory.",
    );
  }
  lines.push("");
  return lines;
}

interface MemoryCapability {
  search: (query: string, opts?: { limit?: number }) => Promise<{ data: Memory[]; total: number }>;
  store: (content: string, opts?: { tags?: string[]; source?: string }) => Promise<unknown>;
  get: (id: string) => Promise<Memory | null>;
  remove: (id: string) => Promise<boolean>;
}

interface MemoryPromptSectionBuilder {
  (params: { availableTools: Set<string>; citationsMode?: string }): string[];
}

interface MemorySearchResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: "memory";
  citation?: string;
}

interface MemoryProviderStatus {
  backend: "builtin" | "qmd";
  provider: string;
  requestedProvider?: string;
  custom?: Record<string, unknown>;
}

interface MemorySearchManager {
  search: (
    query: string,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
  ) => Promise<MemorySearchResult[]>;
  readFile: (params: {
    relPath: string;
    from?: number;
    lines?: number;
  }) => Promise<{ text: string; path: string }>;
  status: () => MemoryProviderStatus;
  sync?: (params?: {
    reason?: string;
    force?: boolean;
    sessionFiles?: string[];
    progress?: (update: { completed: number; total: number; label?: string }) => void;
  }) => Promise<void>;
  probeEmbeddingAvailability: () => Promise<{ ok: boolean; error?: string }>;
  probeVectorAvailability: () => Promise<boolean>;
  close?: () => Promise<void>;
}

interface MemoryRuntime {
  getMemorySearchManager: (params: {
    cfg?: unknown;
    agentId: string;
    purpose?: "default" | "status";
  }) => Promise<{ manager: MemorySearchManager | null; error?: string }>;
  resolveMemoryBackendConfig: (params: { cfg?: unknown; agentId: string }) => {
    backend: "builtin" | "qmd";
    provider: string;
    requestedProvider?: string;
    custom?: Record<string, unknown>;
  };
  closeAllMemorySearchManagers?: () => Promise<void>;
}

interface MemorySlotCapability {
  promptBuilder?: MemoryPromptSectionBuilder;
  runtime?: MemoryRuntime;
  flushPlanResolver?: unknown;
  publicArtifacts?: unknown;
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
  registerMemoryCapability?: (capability: MemorySlotCapability) => void;
  registerMemoryPromptSection?: (builder: MemoryPromptSectionBuilder) => void;
  registerMemoryRuntime?: (runtime: MemoryRuntime) => void;
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

class Mem9MemorySearchManager implements MemorySearchManager {
  constructor(
    private backend: MemoryBackend,
    private apiUrl: string,
  ) {}

  async search(
    query: string,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
  ): Promise<MemorySearchResult[]> {
    void opts?.sessionKey;
    const result = await this.backend.search({
      q: query,
      limit: opts?.maxResults,
    });
    return (result.data ?? [])
      .map((memory, index) => {
        const startLine = 1;
        const endLine = countLines(memory.content);
        const score =
          typeof memory.score === "number"
            ? memory.score
            : Math.max(0, 1 - index / Math.max(result.data.length, 1));
        return {
          path: buildMemoryPath(memory.id),
          startLine,
          endLine,
          score,
          snippet: normalizeSnippet(memory.content),
          source: "memory" as const,
          citation: `${buildMemoryPath(memory.id)}#L${startLine}`,
        };
      })
      .filter((entry) => opts?.minScore == null || entry.score >= opts.minScore);
  }

  async readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ text: string; path: string }> {
    const lookup = normalizeMemoryLookup(params.relPath);
    const memory = await this.backend.get(lookup);
    if (!memory) {
      return { text: "", path: params.relPath };
    }

    const contentLines = memory.content.split(/\r?\n/);
    const fromLine = Math.max(1, params.from ?? 1);
    const lineCount = params.lines == null ? contentLines.length : Math.max(0, params.lines);
    const sliced =
      params.lines == null
        ? contentLines.slice(fromLine - 1)
        : contentLines.slice(fromLine - 1, fromLine - 1 + lineCount);

    return {
      text: sliced.join("\n"),
      path: buildMemoryPath(memory.id),
    };
  }

  status(): MemoryProviderStatus {
    return {
      backend: "builtin",
      provider: MEM9_MEMORY_PROVIDER,
      requestedProvider: MEM9_MEMORY_PROVIDER,
      custom: {
        mode: "remote",
        apiUrl: this.apiUrl,
      },
    };
  }

  async sync(): Promise<void> {}

  async probeEmbeddingAvailability(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.backend.search({ q: "mem9-healthcheck", limit: 1 });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async probeVectorAvailability(): Promise<boolean> {
    const probe = await this.probeEmbeddingAvailability();
    return probe.ok;
  }

  async close(): Promise<void> {}
}

function createMemoryRuntime(params: {
  apiUrl: string;
  fallbackAgentId: string;
  createBackend: (agentId: string) => MemoryBackend;
}): MemoryRuntime {
  const managers = new Map<string, Mem9MemorySearchManager>();

  const getOrCreateManager = (agentId: string): Mem9MemorySearchManager => {
    const resolvedAgentId = agentId.trim() || params.fallbackAgentId;
    const existing = managers.get(resolvedAgentId);
    if (existing) {
      return existing;
    }
    const next = new Mem9MemorySearchManager(
      params.createBackend(resolvedAgentId),
      params.apiUrl,
    );
    managers.set(resolvedAgentId, next);
    return next;
  };

  return {
    async getMemorySearchManager({ agentId }) {
      return { manager: getOrCreateManager(agentId) };
    },
    resolveMemoryBackendConfig() {
      return {
        backend: "builtin",
        provider: MEM9_MEMORY_PROVIDER,
        requestedProvider: MEM9_MEMORY_PROVIDER,
        custom: {
          mode: "remote",
          apiUrl: params.apiUrl,
        },
      };
    },
    async closeAllMemorySearchManagers() {
      for (const manager of managers.values()) {
        await manager.close?.();
      }
      managers.clear();
    },
  };
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
          query: {
            type: "string",
            description: "Search query alias for hosts that expect `query` instead of `q`",
          },
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
          const input = { ...((params ?? {}) as SearchInput) };
          if (!input.q && typeof (params as { query?: unknown } | null)?.query === "string") {
            input.q = (params as { query: string }).query;
          }
          const result = await backend.search(input);
          return jsonResult({
            ok: true,
            ...result,
            data: (result.data ?? []).map((memory) => ({
              ...memory,
              path: buildMemoryPath(memory.id),
            })),
          });
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
          path: {
            type: "string",
            description: "Memory lookup path alias, e.g. mem9/<id>",
          },
        },
        required: [],
      },
      async execute(_id: string, params: unknown) {
        try {
          const raw = params as { id?: string; path?: string };
          const lookup = typeof raw.id === "string" ? raw.id : raw.path;
          if (!lookup) {
            return jsonResult({ ok: false, error: "memory id or path is required" });
          }
          const id = normalizeMemoryLookup(lookup);
          const result = await backend.get(id);
          if (!result)
            return jsonResult({ ok: false, error: "memory not found" });
          return jsonResult({
            ok: true,
            data: {
              ...result,
              path: buildMemoryPath(result.id),
            },
          });
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
  // Static hint for hosts that inspect entry metadata before runtime registration.
  capabilities: ["memory"],

  register(api: OpenClawPluginApi) {
    const cfg = (api.pluginConfig ?? {}) as PluginConfig;
    const effectiveApiUrl = cfg.apiUrl ?? DEFAULT_API_URL;
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
      const backend = new ServerBackend(effectiveApiUrl, "", agentName);
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
        registrationPromise = registerTenant(agentName);
      }
      return registrationPromise;
    };

    api.logger.info("[mem9] Server mode (v1alpha2)");

    const hookAgentId = cfg.agentName ?? "agent";

    const createBackend = (agentId: string): MemoryBackend =>
      new LazyServerBackend(
        effectiveApiUrl,
        () => resolveAPIKey(agentId),
        agentId,
      );

    const factory: ToolFactory = (ctx: ToolContext) => {
      const agentId = ctx.agentId ?? cfg.agentName ?? "agent";
      const backend = createBackend(agentId);
      return buildTools(backend);
    };

    api.registerTool(factory, { names: toolNames });

    // Shared lazy backend for hooks and capability registration.
    const hookBackend = createBackend(hookAgentId);
    const memoryRuntime = createMemoryRuntime({
      apiUrl: effectiveApiUrl,
      fallbackAgentId: hookAgentId,
      createBackend,
    });

    // OpenClaw's memory slot API has evolved across versions:
    // - current hosts prefer registerMemoryCapability({ promptBuilder, runtime })
    // - 2026.4.2 uses registerMemoryPromptSection/registerMemoryRuntime
    // - older compatibility shims may still expose registerCapability("memory", ...)
    if (typeof api.registerMemoryCapability === "function") {
      api.registerMemoryCapability({
        promptBuilder: buildPromptSection,
        runtime: memoryRuntime,
      });
    } else {
      if (typeof api.registerMemoryPromptSection === "function") {
        api.registerMemoryPromptSection(buildPromptSection);
      }
      if (typeof api.registerMemoryRuntime === "function") {
        api.registerMemoryRuntime(memoryRuntime);
      }
    }

    if (
      typeof api.registerMemoryCapability !== "function" &&
      typeof api.registerMemoryRuntime !== "function" &&
      typeof api.registerCapability === "function"
    ) {
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
  private resolved: ServerBackend | null = null;
  private resolving: Promise<ServerBackend> | null = null;

  constructor(
    private apiUrl: string,
    private apiKeyProvider: () => Promise<string>,
    private agentId: string,
  ) {}

  private async resolve(): Promise<ServerBackend> {
    if (this.resolved) return this.resolved;
    if (this.resolving) return this.resolving;

    this.resolving = this.apiKeyProvider().then((apiKey) =>
      Promise.resolve().then(() => {
        this.resolved = new ServerBackend(this.apiUrl, apiKey, this.agentId);
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
