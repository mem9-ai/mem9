import { tool } from "@opencode-ai/plugin";
import type { MemoryBackend } from "./backend.js";
import type { CreateMemoryInput, UpdateMemoryInput, SearchInput } from "./types.js";

/**
 * Build the 5 memory tools for OpenCode.
 * Returns a map of tool name → ToolDefinition.
 */
export function buildTools(backend: MemoryBackend): Record<string, ReturnType<typeof tool>> {
  return {
    memory_store: tool({
      description:
        "Store a memory. Returns the stored memory with its assigned id.",
      args: {
        content: tool.schema
          .string()
          .max(50000)
          .describe("Memory content (required, max 50000 chars)"),
        source: tool.schema
          .string()
          .optional()
          .describe("Which agent wrote this memory"),
        tags: tool.schema
          .array(tool.schema.string())
          .max(20)
          .optional()
          .describe("Filterable tags (max 20)"),
        metadata: tool.schema
          .record(tool.schema.string(), tool.schema.unknown())
          .optional()
          .describe("Arbitrary structured data"),
      },
      async execute(args) {
        try {
          const input: CreateMemoryInput = {
            content: args.content,
            source: args.source,
            tags: args.tags,
            metadata: args.metadata as Record<string, unknown> | undefined,
          };
          const result = await backend.store(input);
          return JSON.stringify({ ok: true, data: result });
        } catch (err) {
          return JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    }),

    memory_search: tool({
      description:
        "Search memories using hybrid vector + keyword search. Higher score = more relevant.",
      args: {
        q: tool.schema.string().optional().describe("Search query"),
        tags: tool.schema
          .string()
          .optional()
          .describe("Comma-separated tags to filter by (AND)"),
        source: tool.schema
          .string()
          .optional()
          .describe("Filter by source agent"),
        limit: tool.schema
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max results (default 20, max 200)"),
        offset: tool.schema
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Pagination offset"),
      },
      async execute(args) {
        try {
          const input: SearchInput = {
            q: args.q,
            tags: args.tags,
            source: args.source,
            limit: args.limit,
            offset: args.offset,
          };
          const result = await backend.search(input);
          return JSON.stringify({ ok: true, ...result });
        } catch (err) {
          return JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    }),

    memory_get: tool({
      description: "Retrieve a single memory by its id.",
      args: {
        id: tool.schema.string().describe("Memory id (UUID)"),
      },
      async execute(args) {
        try {
          const result = await backend.get(args.id);
          if (!result) {
            return JSON.stringify({ ok: false, error: "memory not found" });
          }
          return JSON.stringify({ ok: true, data: result });
        } catch (err) {
          return JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    }),

    memory_update: tool({
      description:
        "Update an existing memory. Only provided fields are changed.",
      args: {
        id: tool.schema.string().describe("Memory id to update"),
        content: tool.schema.string().optional().describe("New content"),
        source: tool.schema.string().optional().describe("New source"),
        tags: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe("Replacement tags"),
        metadata: tool.schema
          .record(tool.schema.string(), tool.schema.unknown())
          .optional()
          .describe("Replacement metadata"),
      },
      async execute(args) {
        try {
          const { id, ...rest } = args;
          const input: UpdateMemoryInput = {
            content: rest.content,
            source: rest.source,
            tags: rest.tags,
            metadata: rest.metadata as Record<string, unknown> | undefined,
          };
          const result = await backend.update(id, input);
          if (!result) {
            return JSON.stringify({ ok: false, error: "memory not found" });
          }
          return JSON.stringify({ ok: true, data: result });
        } catch (err) {
          return JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    }),

    memory_delete: tool({
      description: "Delete a memory by id.",
      args: {
        id: tool.schema.string().describe("Memory id to delete"),
      },
      async execute(args) {
        try {
          const deleted = await backend.remove(args.id);
          if (!deleted) {
            return JSON.stringify({ ok: false, error: "memory not found" });
          }
          return JSON.stringify({ ok: true });
        } catch (err) {
          return JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    }),
  };
}
