import { createServer } from "node:http";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { zstdDecompress } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from "@deepseek-ai/dsh-loader-smoke";

const require = createRequire(import.meta.url);
const dshRoot = dirname(require.resolve("@deepseek-ai/dsh/package.json"));
const dshBin = join(dshRoot, "lib", "bin.js");
const patchPath = fileURLToPath(new URL("./fixtures/loader.patch.yml", import.meta.url));
const replayPatchPath = fileURLToPath(new URL("./fixtures/replay.patch.yml", import.meta.url));
const fixturePluginPath = fileURLToPath(new URL("./fixtures/loader-fixture.ts", import.meta.url));
const replayInspectorPath = fileURLToPath(new URL("./fixtures/replay-inspector.ts", import.meta.url));
const mem9PluginPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const tsconfigPath = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
const loaderSmokeRequire = createRequire(require.resolve("@deepseek-ai/dsh-loader-smoke"));
const tsxLoader = loaderSmokeRequire.resolve("tsx");
const decompress = promisify(zstdDecompress);
const apiKey = "loader-secret-key";

interface WireCall {
  method: string | undefined;
  url: string;
  apiKey: string | undefined;
  body: unknown;
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

async function persistedSessionText(cwd: string): Promise<string> {
  const files = (await filesUnder(join(cwd, ".dsh"))).filter(path => path.endsWith(".jsonl") || path.endsWith(".jsonl.zstd"));
  const contents = await Promise.all(files.map(async file => {
    const bytes = await readFile(file);
    return file.endsWith(".zstd") ? (await decompress(bytes)).toString("utf8") : bytes.toString("utf8");
  }));
  const matching = contents.filter(content => content.includes("Relevant memories from Mem9"));
  expect(matching, contents.join("\n---\n")).toHaveLength(1);
  const [session] = matching;
  if (session === undefined) throw new Error("missing persisted Mem9 session");
  return session;
}

describe("Mem9 through a real DSH Loader profile", () => {
  it("recalls before the model request, exposes the search tool, persists recall, and ingests after the turn", async () => {
    const calls: WireCall[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        calls.push({
          method: request.method,
          url: request.url ?? "",
          apiKey: request.headers["x-api-key"] as string | undefined,
          body: body.length === 0 ? undefined : JSON.parse(body),
        });
        response.writeHead(200, { "content-type": "application/json" });
        if (request.method === "POST") {
          response.end(JSON.stringify({ ingested: true }));
          return;
        }
        response.end(JSON.stringify({
          memories: [{ id: "memory-1", content: "The user prefers Vim.", score: 0.98 }],
          total: 1,
          limit: 10,
          offset: 0,
        }));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    cleanups.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test server address");

    let modelRequests = "";
    let sessionLog = "";
    let replayProjection = "";
    const { stdout, stderr } = await runLoaderSmoke({
      label: "mem9-loader-composition",
      tempDirPrefix: "mem9-loader-composition-",
      binScript: dshBin,
      libBinScript: dshBin,
      configPath: patchPath,
      binArgs: ["--profile", "headless", "--patch", patchPath, "Which editor do I prefer?"],
      tsconfigPath,
      mode: "src",
      env: {
        MEM9_API_KEY: apiKey,
        MEM9_TEST_API_URL: `http://127.0.0.1:${address.port}`,
        DSH_TELEMETRY_MODE: "DISABLED",
      },
      prepare: async cwd => {
        const fixtures = join(cwd, ".dsh", "profiles", "headless", "test-fixtures");
        await mkdir(fixtures, { recursive: true });
        await Promise.all([
          copyFile(fixturePluginPath, join(fixtures, "loader-fixture.ts")),
          copyFile(mem9PluginPath, join(fixtures, "mem9-index.ts")),
          copyFile(replayInspectorPath, join(fixtures, "replay-inspector.ts")),
        ]);
      },
      inspect: async cwd => {
        modelRequests = await readFile(join(cwd, "loader-model-requests.json"), "utf8");
        sessionLog = await persistedSessionText(cwd);
        const header = JSON.parse(sessionLog.split("\n", 1)[0] ?? "") as { id?: unknown };
        if (typeof header.id !== "string") throw new Error("persisted session header has no id");
        const replay = spawnSync(process.execPath, [
          "--import",
          tsxLoader,
          dshBin,
          "--profile",
          "headless",
          "--patch",
          replayPatchPath,
          "verify replay without Mem9",
        ], {
          cwd,
          encoding: "utf8",
          env: {
            ...process.env,
            DSH_HOME: join(cwd, ".dsh"),
            DSH_AGENTS_HOME: join(cwd, ".agents"),
            DSH_TELEMETRY_MODE: "DISABLED",
            MEM9_REPLAY_MODE: "1",
            MEM9_REPLAY_SESSION_ID: header.id,
            TSX_TSCONFIG_PATH: tsconfigPath,
          },
        });
        if (replay.status !== 0) throw new Error(`replay Loader failed:\n${replay.stdout}\n${replay.stderr}`);
        replayProjection = await readFile(join(cwd, "replay-session.json"), "utf8");
      },
    });

    expect(stderr).not.toContain("UNHANDLED");
    expect(stdout.trim()).toMatchInlineSnapshot(`"Mem9 found the saved preference: Vim."`);
    expect(JSON.parse(modelRequests)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            source: { kind: "plugin", plugin: "mem9", form: "recall" },
            content: [{
              type: "text",
              text: expect.stringContaining("The user prefers Vim."),
            }],
          }),
        ]),
      }),
    ]));
    expect(sessionLog).toContain('"plugin":"mem9","form":"recall"');
    expect(sessionLog).toContain("Mem9 found the saved preference: Vim.");
    const replayed = JSON.parse(replayProjection) as { eventTypes: string[]; messages: Array<{ source: Record<string, unknown> }> };
    expect(replayed.eventTypes).toContain("turn/end");
    expect(replayed.messages.some(message =>
      message.source.kind === "plugin" && message.source.plugin === "mem9" && message.source.form === "recall"))
      .toBe(true);
    expect(calls.map(call => ({ method: call.method, url: call.url }))).toEqual([
      { method: "GET", url: "/v1alpha2/mem9s/memories?q=Which+editor+do+I+prefer%3F&limit=10&offset=0" },
      { method: "GET", url: "/v1alpha2/mem9s/memories?q=editor&limit=5" },
      { method: "POST", url: "/v1alpha2/mem9s/memories" },
    ]);
    expect(calls[2]?.body).toMatchObject({
      agent_id: "deepseek-harness",
      mode: "smart",
      messages: [
        { role: "user", content: "Which editor do I prefer?" },
        { role: "assistant", content: "Mem9 found the saved preference: Vim." },
      ],
    });
    expect(calls.every(call => call.apiKey === apiKey)).toBe(true);
    expect(`${stdout}\n${stderr}\n${modelRequests}\n${sessionLog}`).not.toContain(apiKey);
  }, LOADER_SMOKE_TEST_TIMEOUT_MS);
});
