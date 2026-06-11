import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, readDemoConfig, hasServerConfig } from "./lib/config.mjs";
import { loadDemoData, fixtureRecallEnvelope, buildAnswerFromResponse } from "./lib/fixtures.mjs";
import { Mem9Client } from "./lib/mem9-client.mjs";
import { resetSeed } from "./reset-seed.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(rootDir, "public");
const fixtureDir = join(rootDir, "fixtures");

export async function createDemoServer(options = {}) {
  const data = await loadDemoData();
  const config = readDemoConfig(options);
  const client = hasServerConfig(config) ? new Mem9Client(config) : null;

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://demo.local");
      if (req.method === "GET" && url.pathname === "/api/config") {
        writeJSON(res, 200, publicConfig(config, Boolean(client)));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/recall") {
        const includeDataHub = url.searchParams.get("include_datahub") === "true";
        const envelope = await recallEnvelope(data, config, client, includeDataHub);
        writeJSON(res, 200, envelope);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/reset-seed") {
        if (!client) {
          writeJSON(res, 200, {
            mode: "fixture",
            message: "No MEM9_DEMO_API_KEY configured; fixture mode reset is a no-op.",
          });
          return;
        }
        const summary = await resetSeed(options);
        writeJSON(res, 200, summary);
        return;
      }
      await serveStatic(url.pathname, res);
    } catch (error) {
      writeJSON(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

async function recallEnvelope(data, config, client, includeDataHub) {
  if (!client) {
    return fixtureRecallEnvelope(data, config, includeDataHub);
  }
  try {
    const response = await client.recall(config.prompt, includeDataHub);
    return {
      mode: "server-backed",
      include_datahub: includeDataHub,
      prompt: config.prompt,
      response,
      answer: buildAnswerFromResponse(data, response, includeDataHub),
      captured_at: new Date().toISOString(),
    };
  } catch (error) {
    const fallback = fixtureRecallEnvelope(data, config, includeDataHub);
    return {
      ...fallback,
      mode: "fixture-fallback",
      fallback_error: error instanceof Error ? error.message : String(error),
    };
  }
}

function publicConfig(config, serverBacked) {
  return {
    mode: serverBacked ? "server-backed" : "fixture",
    base_url: config.baseURL,
    agent_id: config.agentID,
    app_id: config.appID,
    demo_tag: config.demoTag,
    prompt: config.prompt,
  };
}

async function serveStatic(pathname, res) {
  const resolvedPath = pathname === "/" ? "/index.html" : pathname;
  const baseDir = resolvedPath.startsWith("/fixtures/") ? fixtureDir : publicDir;
  const relative = resolvedPath.startsWith("/fixtures/")
    ? resolvedPath.replace(/^\/fixtures\//, "")
    : resolvedPath.replace(/^\//, "");
  const safePath = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(baseDir, safePath);
  const body = await readFile(filePath);
  res.writeHead(200, { "Content-Type": contentType(filePath) });
  res.end(body);
}

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function writeJSON(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  const host = args.host ?? process.env.MEM9_DEMO_HOST ?? "127.0.0.1";
  const port = Number(args.port ?? process.env.MEM9_DEMO_PORT ?? 4179);
  const server = await createDemoServer(args);
  server.listen(port, host, () => {
    console.log(`DataHub context demo listening at http://${host}:${port}`);
  });
}
