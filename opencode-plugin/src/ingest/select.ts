import type { IngestMessage } from "../backend.js";

const RELEVANT_MEMORIES_BLOCK_RE = /<relevant-memories>[\s\S]*?(<\/relevant-memories>|$)/g;
const MAX_INGEST_MESSAGES = 12;

function cleanMessageContent(content: string): string {
  return content.replace(RELEVANT_MEMORIES_BLOCK_RE, "").trim();
}

export function selectMessagesForIngest(messages: IngestMessage[]): IngestMessage[] {
  return messages
    .map((message) => ({
      ...message,
      content: cleanMessageContent(message.content),
    }))
    .filter((message) => message.content.length > 0)
    .slice(-MAX_INGEST_MESSAGES);
}
