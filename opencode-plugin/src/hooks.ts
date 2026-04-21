import type { Hooks } from "@opencode-ai/plugin";
import type { MemoryBackend } from "./backend.js";
import { formatRecallBlock } from "./recall/format.js";
import { buildRecallQuery } from "./recall/query.js";

const MAX_RECALL_RESULTS = 8;
const MIN_RECALL_QUERY_LEN = 5;

type ChatMessageHook = NonNullable<Hooks["chat.message"]>;
type ChatMessageOutput = Parameters<ChatMessageHook>[1];

const latestPromptBySession = new Map<string, string>();

function extractLatestUserPrompt(parts: ChatMessageOutput["parts"]): string | null {
  const chunks: string[] = [];

  for (const part of parts) {
    if (part.type !== "text" || typeof part.text !== "string") {
      continue;
    }

    const text = part.text.trim();
    if (text) {
      chunks.push(text);
    }
  }

  return chunks.length > 0 ? chunks.join("\n\n") : null;
}

export function buildHooks(backend: MemoryBackend): Pick<
  Hooks,
  "chat.message" | "experimental.chat.system.transform"
> {
  return {
    "chat.message": async (input, output) => {
      const prompt = extractLatestUserPrompt(output.parts);

      if (!prompt) {
        latestPromptBySession.delete(input.sessionID);
        return;
      }

      latestPromptBySession.set(input.sessionID, prompt);
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) {
        return;
      }

      const latestPrompt = latestPromptBySession.get(input.sessionID);
      if (!latestPrompt) {
        return;
      }

      const query = buildRecallQuery(latestPrompt);
      if (query.length < MIN_RECALL_QUERY_LEN) {
        return;
      }

      try {
        const result = await backend.search({ q: query, limit: MAX_RECALL_RESULTS });
        const block = formatRecallBlock(result.memories);
        if (block) {
          output.system.push(block);
        }
      } catch {
        // Graceful degradation: recall failures must not block chat.
      }
    },
  };
}
