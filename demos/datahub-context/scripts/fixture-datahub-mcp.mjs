import http from "node:http";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./lib/config.mjs";
import { loadDemoData } from "./lib/fixtures.mjs";

const PROTOCOL_VERSION = "2025-03-26";

export function createFixtureMCPServer(data) {
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      writeJSON(res, 200, { ok: true, service: "fixture-datahub-mcp" });
      return;
    }
    if (req.method !== "POST") {
      writeJSON(res, 405, rpcError(null, -32600, "method not allowed"));
      return;
    }

    try {
      const payload = JSON.parse(await readBody(req));
      const response = handleMCPPayload(payload, data);
      if (response.accepted) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.setHeader("Mcp-Session-Id", "mem9-datahub-demo-session");
      writeJSON(res, 200, response);
    } catch (error) {
      writeJSON(res, 400, rpcError(null, -32700, error instanceof Error ? error.message : String(error)));
    }
  });
}

export function handleMCPPayload(payload, data) {
  const id = payload.id ?? null;
  switch (payload.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: { name: "mem9-datahub-demo-fixture", version: "0.1.0" },
          capabilities: { tools: {} },
        },
      };
    case "notifications/initialized":
      return { accepted: true };
    case "tools/call":
      return {
        jsonrpc: "2.0",
        id,
        result: toolResult(payload.params, data),
      };
    default:
      return rpcError(id, -32601, `unknown method ${payload.method}`);
  }
}

function toolResult(params = {}, data) {
  switch (params.name) {
    case "search":
      return textToolResult({
        searchResults: [
          { entity: entityByID(data, "urn:li:dataset:(snowflake,mart.revenue,PROD)") },
          { entity: entityByID(data, "urn:li:dashboard:(looker,executive_revenue)") },
        ],
        returned: 2,
        hasMore: false,
      });
    case "get_entities":
      return textToolResult({
        entities: Object.fromEntries(
          (params.arguments?.urns ?? [])
            .map((urn) => [urn, entityByID(data, urn)])
            .filter(([, entity]) => entity),
        ),
      });
    case "get_lineage": {
      const upstream = Boolean(params.arguments?.upstream);
      const lineage = upstream
        ? data.external_context.find((item) => item.type === "LINEAGE_UPSTREAM")?.metadata
        : data.external_context.find((item) => item.type === "LINEAGE_DOWNSTREAM")?.metadata;
      return textToolResult(lineage ?? {});
    }
    default:
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `unknown tool ${params.name}` }),
          },
        ],
        isError: true,
      };
  }
}

function entityByID(data, id) {
  const item = data.external_context.find((candidate) => candidate.id === id);
  if (!item) {
    return null;
  }
  return item.metadata;
}

function textToolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function rpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body || "{}"));
    req.on("error", reject);
  });
}

function writeJSON(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  const data = await loadDemoData();
  const port = Number(args.port ?? process.env.MEM9_DEMO_MCP_PORT ?? 8787);
  const host = args.host ?? process.env.MEM9_DEMO_MCP_HOST ?? "127.0.0.1";
  const server = createFixtureMCPServer(data);
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`Fixture DataHub MCP listening at http://${host}:${actualPort}`);
  });
}
