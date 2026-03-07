import type { MemoryBackend } from "./backend.js";
import { ServerBackend } from "./server-backend.js";
import { registerHooks } from "./hooks.js";
import { runBootstrapImport } from "./init.js";
import type {
  PluginConfig,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
  IngestInput,
  IngestResult,
} from "./types.js";

const DEFAULT_API_URL = "https://api.mem9.ai";

function jsonResult(data: unknown) {
  return data;
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
  id: "mnemo",
  name: "Mnemo Memory",
  description:
    "AI agent memory — server mode (mnemo-server) with hybrid vector + keyword search.",

  async register(api: OpenClawPluginApi) {
    const cfg = (api.pluginConfig ?? {}) as PluginConfig;
    const effectiveApiUrl = cfg.apiUrl ?? DEFAULT_API_URL;
    if (!cfg.apiUrl) {
      api.logger.info(`[mnemo] apiUrl not configured, using default ${DEFAULT_API_URL}`);
    }

    try {
      await runBootstrapImport(api.logger);
    } catch (err) {
      api.logger.error(
        `[mnemo] init: bootstrap import failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const configuredTenantID = cfg.tenantID;
    const registerTenant = async (agentName: string): Promise<string> => {
      const backend = new ServerBackend(effectiveApiUrl, "", agentName);
      const result = await backend.register();
      const claimUrl = result.claim_url ?? "(not provided)";
      api.logger.info(
        `[mnemo] *** Auto-provisioned tenant_id=${result.id} *** Save this tenant ID to your config as tenantID`
      );
      api.logger.info(
        `[mnemo] Claim your TiDB instance at: ${claimUrl}`
      );
      return result.id;
    };
    let registrationPromise: Promise<string> | null = null;
    const resolveTenantID = (agentName: string): Promise<string> => {
      if (configuredTenantID) return Promise.resolve(configuredTenantID);
      if (!registrationPromise) {
        registrationPromise = registerTenant(agentName);
      }
      return registrationPromise;
    };

    api.logger.info("[mnemo] Server mode (tenant-scoped mem9 API)");

    const factory: ToolFactory = (ctx: ToolContext) => {
      const agentId = ctx.agentId ?? cfg.agentName ?? "agent";
      const backend = new LazyServerBackend(
        effectiveApiUrl,
        () => resolveTenantID(agentId),
        agentId,
      );
      return buildTools(backend);
    };

    api.registerTool(factory, { names: toolNames });

    // Register hooks with a lazy backend for lifecycle memory management.
    // Uses the default workspace/agent context for hook-triggered operations.
    const hookBackend = new LazyServerBackend(
      effectiveApiUrl,
      () => resolveTenantID(cfg.agentName ?? "agent"),
      cfg.agentName ?? "agent",
    );
    registerHooks(api, hookBackend, api.logger, { maxIngestBytes: cfg.maxIngestBytes });
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
    private tenantIDProvider: () => Promise<string>,
    private agentId: string,
  ) {}

  private async resolve(): Promise<ServerBackend> {
    if (this.resolved) return this.resolved;
    if (this.resolving) return this.resolving;

    this.resolving = this.tenantIDProvider().then((tenantID) =>
      Promise.resolve().then(() => {
        this.resolved = new ServerBackend(this.apiUrl, tenantID, this.agentId);
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
