import type { IngestInput, IngestResult, MemoryBackend } from "../backend.ts";
import type { DebugLogger } from "../debug.ts";
import { selectMessagesForIngest } from "./select.ts";

export interface SubmitIngestOptions {
  backend: MemoryBackend;
  messages: IngestInput["messages"];
  sessionID: string;
  agentID: string;
  debugLogger?: DebugLogger;
}

export async function submitMessagesForIngest(
  options: SubmitIngestOptions,
): Promise<IngestResult | null> {
  const selectedMessages = selectMessagesForIngest(options.messages);
  if (selectedMessages.length === 0) {
    await options.debugLogger?.("ingest.skip", {
      sessionID: options.sessionID,
      agentID: options.agentID,
      reason: "empty_selection",
    });
    return null;
  }

  const input: IngestInput = {
    messages: selectedMessages,
    session_id: options.sessionID,
    agent_id: options.agentID,
    mode: "smart",
  };

  await options.debugLogger?.("ingest.request", {
    sessionID: options.sessionID,
    agentID: options.agentID,
    messages: selectedMessages,
  });

  try {
    const result = await options.backend.ingest(input);
    await options.debugLogger?.("ingest.result", {
      sessionID: options.sessionID,
      agentID: options.agentID,
      result,
    });
    return result;
  } catch (error) {
    await options.debugLogger?.("ingest.error", {
      sessionID: options.sessionID,
      agentID: options.agentID,
      error: error instanceof Error ? error.message : String(error),
      messages: selectedMessages,
    });
    throw error;
  }
}
