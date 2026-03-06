import type { MemoryBackend } from "./backend.js";
import { ServerBackend } from "./server-backend.js";
import { registerHooks } from "./hooks.js";
import type {
  PluginConfig,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
  IngestInput,
  IngestResult,
} from "./types.js";

function jsonResult(data: unknown) {
  return data;
}

function hashWorkspaceDir(dir: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < dir.length; i++) {
    h ^= dir.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") +
    ((h >>> 0) ^ dir.length).toString(16).padStart(8, "0");
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

async function provisionSpaceToken(
  apiUrl: string,
  userToken: string,
  workspaceKey: string,
  agentId: string,
): Promise<string> {
  const url = apiUrl.replace(/\/+$/, "") + "/api/spaces/provision";
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspace_key: workspaceKey, agent_id: agentId }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`provision failed (${resp.status}): ${body}`);
  }
  const data = (await resp.json()) as { space_token: string };
  return data.space_token;
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

  register(api: OpenClawPluginApi) {
    const cfg = (api.pluginConfig ?? {}) as PluginConfig;

    if (!cfg.apiUrl) {
      api.logger.error(
        "[mnemo] No apiUrl configured. Set apiUrl in plugin config. Plugin disabled."
      );
      return;
    }

    const configuredToken = cfg.apiToken ?? cfg.userToken;
    const registerTenant = async (agentName: string): Promise<string> => {
      const tenantName = cfg.tenantName ?? `${agentName}-tenant`;
      const backend = new ServerBackend(cfg.apiUrl!, "", agentName);
      const result = await backend.register(tenantName);
      const claimUrl = result.claim_url ?? "unknown";
      api.logger.info(
        `[mnemo] Auto-registered tenant: ${result.tenant_id}, claim your TiDB instance at: ${claimUrl}`
      );
      return result.token;
    };
    let registrationPromise: Promise<string> | null = null;
    const resolveTenantToken = (agentName: string): Promise<string> => {
      if (configuredToken) return Promise.resolve(configuredToken);
      if (!registrationPromise) {
        registrationPromise = registerTenant(agentName);
      }
      return registrationPromise;
    };

    api.logger.info("[mnemo] Server mode (workspace isolation)");
    const spaceTokenCache = new Map<string, string>();

    const factory: ToolFactory = (ctx: ToolContext) => {
      const agentId = ctx.agentId ?? cfg.agentName ?? "agent";
      const workspaceDir = ctx.workspaceDir ?? "default";
      const cacheKey = `${workspaceDir}::${agentId}`;

      const cached = spaceTokenCache.get(cacheKey);
      if (cached) {
        return buildTools(new ServerBackend(cfg.apiUrl!, cached, agentId));
      }

      const workspaceKey = hashWorkspaceDir(workspaceDir);
      const backend = new LazyServerBackend(
        cfg.apiUrl!,
        () => resolveTenantToken(agentId),
        workspaceKey,
        agentId,
        spaceTokenCache,
        cacheKey,
      );
      return buildTools(backend);
    };

    api.registerTool(factory, { names: toolNames });

    // Register hooks with a lazy backend for lifecycle memory management.
    // Uses the default workspace/agent context for hook-triggered operations.
    const hookBackend = new LazyServerBackend(
      cfg.apiUrl!,
      () => resolveTenantToken(cfg.agentName ?? "agent"),
      hashWorkspaceDir("default"),
      cfg.agentName ?? "agent",
      spaceTokenCache,
      "default::" + (cfg.agentName ?? "agent"),
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
    private tokenProvider: () => Promise<string>,
    private workspaceKey: string,
    private agentId: string,
    private cache: Map<string, string>,
    private cacheKey: string,
  ) {}

  private async resolve(): Promise<ServerBackend> {
    if (this.resolved) return this.resolved;
    if (this.resolving) return this.resolving;

    this.resolving = this.tokenProvider().then((tenantToken) =>
      provisionSpaceToken(
        this.apiUrl,
        tenantToken,
        this.workspaceKey,
        this.agentId,
      ).then((spaceToken) => {
        this.cache.set(this.cacheKey, spaceToken);
        this.resolved = new ServerBackend(this.apiUrl, spaceToken, this.agentId);
        return this.resolved;
      })
    );

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
