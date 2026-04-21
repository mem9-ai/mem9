import type { Hooks } from "@opencode-ai/plugin";
import type { MemoryBackend } from "./backend.js";
import { formatRecallBlock } from "./recall/format.js";
import { buildRecallQuery } from "./recall/query.js";

const MAX_RECALL_RESULTS = 8;
const MIN_RECALL_QUERY_LEN = 5;
const PROMPT_CACHE_MAX_ENTRIES = 100;
const PROMPT_CACHE_TTL_MS = 15 * 60 * 1000;

type ChatMessageHook = NonNullable<Hooks["chat.message"]>;
type ChatMessageOutput = Parameters<ChatMessageHook>[1];

interface PromptCacheEntry {
  prompt: string;
  updatedAt: number;
}

function extractLatestUserPrompt(parts: ChatMessageOutput["parts"]): string | null {
  const chunks: string[] = [];

  for (const part of parts) {
    if (part.type !== "text" || typeof part.text !== "string") {
      continue;
    }

    const synthetic = "synthetic" in part && part.synthetic === true;
    const ignored = "ignored" in part && part.ignored === true;
    if (synthetic || ignored) {
      continue;
    }

    const text = part.text.trim();
    if (text) {
      chunks.push(text);
    }
  }

  return chunks.length > 0 ? chunks.join("\n\n") : null;
}

function prunePromptCache(cache: Map<string, PromptCacheEntry>, now: number): void {
  for (const [sessionID, entry] of cache.entries()) {
    if (now - entry.updatedAt > PROMPT_CACHE_TTL_MS) {
      cache.delete(sessionID);
    }
  }

  while (cache.size > PROMPT_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) {
      break;
    }
    cache.delete(oldest);
  }
}

export function buildHooks(backend: MemoryBackend): Pick<
  Hooks,
  "chat.message" | "experimental.chat.system.transform"
> {
  const latestPromptBySession = new Map<string, PromptCacheEntry>();

  return {
    "chat.message": async (input, output) => {
      const now = Date.now();
      prunePromptCache(latestPromptBySession, now);

      const prompt = extractLatestUserPrompt(output.parts);

      if (!prompt) {
        latestPromptBySession.delete(input.sessionID);
        return;
      }

      latestPromptBySession.delete(input.sessionID);
      latestPromptBySession.set(input.sessionID, {
        prompt,
        updatedAt: now,
      });
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) {
        return;
      }

      prunePromptCache(latestPromptBySession, Date.now());

      const cachedPrompt = latestPromptBySession.get(input.sessionID);
      if (!cachedPrompt) {
        return;
      }

      const query = buildRecallQuery(cachedPrompt.prompt);
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
