import type { PluginInput } from "@opencode-ai/plugin";
import type { IngestMessage } from "./backend.ts";

const SESSION_TRANSCRIPT_FETCH_LIMIT = 24;

interface TranscriptPartLike {
  type: string;
  text?: string;
  synthetic?: boolean;
  ignored?: boolean;
}

export type SessionTranscriptLoader = (sessionID: string) => Promise<IngestMessage[]>;

function extractMessageText(parts: TranscriptPartLike[]): string {
  const chunks: string[] = [];

  for (const part of parts) {
    if (part.type !== "text" || typeof part.text !== "string") {
      continue;
    }

    if (part.synthetic === true || part.ignored === true) {
      continue;
    }

    const text = part.text.trim();
    if (text) {
      chunks.push(text);
    }
  }

  return chunks.join("\n\n");
}

export function createSessionTranscriptLoader(
  client: PluginInput["client"],
): SessionTranscriptLoader {
  return async (sessionID: string): Promise<IngestMessage[]> => {
    const response = await client.session.messages({
      path: { id: sessionID },
      query: { limit: SESSION_TRANSCRIPT_FETCH_LIMIT },
      throwOnError: true,
    });
    const messages = response.data;

    return messages.flatMap((entry): IngestMessage[] => {
      if (entry.info.role !== "user" && entry.info.role !== "assistant") {
        return [];
      }

      const content = extractMessageText(entry.parts);
      if (!content) {
        return [];
      }

      return [
        {
          role: entry.info.role,
          content,
        },
      ];
    });
  };
}
