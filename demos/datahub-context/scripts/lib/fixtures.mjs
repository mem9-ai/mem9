import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const demoRoot = fileURLToPath(new URL("../..", import.meta.url));
export const demoDataPath = fileURLToPath(
  new URL("../../fixtures/demo-data.json", import.meta.url),
);

export async function loadDemoData() {
  const raw = await readFile(demoDataPath, "utf8");
  return JSON.parse(raw);
}

export function seedMemoriesFromDemoData(data, config) {
  const now = "2026-06-11T00:00:00.000Z";
  return data.seed_memories.map((memory, index) => ({
    id: `fixture-memory-${index + 1}`,
    content: memory.content,
    memory_type: "pinned",
    source: "manual",
    tags: memory.tags,
    metadata: {
      ...memory.metadata,
      seeded_by: "datahub-context-demo",
    },
    agent_id: config.agentID,
    appId: config.appID,
    state: "active",
    version: 1,
    created_at: now,
    updated_at: now,
  }));
}

export function fixtureRecallEnvelope(data, config, includeDataHub) {
  const memories = seedMemoriesFromDemoData(data, config);
  const response = {
    memories,
    external_context: includeDataHub ? data.external_context : [],
    total: memories.length,
    limit: 5,
    offset: 0,
  };
  return {
    mode: "fixture",
    include_datahub: includeDataHub,
    prompt: data.story.prompt,
    response,
    answer: includeDataHub ? data.answers.enriched : data.answers.mem9_only,
    captured_at: new Date().toISOString(),
  };
}

export function buildAnswerFromResponse(data, response, includeDataHub) {
  if (!includeDataHub || !Array.isArray(response.external_context) || response.external_context.length === 0) {
    return data.answers.mem9_only;
  }
  return data.answers.enriched;
}

export function requiredExternalContextTypes(data) {
  return new Set(data.external_context.map((item) => item.type));
}
