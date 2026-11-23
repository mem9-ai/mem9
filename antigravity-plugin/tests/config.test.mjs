// @ts-check

import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  autoProvisionDefaultProfile,
  DEFAULT_AGENT_ID,
  DEFAULT_API_URL,
  DEFAULT_RECALL_MIN_PROMPT_LENGTH,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  loadRuntimeState,
  MAX_AGENT_ID_LENGTH,
  MEM9_WRITER_ID,
  normalizeAgentId,
  redactApiKeyPreview,
  resolveMem9Home,
  resolveProjectRoot,
  resolveRuntimePaths,
  writeJsonAtomic,
} from "../scripts/lib/config.mjs";
import {
  appendDebugError,
  appendDebugLog,
  isDebugEnabled,
} from "../scripts/lib/debug.mjs";
import {
  buildMem9Url,
  MEM9_PLUGIN_USER_AGENT,
  mem9FetchJson,
  mem9Headers,
  Mem9HttpError,
  provisionMem9Space,
} from "../scripts/lib/http.mjs";
import {
  claimRuntimeNotice,
  formatRuntimeQuotaNotice,
  formatRuntimeStateNotice,
  noticeHash,
  parseRuntimeQuotaDenied,
  resolveRuntimeStateNotice,
  toolErrorPayload,
} from "../scripts/lib/quota-error.mjs";

/**
 * @param {string} prefix
 * @returns {string}
 */
function makeTempDir(prefix = "mem9-ag-config-") {
  return path.join(
    os.tmpdir(),
    `${prefix}${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
}

/**
 * @param {string} filePath
 * @param {unknown} data
 */
function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/**
 * @param {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void} handler
 */
async function withHttpServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(undefined);
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(undefined);
        });
      });
    },
  };
}

test("config exports expected constants", () => {
  assert.equal(DEFAULT_API_URL, "https://api.mem9.ai");
  assert.equal(DEFAULT_AGENT_ID, "antigravity");
  assert.equal(MEM9_WRITER_ID, "antigravity");
  assert.equal(MAX_AGENT_ID_LENGTH, 100);
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 8_000);
  assert.equal(DEFAULT_SEARCH_TIMEOUT_MS, 15_000);
  assert.equal(DEFAULT_RECALL_MIN_PROMPT_LENGTH, 5);
});

test("resolveMem9Home respects precedence: input > env > homeDir/.mem9", () => {
  assert.equal(
    resolveMem9Home(" /custom/mem9 ", { MEM9_HOME: "/env/mem9" }, "/Users/alice"),
    path.resolve("/custom/mem9"),
  );
  assert.equal(
    resolveMem9Home("", { MEM9_HOME: " /env/mem9 " }, "/Users/alice"),
    path.resolve("/env/mem9"),
  );
  assert.equal(
    resolveMem9Home("", {}, "/Users/alice"),
    path.resolve("/Users/alice/.mem9"),
  );
});

test("resolveProjectRoot walks up to .git or .agents, falls back to existing cwd, else null", () => {
  const root = makeTempDir("mem9-root-");
  try {
    const gitRepo = path.join(root, "git-repo");
    const gitSub = path.join(gitRepo, "packages", "app");
    mkdirSync(path.join(gitRepo, ".git"), { recursive: true });
    mkdirSync(gitSub, { recursive: true });
    assert.equal(resolveProjectRoot(gitSub), gitRepo);

    const agentsRepo = path.join(root, "agents-repo");
    const agentsSub = path.join(agentsRepo, "nested");
    mkdirSync(path.join(agentsRepo, ".agents"), { recursive: true });
    mkdirSync(agentsSub, { recursive: true });
    assert.equal(resolveProjectRoot(agentsSub), agentsRepo);

    // Nested marker closer to cwd wins
    const nested = path.join(gitRepo, "packages", "sub-agents");
    mkdirSync(path.join(nested, ".agents"), { recursive: true });
    assert.equal(resolveProjectRoot(nested), nested);

    // Plain directory without .git or .agents falls back to path.resolve(cwd)
    const plainDir = path.join(root, "plain-dir");
    mkdirSync(plainDir, { recursive: true });
    assert.equal(resolveProjectRoot(plainDir), path.resolve(plainDir));

    // Nonexistent directory without marker ancestors returns null
    const missingDir = path.join(root, "does-not-exist");
    assert.equal(resolveProjectRoot(missingDir), null);
    assert.equal(resolveProjectRoot(""), null);
    assert.equal(resolveProjectRoot(null), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveRuntimePaths derives all antigravity paths and overrides", () => {
  const root = makeTempDir("mem9-paths-");
  try {
    const repo = path.join(root, "repo");
    mkdirSync(path.join(repo, ".git"), { recursive: true });
    const mem9Home = path.join(root, "mem9-home");
    const pluginDataDir = path.join(root, "plugin-data");
    const customLog = path.join(root, "custom", "debug.jsonl");

    const paths = resolveRuntimePaths({
      cwd: repo,
      mem9Home,
      pluginDataDir,
      env: {
        PLUGIN_DATA: path.join(root, "ignored-plugin-data"),
        MEM9_DEBUG_LOG_FILE: customLog,
      },
    });

    assert.equal(paths.mem9Home, mem9Home);
    assert.equal(paths.stateDir, path.join(mem9Home, "antigravity"));
    assert.equal(paths.credentialsPath, path.join(mem9Home, ".credentials.json"));
    assert.equal(paths.userConfigPath, path.join(mem9Home, "antigravity", "config.json"));
    assert.equal(paths.projectRoot, repo);
    assert.equal(paths.projectConfigPath, path.join(repo, ".agents", "mem9", "config.json"));
    assert.equal(paths.pluginAuthFallbackPath, path.join(pluginDataDir, "auth.json"));
    assert.equal(paths.hookStatePath, path.join(mem9Home, "antigravity", "hook-state.json"));
    assert.equal(paths.noticeStatePath, path.join(mem9Home, "antigravity", "runtime-notices.json"));
    assert.equal(paths.debugLogPath, customLog);

    const envPaths = resolveRuntimePaths({
      cwd: path.join(root, "missing"),
      mem9Home,
      env: { PLUGIN_DATA: path.join(root, "env-plugin-data") },
    });
    assert.equal(envPaths.projectRoot, null);
    assert.equal(envPaths.projectConfigPath, "");
    assert.equal(
      envPaths.pluginAuthFallbackPath,
      path.join(root, "env-plugin-data", "auth.json"),
    );
    assert.equal(
      envPaths.debugLogPath,
      path.join(mem9Home, "antigravity", "logs", "hooks.jsonl"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("normalizeAgentId validates trimmed length in code points and rejects control chars", () => {
  assert.equal(normalizeAgentId("  my-agent  "), "my-agent");
  assert.equal(normalizeAgentId(""), "");
  assert.equal(normalizeAgentId("   "), "");
  assert.equal(normalizeAgentId(null), "");
  assert.equal(normalizeAgentId(123), "");
  assert.equal(normalizeAgentId("agent\nname"), "");
  assert.equal(normalizeAgentId("agent\x00name"), "");
  assert.equal(normalizeAgentId("agent\x7fname"), "");

  // 100 surrogate-pair emojis (100 code points, UTF-16 length 200) is valid
  const hundredEmojis = "🚀".repeat(100);
  assert.equal(normalizeAgentId(hundredEmojis), hundredEmojis);
  assert.equal(normalizeAgentId(`${hundredEmojis}a`), "");
});

test("redactApiKeyPreview never exposes full key", () => {
  assert.equal(redactApiKeyPreview(""), "");
  assert.equal(redactApiKeyPreview("   "), "");
  assert.equal(redactApiKeyPreview("short"), "saved");
  assert.equal(redactApiKeyPreview("12345678901"), "saved");
  assert.equal(redactApiKeyPreview("mn9_12345678abcd"), "mn9_...abcd");
  assert.equal(redactApiKeyPreview("  123456789012  "), "1234...9012");
});

test("writeJsonAtomic writes atomically with 0600 permissions and no leftover temp files", () => {
  const root = makeTempDir("mem9-atomic-");
  try {
    const target = path.join(root, "nested", "creds.json");
    writeJsonAtomic(target, { ok: true, count: 1 });
    writeJsonAtomic(target, { ok: true, count: 2 }, { mode: 0o600 });

    const parsed = JSON.parse(readFileSync(target, "utf8"));
    assert.deepEqual(parsed, { ok: true, count: 2 });
    assert.equal(statSync(target).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(path.dirname(target)), ["creds.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadRuntimeState resolves priority order, overrides, and agentId precedence", () => {
  const root = makeTempDir("mem9-state-");
  try {
    const mem9Home = path.join(root, "mem9");
    const repo = path.join(root, "repo");
    const pluginData = path.join(root, "plugin-data");
    mkdirSync(path.join(repo, ".git"), { recursive: true });

    // 0. Empty -> missing_config
    const emptyState = loadRuntimeState({ cwd: repo, mem9Home, env: {} });
    assert.equal(emptyState.issueCode, "missing_config");
    assert.equal(emptyState.configSource, "none");
    assert.equal(emptyState.authSource, "none");
    assert.equal(emptyState.runtime.agentId, DEFAULT_AGENT_ID);

    // 1. Plugin data fallback when no scoped config or shared credentials exist
    writeJson(path.join(pluginData, "auth.json"), {
      base_url: "https://plugin-data.mem9.ai/",
      api_key: "mk_plugin_data_1234",
    });
    const pluginDataState = loadRuntimeState({
      cwd: repo,
      mem9Home,
      pluginDataDir: pluginData,
      env: {},
    });
    assert.equal(pluginDataState.issueCode, "ready");
    assert.equal(pluginDataState.configSource, "plugin_data");
    assert.equal(pluginDataState.authSource, "plugin_data");
    assert.equal(pluginDataState.runtime.apiKey, "mk_plugin_data_1234");
    assert.equal(pluginDataState.runtime.baseUrl, "https://plugin-data.mem9.ai");

    // 2. Shared default profile takes priority over plugin_data when no scoped config exists
    writeJson(path.join(mem9Home, ".credentials.json"), {
      schemaVersion: 1,
      profiles: {
        default: {
          label: "Default",
          baseUrl: "https://shared.mem9.ai/",
          apiKey: "mk_shared_default_1234",
        },
        work: {
          label: "Work",
          baseUrl: "https://work.mem9.ai/",
          apiKey: "mk_work_12345678",
        },
      },
    });
    const sharedDefaultState = loadRuntimeState({
      cwd: repo,
      mem9Home,
      pluginDataDir: pluginData,
      env: {},
    });
    assert.equal(sharedDefaultState.issueCode, "ready");
    assert.equal(sharedDefaultState.configSource, "shared_default");
    assert.equal(sharedDefaultState.authSource, "credentials");
    assert.equal(sharedDefaultState.runtime.profileId, "default");
    assert.equal(sharedDefaultState.runtime.apiKey, "mk_shared_default_1234");
    assert.equal(sharedDefaultState.runtime.baseUrl, "https://shared.mem9.ai");

    // 3. User config overrides shared_default; project config merges over user config
    writeJson(path.join(mem9Home, "antigravity", "config.json"), {
      schemaVersion: 1,
      profileId: "default",
      agentId: "user-agent",
      defaultTimeoutMs: 6_000,
      searchTimeoutMs: 12_000,
      recallMinPromptLength: 3,
    });
    const userState = loadRuntimeState({ cwd: repo, mem9Home, env: {} });
    assert.equal(userState.issueCode, "ready");
    assert.equal(userState.configSource, "user");
    assert.equal(userState.runtime.agentId, "user-agent");
    assert.equal(userState.runtime.defaultTimeoutMs, 6_000);
    assert.equal(userState.runtime.recallMinPromptLength, 3);

    writeJson(path.join(repo, ".agents", "mem9", "config.json"), {
      schemaVersion: 1,
      profileId: "work",
      agentId: "project-agent",
      searchTimeoutMs: 20_000,
      recallMinPromptLength: 0,
    });
    const projectState = loadRuntimeState({ cwd: repo, mem9Home, env: {} });
    assert.equal(projectState.issueCode, "ready");
    assert.equal(projectState.configSource, "project");
    assert.equal(projectState.authSource, "credentials");
    assert.equal(projectState.runtime.profileId, "work");
    assert.equal(projectState.runtime.apiKey, "mk_work_12345678");
    assert.equal(projectState.runtime.baseUrl, "https://work.mem9.ai");
    assert.equal(projectState.runtime.agentId, "project-agent");
    assert.equal(projectState.runtime.defaultTimeoutMs, 6_000);
    assert.equal(projectState.runtime.searchTimeoutMs, 20_000);
    assert.equal(projectState.runtime.recallMinPromptLength, 0);

    // 4. Env overrides apiKey, optional baseUrl (falling back to matchedProfile.baseUrl), and agentId
    const envOnlyKeyState = loadRuntimeState({
      cwd: repo,
      mem9Home,
      env: {
        MEM9_API_KEY: "mk_env_override_9999",
        MEM9_AGENT_ID: "env-agent",
      },
    });
    assert.equal(envOnlyKeyState.issueCode, "ready");
    assert.equal(envOnlyKeyState.authSource, "env");
    assert.equal(envOnlyKeyState.runtime.apiKey, "mk_env_override_9999");
    assert.equal(envOnlyKeyState.runtime.baseUrl, "https://work.mem9.ai");
    assert.equal(envOnlyKeyState.runtime.agentId, "env-agent");

    const envUrlState = loadRuntimeState({
      cwd: repo,
      mem9Home,
      env: {
        MEM9_API_KEY: "mk_env_override_9999",
        MEM9_API_URL: "https://custom-env.mem9.ai/",
        MEM9_AGENT_ID: "bad\nagent",
      },
    });
    assert.equal(envUrlState.runtime.baseUrl, "https://custom-env.mem9.ai");
    // Invalid env agentId falls back to projectConfig.agentId
    assert.equal(envUrlState.runtime.agentId, "project-agent");

    // 5. enabled: false disables even when MEM9_API_KEY is present
    writeJson(path.join(repo, ".agents", "mem9", "config.json"), {
      schemaVersion: 1,
      enabled: false,
      profileId: "work",
    });
    const disabledState = loadRuntimeState({
      cwd: repo,
      mem9Home,
      env: { MEM9_API_KEY: "mk_env_override_9999" },
    });
    assert.equal(disabledState.issueCode, "disabled");
    assert.equal(disabledState.runtime.enabled, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadRuntimeState handles missing profiles, missing keys, and malformed JSON", () => {
  const root = makeTempDir("mem9-errors-");
  try {
    const mem9Home = path.join(root, "mem9");
    const repo = path.join(root, "repo");
    mkdirSync(path.join(repo, ".git"), { recursive: true });

    const userCfgPath = path.join(mem9Home, "antigravity", "config.json");
    const projectCfgPath = path.join(repo, ".agents", "mem9", "config.json");
    const credsPath = path.join(mem9Home, ".credentials.json");

    // Missing profile in credentials
    writeJson(userCfgPath, { schemaVersion: 1, profileId: "missing" });
    writeJson(credsPath, { schemaVersion: 1, profiles: {} });
    assert.equal(loadRuntimeState({ cwd: repo, mem9Home, env: {} }).issueCode, "missing_profile");

    // Missing apiKey in matched profile
    writeJson(credsPath, {
      schemaVersion: 1,
      profiles: { missing: { label: "Empty", baseUrl: "https://api.mem9.ai", apiKey: "" } },
    });
    assert.equal(loadRuntimeState({ cwd: repo, mem9Home, env: {} }).issueCode, "missing_api_key");

    // Invalid project config ignored with warning when user config is valid
    writeJson(userCfgPath, { schemaVersion: 1, profileId: "default" });
    writeJson(credsPath, {
      schemaVersion: 1,
      profiles: { default: { label: "Default", baseUrl: "https://api.mem9.ai", apiKey: "mk_valid_123456" } },
    });
    mkdirSync(path.dirname(projectCfgPath), { recursive: true });
    writeFileSync(projectCfgPath, "{not valid json", "utf8");
    const ignoredProject = loadRuntimeState({ cwd: repo, mem9Home, env: {} });
    assert.equal(ignoredProject.issueCode, "ready");
    assert.equal(ignoredProject.configSource, "user");
    assert.deepEqual(ignoredProject.warnings, ["invalid_project_config_ignored"]);

    // Invalid user config causes invalid_config if no valid project config with profileId
    rmSync(projectCfgPath);
    writeFileSync(userCfgPath, "{bad json", "utf8");
    assert.equal(loadRuntimeState({ cwd: repo, mem9Home, env: {} }).issueCode, "invalid_config");

    // Invalid user config ignored when valid project config provides profileId
    writeJson(projectCfgPath, { schemaVersion: 1, profileId: "default" });
    const ignoredUser = loadRuntimeState({ cwd: repo, mem9Home, env: {} });
    assert.equal(ignoredUser.issueCode, "ready");
    assert.equal(ignoredUser.configSource, "project");
    assert.deepEqual(ignoredUser.warnings, ["invalid_user_config_ignored"]);

    // Invalid credentials file
    writeJson(userCfgPath, { schemaVersion: 1, profileId: "default" });
    rmSync(projectCfgPath);
    writeFileSync(credsPath, "[]", "utf8");
    assert.equal(loadRuntimeState({ cwd: repo, mem9Home, env: {} }).issueCode, "invalid_credentials");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("autoProvisionDefaultProfile respects MEM9_AUTO_PROVISION and preserves existing profiles", async () => {
  const root = makeTempDir("mem9-autoprovision-");
  try {
    const mem9Home = path.join(root, "mem9");
    const repo = path.join(root, "repo");
    mkdirSync(path.join(repo, ".git"), { recursive: true });

    let calls = 0;
    for (const disabledVal of ["0", "false", "no", "off", "FALSE"]) {
      const skipped = await autoProvisionDefaultProfile({
        cwd: repo,
        mem9Home,
        env: { MEM9_AUTO_PROVISION: disabledVal },
        async provisionFn() {
          calls += 1;
          return { apiKey: "should-not-run", baseUrl: DEFAULT_API_URL };
        },
      });
      assert.equal(skipped, null);
    }
    assert.equal(calls, 0);

    // Pre-seed another profile to verify preservation
    const credsPath = path.join(mem9Home, ".credentials.json");
    writeJson(credsPath, {
      schemaVersion: 1,
      profiles: {
        work: {
          label: "Work",
          baseUrl: "https://work.mem9.ai",
          apiKey: "mk_existing_work_123",
        },
      },
    });

    const state = await autoProvisionDefaultProfile({
      cwd: repo,
      mem9Home,
      env: {},
      async provisionFn(baseUrl) {
        calls += 1;
        assert.equal(baseUrl, DEFAULT_API_URL);
        return { apiKey: "mk_provisioned_9999", baseUrl };
      },
    });

    assert.equal(calls, 1);
    assert.ok(state);
    assert.equal(state.issueCode, "ready");
    assert.equal(state.authSource, "credentials");
    assert.equal(state.runtime.profileId, "default");
    assert.equal(state.runtime.apiKey, "mk_provisioned_9999");
    assert.equal(state.profiles.work.apiKey, "mk_existing_work_123");
    assert.equal(statSync(credsPath).mode & 0o777, 0o600);
    assert.equal(existsSync(state.paths.userConfigPath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("http helpers build requests, parse errors, handle 204, and provision via POST /v1alpha1/mem9s", async () => {
  assert.match(MEM9_PLUGIN_USER_AGENT, /^mem9-plugin\/antigravity\//);
  const headers = mem9Headers("mk_test_123456");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["X-API-Key"], "mk_test_123456");
  assert.equal(headers["X-Mnemo-Agent-Id"], "antigravity");
  assert.equal(headers["User-Agent"], MEM9_PLUGIN_USER_AGENT);
  assert.equal(
    buildMem9Url("https://api.mem9.ai/", "/v1alpha2/mem9s/memories").toString(),
    "https://api.mem9.ai/v1alpha2/mem9s/memories",
  );

  const server = await withHttpServer((req, res) => {
    if (req.method === "POST" && req.url === "/v1alpha1/mem9s") {
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "mk_live_provisioned_1234" }));
      return;
    }
    if (req.url === "/empty") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url === "/fail") {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Rate limited",
          details: {
            errorCategory: "runtime_quota_denied",
            runtimeQuota: {
              meter: "memory_recall_requests",
              quotaGateResult: { reason: "postQuotaRateLimitExceeded" },
              retryAfterSeconds: 30,
              recommendedAction: {
                providerActionCode: "upgradePlan",
                url: "https://console.mem9.ai/billing",
              },
            },
          },
        }),
      );
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  try {
    const provisioned = await provisionMem9Space(server.baseUrl);
    assert.deepEqual(provisioned, {
      apiKey: "mk_live_provisioned_1234",
      baseUrl: server.baseUrl,
    });

    const empty = await mem9FetchJson(buildMem9Url(server.baseUrl, "/empty"));
    assert.equal(empty, null);

    await assert.rejects(
      () => mem9FetchJson(buildMem9Url(server.baseUrl, "/fail")),
      (err) => {
        assert.ok(err instanceof Mem9HttpError);
        assert.equal(err.status, 429);
        const denied = parseRuntimeQuotaDenied(err);
        assert.ok(denied);
        assert.equal(denied.retryAfterSeconds, 30);
        const notice = formatRuntimeQuotaNotice(err, "recall");
        assert.match(notice, /Mem9 recall is temporarily unavailable/);
        assert.match(notice, /https:\/\/console\.mem9\.ai\/billing/);
        const payload = toolErrorPayload(err);
        assert.equal(payload.ok, false);
        assert.equal(payload.status_code, 429);
        assert.equal(payload.code, "runtime_quota_denied");
        assert.equal(payload.action_url, "https://console.mem9.ai/billing");
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("quota-error formats runtime state notices, resolves fail-soft, and deduplicates notices per session", async () => {
  const root = makeTempDir("mem9-notices-");
  try {
    const notice = formatRuntimeStateNotice({
      mem9ApiKey: { status: "active" },
      meters: [
        {
          meter: "memory_recall_requests",
          budgets: [
            {
              type: "includedQuota",
              state: "warning",
              usage: { percent: 85 },
            },
          ],
        },
      ],
      recommendedAction: {
        providerActionCode: "claimApiKey",
        severity: "blocking",
        url: "https://console.mem9.ai/claim",
      },
    });
    assert.match(notice, /Mem9 needs account or billing attention/);
    assert.match(notice, /https:\/\/console\.mem9\.ai\/claim/);

    const failSoft = await resolveRuntimeStateNotice({
      runtime: { baseUrl: DEFAULT_API_URL, apiKey: "mk_test_123", defaultTimeoutMs: 1000 },
      async fetchState() {
        throw new Error("network down");
      },
    });
    assert.equal(failSoft, "");

    const stateFile = path.join(root, "runtime-notices.json");
    const secretMessage = "Notice with unique text for session deduplication";
    assert.equal(
      claimRuntimeNotice({ stateFile, sessionId: "s-1", message: secretMessage }),
      true,
    );
    assert.equal(
      claimRuntimeNotice({ stateFile, sessionId: "s-1", message: secretMessage }),
      false,
    );
    assert.equal(
      claimRuntimeNotice({ stateFile, sessionId: "s-2", message: secretMessage }),
      true,
    );

    const rawFile = readFileSync(stateFile, "utf8");
    assert.equal(rawFile.includes(secretMessage), false);
    assert.equal(rawFile.includes(noticeHash(secretMessage)), true);

    // Cap at 50 sessions
    for (let i = 1; i <= 55; i += 1) {
      claimRuntimeNotice({
        stateFile,
        sessionId: `cap-${i}`,
        message: "Quota warning",
      });
    }
    const saved = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.equal(Object.keys(saved.sessions).length, 50);
    assert.equal(Boolean(saved.sessions["cap-55"]), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("debug logger writes sanitized JSONL only when MEM9_DEBUG is enabled", () => {
  const root = makeTempDir("mem9-debug-");
  try {
    const logPath = path.join(root, "logs", "hooks.jsonl");
    assert.equal(isDebugEnabled({}), false);
    assert.equal(isDebugEnabled({ MEM9_DEBUG: "0" }), false);
    assert.equal(isDebugEnabled({ MEM9_DEBUG: "1" }), true);
    assert.equal(isDebugEnabled({ MEM9_DEBUG: "true" }), true);

    const disabledWrite = appendDebugLog({
      logPath,
      hook: "PreInvocation",
      stage: "test",
      fields: { ok: true },
      env: {},
    });
    assert.equal(disabledWrite, false);
    assert.equal(existsSync(logPath), false);

    const enabledWrite = appendDebugLog({
      logPath,
      hook: "PreInvocation",
      stage: "recall",
      env: { MEM9_DEBUG: "1" },
      fields: {
        apiKey: "mk_super_secret_123456",
        prompt: "Full user prompt must never appear in debug logs",
        content: "Full message content must never appear in debug logs",
        queryChars: 42,
        note: "Failed using Bearer abcdefghij123456 and mn9_secretvalue999",
      },
    });
    assert.equal(enabledWrite, true);

    const errorWrite = appendDebugError({
      logPath,
      hook: "Stop",
      stage: "failed",
      env: { MEM9_DEBUG: "1" },
      error: new Error("Request failed with mk_embedded_secret_123"),
    });
    assert.equal(errorWrite, true);

    const lines = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].apiKey, "[redacted]");
    assert.equal(lines[0].queryChars, 42);
    assert.doesNotMatch(JSON.stringify(lines), /super_secret/);
    assert.doesNotMatch(JSON.stringify(lines), /Full user prompt/);
    assert.doesNotMatch(JSON.stringify(lines), /Full message content/);
    assert.doesNotMatch(JSON.stringify(lines), /abcdefghij123456/);
    assert.doesNotMatch(JSON.stringify(lines), /mn9_secretvalue999/);
    assert.doesNotMatch(JSON.stringify(lines), /mk_embedded_secret_123/);

    chmodSync(logPath, 0o600);
    assert.equal(statSync(logPath).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
