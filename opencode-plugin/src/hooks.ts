import type { Hooks } from "@opencode-ai/plugin";
import type { MemoryBackend } from "./backend.js";
import type { Memory } from "./types.js";

const MAX_RECENT = 10;
const AUTO_CAPTURE_SOURCE = "opencode-auto";

/**
 * Format memories into a system prompt block.
 * Matches the ccplugin SessionStart format.
 */
function formatMemoriesBlock(memories: Memory[]): string {
  if (memories.length === 0) return "";

  const lines = memories.map((m, i) => {
    const tags = m.tags?.length ? ` [${m.tags.join(", ")}]` : "";
    const date = m.updated_at ? ` (${m.updated_at})` : "";
    return `${i + 1}. ${m.content.slice(0, 500)}${tags}${date}`;
  });

  return [
    "",
    "---",
    "[mnemo] Shared agent memory — recent entries:",
    ...lines,
    "",
    "Use memory_store/memory_search/memory_update/memory_delete tools to manage shared memories.",
    "---",
    "",
  ].join("\n");
}

/**
 * Build hooks for the OpenCode plugin.
 *
 * - `experimental.chat.system.transform`: Inject recent memories into system prompt.
 * - `event`: Listen for `session.idle` to auto-capture the last assistant response.
 */
export function buildHooks(backend: MemoryBackend): Pick<
  Hooks,
  "event" | "experimental.chat.system.transform"
> {
  return {
    /**
     * Inject memories into the system prompt.
     */
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        const memories = await backend.listRecent(MAX_RECENT);
        const block = formatMemoriesBlock(memories);
        if (block) {
          output.system.push(block);
        }
      } catch {
        // Graceful degradation — if memory fetch fails, continue without it.
      }
    },

    /**
     * Listen for session.idle events to auto-capture important context.
     * Since the plugin SDK doesn't expose session messages directly,
     * we store a marker to indicate the session ended.
     * The actual auto-capture is best-effort.
     */
    event: async ({ event }) => {
      if (event.type !== "session.idle") return;

      try {
        const sessionID = event.properties.sessionID;
        // Store a lightweight session-end marker so we know this session happened.
        // The real value comes from the agent explicitly using memory_store during the session.
        // This auto-capture is a safety net.
        await backend.store({
          content: `[auto] Session ${sessionID} completed.`,
          source: AUTO_CAPTURE_SOURCE,
          tags: ["auto-capture", "session-end"],
        });
      } catch {
        // Best-effort — don't fail the session on memory save errors.
      }
    },
  };
}
