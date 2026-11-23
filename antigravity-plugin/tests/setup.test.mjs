// @ts-check

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  main,
  parseArgs,
  runSetup,
} from "../skills/mem9-setup/scripts/setup.mjs";

const execFileAsync = promisify(execFile);
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(THIS_DIR, "..");
const SETUP_SCRIPT_PATH = path.join(PLUGIN_ROOT, "skills", "mem9-setup", "scripts", "setup.mjs");

/**
 * Create an isolated temporary workspace for setup tests.
 * @returns {{
 *   root: string,
 *   mem9Home: string,
 *   homeDir: string,
 *   repoDir: string,
 *   subDir: string,
 *   pluginDataDir: string,
 * }}
 */
function createTempEnv() {
  const root = mkdtempSync(path.join(os.tmpdir(), "mem9-agy-setup-"));
  const mem9Home = path.join(root, "mem9-home");
  const homeDir = path.join(root, "user-home");
  const repoDir = path.join(root, "repo");
  const subDir = path.join(repoDir, "packages", "app");
  const pluginDataDir = path.join(root, "plugin-data");

  mkdirSync(homeDir, { recursive: true });
  mkdirSync(path.join(repoDir, ".git"), { recursive: true });
  mkdirSync(subDir, { recursive: true });
  mkdirSync(pluginDataDir, { recursive: true });

  return {
    root,
    mem9Home,
    homeDir,
    repoDir,
    subDir,
    pluginDataDir,
  };
}

/**
 * Create a string buffer writable for capturing stdout/stderr.
 * @returns {{ writer: { write: (chunk: string) => boolean }, text: () => string }}
 */
function createBufferWriter() {
  let content = "";
  return {
    writer: {
      write(chunk) {
        content += chunk;
        return true;
      },
    },
    text() {
      return content;
    },
  };
}

/**
 * Read and parse a JSON file from disk.
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/**
 * Start a local mock HTTP server for testing key provisioning.
 * @param {(req: http.IncomingMessage, res: http.ServerResponse) => void} handler
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
async function startMockServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected numeric server port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve(undefined);
          }
        });
      }),
  };
}

test("parseArgs parses setup commands and rejects unsafe or invalid flags", () => {
  assert.deepEqual(parseArgs(["inspect"]), {
    command: "inspect",
    subcommand: "",
    cwd: "",
    profileId: "",
    profileIdExplicit: false,
    label: "",
    baseUrl: "",
    apiKeyEnv: "MEM9_API_KEY",
    apiKeyEnvExplicit: false,
    provisionApiKey: false,
    scope: "",
    agentId: "",
    defaultTimeoutMs: undefined,
    searchTimeoutMs: undefined,
    recallMinPromptLength: undefined,
  });

  const createArgs = parseArgs([
    "profile",
    "create",
    "--profile=work",
    "--label",
    "Work",
    "--base-url",
    "https://api.mem9.ai///",
    "--provision-api-key",
  ]);
  assert.equal(createArgs.command, "profile");
  assert.equal(createArgs.subcommand, "create");
  assert.equal(createArgs.profileId, "work");
  assert.equal(createArgs.label, "Work");
  assert.equal(createArgs.baseUrl, "https://api.mem9.ai");
  assert.equal(createArgs.provisionApiKey, true);

  const scopeArgs = parseArgs([
    "scope",
    "apply",
    "--scope",
    "project",
    "--profile",
    "work",
    "--agent-id",
    "repo-bucket",
    "--default-timeout-ms",
    "9000",
    "--search-timeout-ms",
    "18000",
    "--recall-min-prompt-length",
    "0",
    "--cwd",
    "/tmp/repo",
  ]);
  assert.equal(scopeArgs.scope, "project");
  assert.equal(scopeArgs.agentId, "repo-bucket");
  assert.equal(scopeArgs.defaultTimeoutMs, 9000);
  assert.equal(scopeArgs.searchTimeoutMs, 18000);
  assert.equal(scopeArgs.recallMinPromptLength, 0);
  assert.equal(scopeArgs.cwd, "/tmp/repo");

  assert.throws(
    () => parseArgs(["profile", "save-key", "--api-key", "secret"]),
    /--api-key.*not supported/i,
  );
  assert.throws(
    () => parseArgs(["scope", "apply", "--scope", "global"]),
    /--scope user.*--scope project/,
  );
  assert.throws(
    () => parseArgs(["scope", "clear", "--scope", "user"]),
    /--scope project/,
  );
  assert.throws(
    () => parseArgs(["scope", "apply", "--scope", "user", "--recall-min-prompt-length", "-1"]),
    /non-negative integer/,
  );
  assert.throws(
    () => parseArgs(["scope", "apply", "--scope", "user", "--default-timeout-ms", "0"]),
    /positive integer/,
  );
  assert.throws(
    () => parseArgs(["scope", "apply", "--scope", "user", "--agent-id", "a".repeat(101)]),
    /1-100 characters/,
  );
  assert.throws(
    () => parseArgs(["scope", "apply", "--scope", "user", "--agent-id", "bad\nid"]),
    /control characters/,
  );
});

test("help flags print guidance without mutating mem9Home", async (t) => {
  const tmp = createTempEnv();
  t.after(() => rmSync(tmp.root, { recursive: true, force: true }));

  const rootOut = createBufferWriter();
  const rootHelp = await runSetup(["--help"], {
    cwd: tmp.repoDir,
    mem9Home: tmp.mem9Home,
    homeDir: tmp.homeDir,
    stdout: rootOut.writer,
  });
  assert.equal(rootHelp.command, "help");
  assert.equal(rootHelp.topic, "root");
  assert.match(rootOut.text(), /mem9 setup/);
  assert.match(rootOut.text(), /profile create/);
  assert.match(rootOut.text(), /profile save-key/);
  assert.match(rootOut.text(), /scope apply/);
  assert.match(rootOut.text(), /scope clear/);

  const saveKeyOut = createBufferWriter();
  const saveKeyHelp = await runSetup(["profile", "save-key", "--help"], {
    stdout: saveKeyOut.writer,
  });
  assert.equal(saveKeyHelp.topic, "profile save-key");
  assert.match(saveKeyOut.text(), /--api-key-env/);
  assert.equal(existsSync(tmp.mem9Home), false);
});

test("inspect reports missing_config cleanly on a fresh workspace", async (t) => {
  const tmp = createTempEnv();
  t.after(() => rmSync(tmp.root, { recursive: true, force: true }));

  const out = createBufferWriter();
  const res = /** @type {Record<string, unknown>} */ (await runSetup(["inspect", "--cwd", tmp.subDir], {
    mem9Home: tmp.mem9Home,
    homeDir: tmp.homeDir,
    pluginDataDir: tmp.pluginDataDir,
    env: {},
    stdout: out.writer,
  }));

  assert.equal(res.status, "ok");
  assert.equal(res.command, "inspect");
  const runtime = /** @type {Record<string, unknown>} */ (res.runtime);
  assert.equal(runtime.issueCode, "missing_config");
  assert.equal(runtime.hasApiKey, false);
  assert.equal(runtime.apiKeyPreview, "");

  const profiles = /** @type {Record<string, unknown>} */ (res.profiles);
  assert.equal(profiles.credentialsState, "missing");
  assert.equal(profiles.hasUsableProfiles, false);
  assert.deepEqual(profiles.items, []);

  const parsedStdout = JSON.parse(out.text());
  assert.equal(parsedStdout.runtime.issueCode, "missing_config");
});

test("profile create provisions key via local HTTP server, saves 0600 credentials, and redacts stdout", async (t) => {
  const tmp = createTempEnv();
  t.after(() => rmSync(tmp.root, { recursive: true, force: true }));

  let calls = 0;
  const server = await startMockServer((req, res) => {
    calls += 1;
    if (req.method === "POST" && req.url === "/v1alpha1/mem9s") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: `mem9_live_secret_token_000${calls}` }));
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });
  t.after(() => server.close());

  const out1 = createBufferWriter();
  const res1 = /** @type {Record<string, unknown>} */ (await runSetup(
    [
      "profile",
      "create",
      "--profile",
      "default",
      "--label",
      "Default",
      "--base-url",
      server.url,
      "--provision-api-key",
    ],
    {
      mem9Home: tmp.mem9Home,
      homeDir: tmp.homeDir,
      env: {},
      stdout: out1.writer,
    },
  ));

  assert.equal(res1.status, "ok");
  assert.equal(res1.command, "profile.create");
  assert.equal(res1.action, "created");
  assert.equal(res1.provisioned, true);
  assert.equal(res1.hasApiKey, true);
  assert.equal(res1.apiKeyPreview, "mem9...0001");
  assert.equal(out1.text().includes("mem9_live_secret_token_0001"), false);

  const credentialsPath = path.join(tmp.mem9Home, ".credentials.json");
  assert.equal(existsSync(credentialsPath), true);
  if (process.platform !== "win32") {
    assert.equal(statSync(credentialsPath).mode & 0o777, 0o600);
  }

  const out2 = createBufferWriter();
  const res2 = /** @type {Record<string, unknown>} */ (await runSetup(
    [
      "profile",
      "create",
      "--profile",
      "work",
      "--label",
      "Work",
      "--base-url",
      server.url,
      "--provision-api-key",
    ],
    {
      mem9Home: tmp.mem9Home,
      homeDir: tmp.homeDir,
      env: {},
      stdout: out2.writer,
    },
  ));

  assert.equal(res2.apiKeyPreview, "mem9...0002");
  assert.equal(out2.text().includes("mem9_live_secret_token_0002"), false);

  const saved = readJson(credentialsPath);
  const savedProfiles = /** @type {Record<string, Record<string, unknown>>} */ (saved.profiles);
  assert.equal(savedProfiles.default.apiKey, "mem9_live_secret_token_0001");
  assert.equal(savedProfiles.work.apiKey, "mem9_live_secret_token_0002");
});

test("profile create reports HTTP provisioning failures cleanly", async (t) => {
  const tmp = createTempEnv();
  t.after(() => rmSync(tmp.root, { recursive: true, force: true }));

  const server = await startMockServer((_req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "provisioning unavailable" }));
  });
  t.after(() => server.close());

  await assert.rejects(
    () =>
      runSetup(
        [
          "profile",
          "create",
          "--profile",
          "default",
          "--base-url",
          server.url,
          "--provision-api-key",
        ],
        {
          mem9Home: tmp.mem9Home,
          homeDir: tmp.homeDir,
          env: {},
        },
      ),
    /500|provisioning unavailable/,
  );
});

test("profile save-key saves env secret without leaking it and rejects empty env vars", async (t) => {
  const tmp = createTempEnv();
  t.after(() => rmSync(tmp.root, { recursive: true, force: true }));

  const secretKey = "mem9_manual_key_abcdefgh9876";

  await assert.rejects(
    () =>
      runSetup(
        ["profile", "save-key", "--profile", "personal", "--api-key-env", "MEM9_API_KEY"],
        {
          mem9Home: tmp.mem9Home,
          homeDir: tmp.homeDir,
          env: {},
        },
      ),
    /MEM9_API_KEY.*empty or unset/,
  );

  const out = createBufferWriter();
  const res = /** @type {Record<string, unknown>} */ (await runSetup(
    [
      "profile",
      "save-key",
      "--profile",
      "personal",
      "--label",
      "Personal",
      "--base-url",
      "https://mem9.example.com/",
      "--api-key-env",
      "CUSTOM_MEM9_KEY",
    ],
    {
      mem9Home: tmp.mem9Home,
      homeDir: tmp.homeDir,
      env: { CUSTOM_MEM9_KEY: secretKey },
      stdout: out.writer,
    },
  ));

  assert.equal(res.status, "ok");
  assert.equal(res.command, "profile.save-key");
  assert.equal(res.apiKeyPreview, "mem9...9876");
  assert.equal(out.text().includes(secretKey), false);

  const saved = readJson(path.join(tmp.mem9Home, ".credentials.json"));
  const savedProfiles = /** @type {Record<string, Record<string, unknown>>} */ (saved.profiles);
  assert.equal(savedProfiles.personal.apiKey, secretKey);
  assert.equal(savedProfiles.personal.baseUrl, "https://mem9.example.com");
});

test("scope apply (user + project) and scope clear manage configs without storing secrets", async (t) => {
  const tmp = createTempEnv();
  t.after(() => rmSync(tmp.root, { recursive: true, force: true }));

  const defaultSecret = "mem9_default_secret_11112222";
  const workSecret = "mem9_work_secret_33334444";

  await runSetup(
    ["profile", "save-key", "--profile", "default", "--label", "Default"],
    {
      mem9Home: tmp.mem9Home,
      homeDir: tmp.homeDir,
      env: { MEM9_API_KEY: defaultSecret },
      stdout: createBufferWriter().writer,
    },
  );
  await runSetup(
    ["profile", "save-key", "--profile", "work", "--label", "Work"],
    {
      mem9Home: tmp.mem9Home,
      homeDir: tmp.homeDir,
      env: { MEM9_API_KEY: workSecret },
      stdout: createBufferWriter().writer,
    },
  );

  // Reject missing profile before writing scope config.
  await assert.rejects(
    () =>
      runSetup(["scope", "apply", "--scope", "user", "--profile", "nonexistent"], {
        mem9Home: tmp.mem9Home,
        homeDir: tmp.homeDir,
        env: {},
      }),
    /was not found/,
  );

  const userOut = createBufferWriter();
  const userApply = /** @type {Record<string, unknown>} */ (await runSetup(
    [
      "scope",
      "apply",
      "--scope",
      "user",
      "--profile",
      "default",
      "--agent-id",
      "user-agent",
      "--default-timeout-ms",
      "7000",
      "--search-timeout-ms",
      "14000",
      "--recall-min-prompt-length",
      "3",
    ],
    {
      cwd: tmp.subDir,
      mem9Home: tmp.mem9Home,
      homeDir: tmp.homeDir,
      env: {},
      stdout: userOut.writer,
    },
  ));

  assert.equal(userApply.status, "ok");
  assert.equal(userApply.command, "scope.apply");
  assert.equal(userApply.scope, "user");
  assert.equal(userOut.text().includes(defaultSecret), false);

  const userConfigPath = path.join(tmp.mem9Home, "antigravity", "config.json");
  const userConfig = readJson(userConfigPath);
  assert.equal(userConfig.profileId, "default");
  assert.equal(userConfig.agentId, "user-agent");
  assert.equal(userConfig.defaultTimeoutMs, 7000);
  assert.equal(userConfig.searchTimeoutMs, 14000);
  assert.equal(userConfig.recallMinPromptLength, 3);
  assert.equal("apiKey" in userConfig, false);

  // Apply project scope without --agent-id; inherits user-agent at runtime without snapshotting it.
  const projectOut = createBufferWriter();
  const projectApply = /** @type {Record<string, unknown>} */ (await runSetup(
    [
      "scope",
      "apply",
      "--scope",
      "project",
      "--profile",
      "work",
      "--recall-min-prompt-length",
      "0",
      "--cwd",
      tmp.subDir,
    ],
    {
      mem9Home: tmp.mem9Home,
      homeDir: tmp.homeDir,
      env: {},
      stdout: projectOut.writer,
    },
  ));

  assert.equal(projectApply.scope, "project");
  assert.equal(projectOut.text().includes(workSecret), false);

  const projectConfigPath = path.join(tmp.repoDir, ".agents", "mem9", "config.json");
  assert.equal(existsSync(projectConfigPath), true);
  const projectConfig = readJson(projectConfigPath);
  assert.equal(projectConfig.profileId, "work");
  assert.equal(projectConfig.recallMinPromptLength, 0);
  assert.equal("agentId" in projectConfig, false);
  assert.equal("apiKey" in projectConfig, false);

  const inspectOut = createBufferWriter();
  const inspected = /** @type {Record<string, unknown>} */ (await runSetup(
    ["inspect", "--cwd", tmp.subDir],
    {
      mem9Home: tmp.mem9Home,
      homeDir: tmp.homeDir,
      env: {},
      stdout: inspectOut.writer,
    },
  ));
  assert.equal(inspectOut.text().includes(defaultSecret), false);
  assert.equal(inspectOut.text().includes(workSecret), false);

  const rt = /** @type {Record<string, unknown>} */ (inspected.runtime);
  assert.equal(rt.issueCode, "ready");
  assert.equal(rt.profileId, "work");
  assert.equal(rt.agentId, "user-agent");
  assert.equal(rt.apiKeyPreview, "mem9...4444");
  assert.equal(rt.recallMinPromptLength, 0);

  // Clear project scope twice: first removed, second already-clear.
  const clearOut1 = createBufferWriter();
  const clear1 = /** @type {Record<string, unknown>} */ (await runSetup(
    ["scope", "clear", "--scope", "project", "--cwd", tmp.subDir],
    {
      mem9Home: tmp.mem9Home,
      homeDir: tmp.homeDir,
      env: {},
      stdout: clearOut1.writer,
    },
  ));
  assert.equal(clear1.action, "removed");
  assert.equal(existsSync(projectConfigPath), false);
  assert.equal((/** @type {Record<string, unknown>} */ (clear1.runtime)).profileId, "default");
  assert.equal(clearOut1.text().includes(defaultSecret), false);

  const clearOut2 = createBufferWriter();
  const clear2 = /** @type {Record<string, unknown>} */ (await runSetup(
    ["scope", "clear", "--scope", "project", "--cwd", tmp.subDir],
    {
      mem9Home: tmp.mem9Home,
      homeDir: tmp.homeDir,
      env: {},
      stdout: clearOut2.writer,
    },
  ));
  assert.equal(clear2.action, "already-clear");
});

test("corrupt credentials and config files are backed up before repair", async (t) => {
  const tmp = createTempEnv();
  t.after(() => rmSync(tmp.root, { recursive: true, force: true }));

  const credentialsPath = path.join(tmp.mem9Home, ".credentials.json");
  const userConfigPath = path.join(tmp.mem9Home, "antigravity", "config.json");
  mkdirSync(path.dirname(userConfigPath), { recursive: true });
  writeFileSync(credentialsPath, "{corrupt json");
  writeFileSync(userConfigPath, "not-valid-json");

  const saveRes = /** @type {Record<string, unknown>} */ (await runSetup(
    ["profile", "save-key", "--profile", "default"],
    {
      mem9Home: tmp.mem9Home,
      homeDir: tmp.homeDir,
      env: { MEM9_API_KEY: "mem9_repaired_key_55556666" },
      stdout: createBufferWriter().writer,
    },
  ));
  assert.equal(existsSync(`${credentialsPath}.bak`), true);
  assert.equal((/** @type {unknown[]} */ (saveRes.backups)).length, 1);

  const scopeRes = /** @type {Record<string, unknown>} */ (await runSetup(
    ["scope", "apply", "--scope", "user", "--profile", "default"],
    {
      mem9Home: tmp.mem9Home,
      homeDir: tmp.homeDir,
      env: {},
      stdout: createBufferWriter().writer,
    },
  ));
  assert.equal(existsSync(`${userConfigPath}.bak`), true);
  assert.equal((/** @type {unknown[]} */ (scopeRes.backups)).length, 1);
});

test("setup.mjs runs cleanly as a subprocess CLI without leaking secrets", async (t) => {
  const tmp = createTempEnv();
  t.after(() => rmSync(tmp.root, { recursive: true, force: true }));

  const secretKey = "mem9_cli_secret_value_99990000";
  const baseEnv = {
    ...process.env,
    HOME: tmp.homeDir,
    MEM9_HOME: tmp.mem9Home,
    MEM9_API_KEY: secretKey,
  };

  const saveRes = await execFileAsync(
    process.execPath,
    [SETUP_SCRIPT_PATH, "profile", "save-key", "--profile", "default", "--api-key-env", "MEM9_API_KEY"],
    { env: baseEnv },
  );
  assert.equal(saveRes.stdout.includes(secretKey), false);
  assert.equal(JSON.parse(saveRes.stdout).apiKeyPreview, "mem9...0000");

  const applyRes = await execFileAsync(
    process.execPath,
    [SETUP_SCRIPT_PATH, "scope", "apply", "--scope", "user", "--profile", "default"],
    { env: { ...process.env, HOME: tmp.homeDir, MEM9_HOME: tmp.mem9Home } },
  );
  assert.equal(applyRes.stdout.includes(secretKey), false);
  assert.equal(JSON.parse(applyRes.stdout).runtime.issueCode, "ready");

  const inspectRes = await execFileAsync(
    process.execPath,
    [SETUP_SCRIPT_PATH, "inspect", "--cwd", tmp.repoDir],
    { env: { ...process.env, HOME: tmp.homeDir, MEM9_HOME: tmp.mem9Home } },
  );
  assert.equal(inspectRes.stdout.includes(secretKey), false);
  const inspected = JSON.parse(inspectRes.stdout);
  assert.equal(inspected.profiles.items[0].displaySummary, "Default (mem9...0000) · https://api.mem9.ai");

  let failed = false;
  try {
    await execFileAsync(process.execPath, [SETUP_SCRIPT_PATH, "unknown-cmd"], { env: baseEnv });
  } catch (err) {
    failed = true;
    const execErr = /** @type {{ code?: number, stderr?: string }} */ (err);
    assert.equal(execErr.code, 1);
    assert.match(String(execErr.stderr), /Unknown command/);
  }
  assert.equal(failed, true);

  // Confirm main() sets exitCode on failure cleanly without throwing unhandled rejection.
  const prevExitCode = process.exitCode;
  const errBuf = createBufferWriter();
  const mainResult = await main(["scope", "clear", "--scope", "user"], {
    mem9Home: tmp.mem9Home,
    homeDir: tmp.homeDir,
    stderr: errBuf.writer,
  });
  assert.equal(mainResult, null);
  assert.equal(process.exitCode, 1);
  assert.match(errBuf.text(), /--scope project/);
  process.exitCode = prevExitCode ?? 0;
});
