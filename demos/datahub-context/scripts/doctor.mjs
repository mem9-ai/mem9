import { parseArgs, readDemoConfig, hasServerConfig } from "./lib/config.mjs";
import { loadDemoData, requiredExternalContextTypes, fixtureRecallEnvelope } from "./lib/fixtures.mjs";
import { Mem9Client } from "./lib/mem9-client.mjs";
import { handleMCPPayload } from "./fixture-datahub-mcp.mjs";

const REQUIRED_CONTEXT_TYPES = new Set([
  "DATASET",
  "DASHBOARD",
  "LINEAGE_UPSTREAM",
  "LINEAGE_DOWNSTREAM",
]);

async function doctor(options = {}) {
  const config = readDemoConfig(options);
  const data = await loadDemoData();
  const checks = [];

  checks.push(check("node", Number(process.versions.node.split(".")[0]) >= 18, `Node ${process.versions.node}`));
  checks.push(check("fixtures.seed_memories", data.seed_memories.length >= 4, `${data.seed_memories.length} seed memories`));

  const types = requiredExternalContextTypes(data);
  for (const requiredType of REQUIRED_CONTEXT_TYPES) {
    checks.push(check(`fixtures.external_context.${requiredType}`, types.has(requiredType), "required for town hall evidence"));
  }

  const fixtureOnly = fixtureRecallEnvelope(data, config, false);
  const fixtureEnriched = fixtureRecallEnvelope(data, config, true);
  checks.push(check("fixture.mem9_only", fixtureOnly.response.external_context.length === 0, "DataHub suppressed"));
  checks.push(check("fixture.enriched", fixtureEnriched.response.external_context.length >= 4, `${fixtureEnriched.response.external_context.length} context items`));

  const mcpInitialize = handleMCPPayload({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, data);
  const mcpSearch = handleMCPPayload({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "search", arguments: { query: "/q revenue dashboard" } },
  }, data);
  checks.push(check("fixture_mcp.initialize", Boolean(mcpInitialize.result?.protocolVersion), "JSON-RPC initialize"));
  checks.push(check("fixture_mcp.search", mcpSearch.result?.content?.length > 0, "search tool result"));

  if (hasServerConfig(config)) {
    const client = new Mem9Client(config);
    const status = await serverChecks(client, config).catch((error) => ({
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }));
    checks.push(check("server.mem9", status.ok, status.detail));
  } else {
    checks.push(check("server.mem9", true, "not configured; fixture mode ready"));
  }

  for (const item of checks) {
    console.log(`${item.ok ? "ok" : "fail"} ${item.name} - ${item.detail}`);
  }

  const failed = checks.filter((item) => !item.ok);
  if (failed.length > 0 || (options.strict && !hasServerConfig(config))) {
    if (options.strict && !hasServerConfig(config)) {
      console.error("strict mode requires MEM9_DEMO_API_KEY");
    }
    process.exitCode = 1;
  }
}

async function serverChecks(client, config) {
  const list = await client.listMemories({ limit: 1, agent_id: config.agentID });
  const mem9Only = await client.recall(config.prompt, false);
  const enriched = await client.recall(config.prompt, true);
  const externalCount = Array.isArray(enriched.external_context)
    ? enriched.external_context.length
    : 0;
  const detail = `list ok, mem9-only=${mem9Only.memories?.length ?? 0}, external_context=${externalCount}`;
  return {
    ok: Array.isArray(list.memories) && externalCount > 0,
    detail,
  };
}

function check(name, ok, detail) {
  return { name, ok: Boolean(ok), detail };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  doctor(parseArgs()).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
