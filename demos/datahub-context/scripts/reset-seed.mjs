import { parseArgs, readDemoConfig, hasServerConfig } from "./lib/config.mjs";
import { loadDemoData } from "./lib/fixtures.mjs";
import { Mem9Client, listDemoMemories } from "./lib/mem9-client.mjs";

export async function resetSeed(options = {}) {
  const config = readDemoConfig(options);
  if (!hasServerConfig(config)) {
    throw new Error("MEM9_DEMO_API_KEY is required for reset-seed");
  }

  const data = await loadDemoData();
  const client = new Mem9Client(config);
  const existing = await listDemoMemories(client, config);
  const deleteIDs = existing.map((memory) => memory.id).filter(Boolean);
  let deleted = 0;

  if (!options.keepExisting && deleteIDs.length > 0) {
    for (let index = 0; index < deleteIDs.length; index += 1000) {
      const chunk = deleteIDs.slice(index, index + 1000);
      const result = await client.batchDelete(chunk);
      deleted += Number(result?.deleted ?? chunk.length);
    }
  }

  const created = [];
  if (!options.dryRun) {
    for (const memory of data.seed_memories) {
      const createdMemory = await client.createPinnedMemory({
        content: memory.content,
        tags: uniqueTags([...memory.tags, config.demoTag]),
        metadata: {
          ...memory.metadata,
          demo_slug: config.appID,
          seeded_by: "datahub-context-demo",
          seeded_at: new Date().toISOString(),
        },
      });
      created.push(createdMemory);
    }
  }

  return {
    mode: "server-backed",
    base_url: config.baseURL,
    agent_id: config.agentID,
    app_id: config.appID,
    demo_tag: config.demoTag,
    found_existing: existing.length,
    deleted,
    created: created.length,
    created_ids: created.map((memory) => memory.id).filter(Boolean),
  };
}

function uniqueTags(tags) {
  return [...new Set(tags.filter(Boolean))];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  resetSeed(args)
    .then((summary) => {
      if (args.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(`Reset complete for ${summary.agent_id} at ${summary.base_url}`);
        console.log(`Existing demo memories: ${summary.found_existing}`);
        console.log(`Deleted: ${summary.deleted}`);
        console.log(`Created: ${summary.created}`);
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
