import { createDemoServer } from "./serve-demo.mjs";
import { parseArgs, readDemoConfig, hasServerConfig } from "./lib/config.mjs";

const HOST = "127.0.0.1";

async function smoke(options = {}) {
  const configInput = readDemoConfig(options);
  const strict = Boolean(options.strict);
  if (strict && !hasServerConfig(configInput)) {
    throw new Error("strict smoke requires MEM9_DEMO_API_KEY");
  }

  const server = await createDemoServer();
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseURL = `http://${HOST}:${port}`;

  try {
    const html = await text(`${baseURL}/`);
    assert(html.includes("Slack turn evidence panel"), "page title rendered");
    assert(html.includes("id=\"run-both\""), "run button rendered");
    assert(html.includes("id=\"datahub-list\""), "DataHub lane rendered");

    const config = await json(`${baseURL}/api/config`);
    if (strict) {
      assert(config.mode === "server-backed", "strict mode requires server-backed config");
    } else {
      assert(config.mode === "fixture", "fixture mode is default without API key");
    }

    const baseline = await json(`${baseURL}/api/recall?include_datahub=false`);
    const enriched = await json(`${baseURL}/api/recall?include_datahub=true`);
    assert((baseline.response.external_context ?? []).length === 0, "baseline suppresses DataHub context");
    assert((enriched.response.external_context ?? []).length >= 4, "enriched response includes DataHub context");
    assert(JSON.stringify(enriched.response.external_context).includes("LINEAGE_UPSTREAM"), "upstream lineage appears in raw JSON");
    if (strict) {
      assert(baseline.mode === "server-backed", "baseline recall stays server-backed");
      assert(enriched.mode === "server-backed", "enriched recall stays server-backed");
      assert(!enriched.fallback_error, "strict mode rejects fixture fallback");
    }

    console.log(`ok smoke - ${strict ? "server-backed" : "fixture"} recall is presentation-ready`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function text(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}`);
  }
  return response.text();
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}`);
  }
  return response.json();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`smoke check failed: ${message}`);
  }
}

smoke(parseArgs()).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
