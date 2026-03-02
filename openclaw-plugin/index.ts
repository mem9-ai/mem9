import type { MemoryBackend } from "./backend.js";
import { DirectBackend } from "./direct-backend.js";
import { ServerBackend } from "./server-backend.js";
import { createEmbedder } from "./embedder.js";
import type {
  PluginConfig,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchInput,
} from "./types.js";

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
    factory: () => AnyAgentTool[],
    opts: { names: string[] }
  ) => void;
}

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

function createBackend(
  cfg: PluginConfig,
  logger: OpenClawPluginApi["logger"]
): MemoryBackend | null {
  // Direct mode: host present
  if (cfg.host) {
    if (!cfg.username || !cfg.password) {
      logger.error(
        "[mnemo] Direct mode requires host, username, and password. Plugin disabled."
      );
      return null;
    }
    const embedder = createEmbedder(cfg.embedding);
    const mode = embedder ? "hybrid search" : "keyword-only";
    logger.info(`[mnemo] Direct mode (${mode})`);
    return new DirectBackend(
      cfg.host,
      cfg.username,
      cfg.password,
      cfg.database ?? "mnemos",
      embedder
    );
  }

  // Server mode: apiUrl present
  if (cfg.apiUrl) {
    if (!cfg.apiToken) {
      logger.error(
        "[mnemo] Server mode requires apiUrl and apiToken. Plugin disabled."
      );
      return null;
    }
    logger.info("[mnemo] Server mode");
    return new ServerBackend(cfg.apiUrl, cfg.apiToken);
  }

  logger.error(
    "[mnemo] No mode configured. Set host (direct) or apiUrl (server). Plugin disabled."
  );
  return null;
}

function buildTools(backend: MemoryBackend): AnyAgentTool[] {
  return [
    {
      name: "memory_store",
      label: "Store Memory",
      description:
        "Store a memory. If a key is provided and already exists, the memory is updated (upsert). Returns the stored memory with its assigned id.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Memory content (required, max 50000 chars)",
          },
          key: {
            type: "string",
            description: "Optional named key for upsert-style lookup",
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
        "Search memories using hybrid vector + keyword search when an embedding provider " +
        "is configured, otherwise keyword-only. Higher score = more relevant.",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Search query" },
          tags: {
            type: "string",
            description: "Comma-separated tags to filter by (AND)",
          },
          source: { type: "string", description: "Filter by source agent" },
          key: { type: "string", description: "Filter by key name" },
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
          key: { type: "string", description: "New key name" },
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
    "AI agent memory — direct (TiDB Serverless) or server (mnemo-server) mode with hybrid vector + keyword search.",

  register(api: OpenClawPluginApi) {
    const cfg = (api.pluginConfig ?? {}) as PluginConfig;
    const backend = createBackend(cfg, api.logger);
    if (!backend) return;

    const tools = buildTools(backend);
    api.registerTool(() => tools, {
      names: [
        "memory_store",
        "memory_search",
        "memory_get",
        "memory_update",
        "memory_delete",
      ],
    });
  },
};

export default mnemoPlugin;
