import { MnemoClient } from "./api-client";
import type { CreateMemoryInput, SearchInput, UpdateMemoryInput } from "./api-client";

// jsonResult is expected from openclaw/plugin-sdk
function jsonResult(data: unknown) {
  return data;
}

interface PluginConfig {
  apiUrl: string;
  apiToken: string;
}

interface OpenClawPluginApi {
  pluginConfig?: unknown;
  logger: { error: (...args: unknown[]) => void };
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

function buildTools(client: MnemoClient): AnyAgentTool[] {
  return [
    {
      name: "memory_store",
      label: "Store Memory",
      description:
        "Store a memory in the shared mnemo space. If a key is provided and already exists, the memory is updated (upsert). Returns the stored memory with its assigned id.",
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
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Filterable tags (max 20)",
          },
        },
        required: ["content"],
      },
      async execute(_id: string, params: unknown) {
        try {
          const input = params as CreateMemoryInput;
          const result = await client.store(input);
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
        "Search shared memories by keyword, tags, source, or key. Returns paginated results ordered by most recently updated.",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Keyword search query" },
          tags: {
            type: "string",
            description: "Comma-separated tags to filter by (AND logic)",
          },
          source: { type: "string", description: "Filter by source agent" },
          key: { type: "string", description: "Filter by key name" },
          limit: {
            type: "number",
            description: "Max results (default 50, max 200)",
          },
          offset: { type: "number", description: "Pagination offset" },
        },
        required: [],
      },
      async execute(_id: string, params: unknown) {
        try {
          const input = (params ?? {}) as SearchInput;
          const result = await client.search(input);
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
          const result = await client.getById(id);
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
        "Update an existing memory. Only provided fields are changed. Version is auto-incremented.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory id to update" },
          content: { type: "string", description: "New content" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Replacement tags",
          },
        },
        required: ["id"],
      },
      async execute(_id: string, params: unknown) {
        try {
          const { id, ...input } = params as { id: string } & UpdateMemoryInput;
          const result = await client.update(id, input);
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
          await client.remove(id);
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
    "Shared multi-agent memory via mnemo-server. Provides memory_store, memory_search, memory_get, memory_update, and memory_delete tools.",

  register(api: OpenClawPluginApi) {
    const cfg = (api.pluginConfig ?? {}) as PluginConfig;

    if (!cfg.apiUrl || !cfg.apiToken) {
      api.logger.error(
        "[mnemo] Missing apiUrl or apiToken in plugin config. Plugin disabled."
      );
      return;
    }

    const client = new MnemoClient(cfg);
    const tools = buildTools(client);

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
