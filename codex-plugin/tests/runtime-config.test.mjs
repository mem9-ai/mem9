// @ts-nocheck

import assert from "node:assert/strict";
import test from "node:test";

import { buildSessionStartMessage } from "../hooks/session-start.mjs";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  loadRuntimeFromDisk,
  loadRuntimeStateFromDisk,
  resolveMem9Home,
  resolveRuntimeConfig,
} from "../lib/config.mjs";
import { resolveProjectRoot } from "../lib/project-root.mjs";

const REPO_ROOT = "/workspace/app";
const PROJECT_CWD = "/workspace/app/packages/web";
const OUTSIDE_CWD = "/workspace/scratch";
const CODEX_HOME = "/CODEX_HOME";
const MEM9_HOME = "/MEM9_HOME";
const GLOBAL_CONFIG_PATH = `${CODEX_HOME}/mem9/config.json`;
const PROJECT_CONFIG_PATH = `${REPO_ROOT}/.codex/mem9/config.json`;
const CREDENTIALS_PATH = `${MEM9_HOME}/.credentials.json`;
const CONFIG_TOML_PATH = `${CODEX_HOME}/config.toml`;
const INSTALL_PATH = `${CODEX_HOME}/mem9/install.json`;
const PLUGIN_DIR = `${CODEX_HOME}/plugins/cache/mem9-ai/mem9`;

const DEFAULT_INSTALL = {
  schemaVersion: 1,
  marketplaceName: "mem9-ai",
  pluginName: "mem9",
  shimVersion: 1,
};

const DEFAULT_CREDENTIALS = {
  schemaVersion: 1,
  profiles: {
    default: {
      label: "Default",
      baseUrl: "https://api.mem9.ai",
      apiKey: "global-key",
    },
    work: {
      label: "Work",
      baseUrl: "https://work.mem9.ai",
      apiKey: "project-key",
    },
  },
};

function createRuntimeDisk(options = {}) {
  const cwd = options.cwd ?? PROJECT_CWD;
  const jsonFiles = new Map();
  const textFiles = new Map();
  const dirNames = new Map();
  const invalidJsonPaths = new Set(options.invalidJsonPaths ?? []);
  const existingPaths = new Set(options.existingPaths ?? []);

  if (cwd.startsWith(`${REPO_ROOT}/`) || cwd === REPO_ROOT) {
    existingPaths.add(`${REPO_ROOT}/.git`);
  }

  if (options.globalConfig !== undefined) {
    jsonFiles.set(GLOBAL_CONFIG_PATH, options.globalConfig);
    existingPaths.add(GLOBAL_CONFIG_PATH);
  }

  if (options.projectConfig !== undefined) {
    jsonFiles.set(PROJECT_CONFIG_PATH, options.projectConfig);
    existingPaths.add(PROJECT_CONFIG_PATH);
  }

  if (options.credentials !== undefined) {
    jsonFiles.set(CREDENTIALS_PATH, options.credentials);
    existingPaths.add(CREDENTIALS_PATH);
  }

  if (options.installMetadata !== undefined && options.installMetadata !== null) {
    jsonFiles.set(INSTALL_PATH, options.installMetadata);
    existingPaths.add(INSTALL_PATH);
  }

  if (options.configToml !== undefined && options.configToml !== null) {
    textFiles.set(CONFIG_TOML_PATH, options.configToml);
    existingPaths.add(CONFIG_TOML_PATH);
  }

  dirNames.set(PLUGIN_DIR, options.pluginVersions ?? ["local"]);

  return {
    cwd,
    codexHome: CODEX_HOME,
    mem9Home: MEM9_HOME,
    env: options.env ?? {},
    exists(filePath) {
      return existingPaths.has(filePath);
    },
    readJson(filePath) {
      if (invalidJsonPaths.has(filePath)) {
        throw new SyntaxError(`invalid json: ${filePath}`);
      }

      if (jsonFiles.has(filePath)) {
        return jsonFiles.get(filePath);
      }

      throw new Error(`unexpected json path: ${filePath}`);
    },
    readText(filePath) {
      if (textFiles.has(filePath)) {
        return textFiles.get(filePath);
      }

      throw new Error(`unexpected text path: ${filePath}`);
    },
    readDirNames(dirPath) {
      if (dirNames.has(dirPath)) {
        return dirNames.get(dirPath);
      }

      throw new Error(`missing dir: ${dirPath}`);
    },
  };
}

test("resolveProjectRoot walks up to the nearest git marker", () => {
  const projectRoot = resolveProjectRoot({
    cwd: `${REPO_ROOT}/packages/web/src`,
    exists(filePath) {
      return filePath === `${REPO_ROOT}/packages/web/.git`;
    },
  });

  assert.equal(projectRoot, `${REPO_ROOT}/packages/web`);
});

test("loadRuntimeStateFromDisk falls back to global config outside repos", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    cwd: OUTSIDE_CWD,
    globalConfig: {
      schemaVersion: 1,
      profileId: "default",
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: "",
  }));

  assert.equal(state.projectRoot, null);
  assert.equal(state.configSource, "global");
  assert.equal(state.projectConfigMatched, false);
  assert.equal(state.scope, "user");
  assert.equal(state.issueCode, "ready");
  assert.equal(state.runtime.profileId, "default");
});

test("inside a repo without a project override still uses the global config", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    globalConfig: {
      schemaVersion: 1,
      profileId: "default",
      defaultTimeoutMs: 8_400,
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: "",
  }));

  assert.equal(state.projectRoot, REPO_ROOT);
  assert.equal(state.configSource, "global");
  assert.equal(state.projectConfigMatched, false);
  assert.equal(state.scope, "user");
  assert.equal(state.issueCode, "ready");
  assert.equal(state.runtime.profileId, "default");
  assert.equal(state.runtime.defaultTimeoutMs, 8_400);
});

test("project override resolves fields by precedence", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    globalConfig: {
      schemaVersion: 1,
      profileId: "default",
      defaultTimeoutMs: 8_100,
      searchTimeoutMs: 15_100,
    },
    projectConfig: {
      schemaVersion: 1,
      profileId: "work",
      searchTimeoutMs: 16_200,
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: "",
  }));

  const runtime = loadRuntimeFromDisk(createRuntimeDisk({
    globalConfig: {
      schemaVersion: 1,
      profileId: "default",
      defaultTimeoutMs: 8_100,
      searchTimeoutMs: 15_100,
    },
    projectConfig: {
      schemaVersion: 1,
      profileId: "work",
      searchTimeoutMs: 16_200,
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: "",
  }));

  assert.equal(state.projectRoot, REPO_ROOT);
  assert.equal(state.configSource, "project");
  assert.equal(state.projectConfigMatched, true);
  assert.equal(state.scope, "project");
  assert.equal(state.issueCode, "ready");
  assert.equal(runtime.scope, "project");
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.profileId, "work");
  assert.equal(runtime.baseUrl, "https://work.mem9.ai");
  assert.equal(runtime.apiKey, "project-key");
  assert.equal(runtime.defaultTimeoutMs, 8_100);
  assert.equal(runtime.searchTimeoutMs, 16_200);
  assert.equal(runtime.updateCheck.enabled, true);
  assert.equal(runtime.updateCheck.intervalHours, 24);
});

test("runtime defaults update checks when the global config does not set them", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    globalConfig: {
      schemaVersion: 1,
      profileId: "default",
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: "",
    pluginVersions: ["0.2.0"],
  }));

  assert.equal(state.issueCode, "ready");
  assert.equal(state.runtime.updateCheck.enabled, true);
  assert.equal(state.runtime.updateCheck.intervalHours, 24);
});

test("project override does not override global update-check settings", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    globalConfig: {
      schemaVersion: 1,
      profileId: "default",
      updateCheck: {
        enabled: false,
        intervalHours: 48,
      },
    },
    projectConfig: {
      schemaVersion: 1,
      profileId: "work",
      updateCheck: {
        enabled: true,
        intervalHours: 1,
      },
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: "",
    pluginVersions: ["0.2.0"],
  }));

  assert.equal(state.issueCode, "ready");
  assert.equal(state.configSource, "project");
  assert.equal(state.runtime.profileId, "work");
  assert.equal(state.runtime.updateCheck.enabled, false);
  assert.equal(state.runtime.updateCheck.intervalHours, 48);
});

test("a project override can be ready without a global config file", () => {
  const runtime = loadRuntimeFromDisk(createRuntimeDisk({
    projectConfig: {
      schemaVersion: 1,
      profileId: "work",
      defaultTimeoutMs: 8_250,
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: "",
  }));

  assert.equal(runtime.scope, "project");
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.profileId, "work");
  assert.equal(runtime.baseUrl, "https://work.mem9.ai");
  assert.equal(runtime.defaultTimeoutMs, 8_250);
});

test("plugin disabled via config.toml returns plugin_disabled", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    globalConfig: {
      schemaVersion: 1,
      profileId: "default",
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: '[plugins."mem9@mem9-ai"]\nenabled = false\n',
  }));

  assert.equal(state.pluginState, "plugin_disabled");
  assert.equal(state.issueCode, "plugin_disabled");
});

test("plugin disabled parser accepts a table header with surrounding whitespace and a trailing comment", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    globalConfig: {
      schemaVersion: 1,
      profileId: "default",
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: ' \t[plugins."mem9@mem9-ai"]   # managed by codex\n enabled = false\n',
  }));

  assert.equal(state.pluginState, "plugin_disabled");
  assert.equal(state.issueCode, "plugin_disabled");
});

test("plugin disabled parser stops at the next table header even when it has a trailing comment", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    globalConfig: {
      schemaVersion: 1,
      profileId: "default",
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: [
      '[plugins."mem9@mem9-ai"]',
      "enabled = false",
      "[plugins.other] # keep reading after this header",
      "enabled = true",
      "",
    ].join("\n"),
  }));

  assert.equal(state.pluginState, "plugin_disabled");
  assert.equal(state.issueCode, "plugin_disabled");
});

test("missing install metadata returns plugin_missing", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    globalConfig: {
      schemaVersion: 1,
      profileId: "default",
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: null,
    configToml: "",
  }));

  assert.equal(state.pluginState, "plugin_missing");
  assert.equal(state.pluginIssueDetail, "missing_install_metadata");
  assert.equal(state.issueCode, "plugin_missing");
});

test("missing active plugin root returns plugin_missing", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    globalConfig: {
      schemaVersion: 1,
      profileId: "default",
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: "",
    pluginVersions: [],
  }));

  assert.equal(state.pluginState, "plugin_missing");
  assert.equal(state.pluginIssueDetail, "missing_active_plugin_root");
  assert.equal(state.issueCode, "plugin_missing");
});

test("legacy paused uses project precedence inside a repo", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    globalConfig: {
      schemaVersion: 1,
      enabled: false,
      profileId: "default",
    },
    projectConfig: {
      schemaVersion: 1,
      enabled: false,
      profileId: "work",
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: "",
  }));

  assert.equal(state.issueCode, "legacy_paused");
  assert.deepEqual(state.legacyPausedSources, ["global", "project"]);
  assert.equal(state.effectiveLegacyPausedSource, "project");
});

test("legacy paused uses the global source outside a repo", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    cwd: OUTSIDE_CWD,
    globalConfig: {
      schemaVersion: 1,
      enabled: false,
      profileId: "default",
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: "",
  }));

  assert.equal(state.issueCode, "legacy_paused");
  assert.deepEqual(state.legacyPausedSources, ["global"]);
  assert.equal(state.effectiveLegacyPausedSource, "global");
});

test("a valid project override suppresses a global legacy pause", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    globalConfig: {
      schemaVersion: 1,
      enabled: false,
      profileId: "default",
      defaultTimeoutMs: 8_200,
    },
    projectConfig: {
      schemaVersion: 1,
      searchTimeoutMs: 16_400,
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: "",
  }));

  assert.equal(state.issueCode, "ready");
  assert.equal(state.configSource, "project");
  assert.equal(state.runtime.profileId, "default");
  assert.equal(state.runtime.defaultTimeoutMs, 8_200);
  assert.equal(state.runtime.searchTimeoutMs, 16_400);
});

test("invalid global config is ignored when a valid project override provides a profile", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    invalidJsonPaths: [GLOBAL_CONFIG_PATH],
    existingPaths: [GLOBAL_CONFIG_PATH],
    projectConfig: {
      schemaVersion: 1,
      profileId: "work",
      defaultTimeoutMs: 8_600,
    },
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: "",
  }));

  assert.equal(state.issueCode, "ready");
  assert.equal(state.configSource, "project");
  assert.deepEqual(state.warnings, ["invalid_global_config_ignored"]);
  assert.equal(state.runtime.profileId, "work");
  assert.equal(state.runtime.defaultTimeoutMs, 8_600);
});

test("invalid project config is ignored when the global default is valid", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    globalConfig: {
      schemaVersion: 1,
      profileId: "default",
      defaultTimeoutMs: 8_500,
    },
    invalidJsonPaths: [PROJECT_CONFIG_PATH],
    existingPaths: [PROJECT_CONFIG_PATH],
    credentials: DEFAULT_CREDENTIALS,
    installMetadata: DEFAULT_INSTALL,
    configToml: "",
  }));

  assert.equal(state.issueCode, "ready");
  assert.equal(state.configSource, "global");
  assert.deepEqual(state.warnings, ["invalid_project_config_ignored"]);
  assert.equal(state.scope, "user");
  assert.equal(state.projectConfigMatched, true);
  assert.equal(state.runtime.profileId, "default");
  assert.equal(state.runtime.defaultTimeoutMs, 8_500);
});

for (const scenario of [
  {
    name: "global missing plus project missing returns missing_config",
    options: {
      installMetadata: DEFAULT_INSTALL,
      credentials: DEFAULT_CREDENTIALS,
      configToml: "",
    },
    expectedIssueCode: "missing_config",
  },
  {
    name: "global missing plus project invalid returns invalid_config",
    options: {
      invalidJsonPaths: [PROJECT_CONFIG_PATH],
      existingPaths: [PROJECT_CONFIG_PATH],
      installMetadata: DEFAULT_INSTALL,
      credentials: DEFAULT_CREDENTIALS,
      configToml: "",
    },
    expectedIssueCode: "invalid_config",
  },
  {
    name: "global invalid plus project missing returns invalid_config",
    options: {
      invalidJsonPaths: [GLOBAL_CONFIG_PATH],
      existingPaths: [GLOBAL_CONFIG_PATH],
      installMetadata: DEFAULT_INSTALL,
      credentials: DEFAULT_CREDENTIALS,
      configToml: "",
    },
    expectedIssueCode: "invalid_config",
  },
  {
    name: "global invalid plus project invalid returns invalid_config",
    options: {
      invalidJsonPaths: [GLOBAL_CONFIG_PATH, PROJECT_CONFIG_PATH],
      existingPaths: [GLOBAL_CONFIG_PATH, PROJECT_CONFIG_PATH],
      installMetadata: DEFAULT_INSTALL,
      credentials: DEFAULT_CREDENTIALS,
      configToml: "",
    },
    expectedIssueCode: "invalid_config",
  },
]) {
  test(scenario.name, () => {
    const state = loadRuntimeStateFromDisk(createRuntimeDisk(scenario.options));
    assert.equal(state.issueCode, scenario.expectedIssueCode);
  });
}

test("session start guidance for a broken project override points to project repair and global setup", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    invalidJsonPaths: [PROJECT_CONFIG_PATH],
    existingPaths: [PROJECT_CONFIG_PATH],
    installMetadata: DEFAULT_INSTALL,
    credentials: DEFAULT_CREDENTIALS,
    configToml: "",
  }));
  const message = buildSessionStartMessage({
    configSource: state.configSource,
    projectConfigMatched: state.projectConfigMatched,
    profileId: state.runtime.profileId,
    warnings: state.warnings,
    legacyPausedSources: state.legacyPausedSources,
    effectiveLegacyPausedSource: state.effectiveLegacyPausedSource,
    issueCode: state.issueCode,
  });

  assert.equal(state.issueCode, "invalid_config");
  assert.equal(state.projectConfigMatched, true);
  assert.match(message, /\.codex\/mem9\/config\.json/);
  assert.match(message, /\$mem9:setup/);
  assert.match(message, /reapply or clear project scope/);
  assert.doesNotMatch(message, /--reset/);
});

test("session start guidance for broken global and project configs avoids reset guidance", () => {
  const state = loadRuntimeStateFromDisk(createRuntimeDisk({
    invalidJsonPaths: [GLOBAL_CONFIG_PATH, PROJECT_CONFIG_PATH],
    existingPaths: [GLOBAL_CONFIG_PATH, PROJECT_CONFIG_PATH],
    installMetadata: DEFAULT_INSTALL,
    credentials: DEFAULT_CREDENTIALS,
    configToml: "",
  }));
  const message = buildSessionStartMessage({
    configSource: state.configSource,
    projectConfigMatched: state.projectConfigMatched,
    profileId: state.runtime.profileId,
    warnings: state.warnings,
    legacyPausedSources: state.legacyPausedSources,
    effectiveLegacyPausedSource: state.effectiveLegacyPausedSource,
    issueCode: state.issueCode,
  });

  assert.equal(state.issueCode, "invalid_config");
  assert.equal(state.projectConfigMatched, true);
  assert.match(message, /\$mem9:setup/);
  assert.match(message, /reapply or clear project scope/);
  assert.doesNotMatch(message, /--reset/);
});

test("loadRuntimeFromDisk throws when the runtime state is not ready", () => {
  assert.throws(
    () => loadRuntimeFromDisk(createRuntimeDisk({
      globalConfig: {
        schemaVersion: 1,
        profileId: "default",
      },
      credentials: DEFAULT_CREDENTIALS,
      installMetadata: DEFAULT_INSTALL,
      configToml: '[plugins."mem9@mem9-ai"]\nenabled = false\n',
    })),
    /mem9 runtime is not ready: plugin_disabled/,
  );
});

test("env overrides still replace api url and api key", () => {
  const runtime = resolveRuntimeConfig({
    scope: "user",
    config: {
      schemaVersion: 1,
      profileId: "default",
    },
    credentials: {
      schemaVersion: 1,
      profiles: {
        default: {
          label: "Personal",
          baseUrl: "https://api.mem9.ai",
          apiKey: "disk-key",
        },
      },
    },
    env: {
      MEM9_API_URL: "https://override.example/",
      MEM9_API_KEY: "env-key",
    },
  });

  assert.equal(runtime.scope, "user");
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.baseUrl, "https://override.example");
  assert.equal(runtime.apiKey, "env-key");
  assert.equal(runtime.agentId, DEFAULT_AGENT_ID);
  assert.equal(runtime.defaultTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(runtime.searchTimeoutMs, DEFAULT_SEARCH_TIMEOUT_MS);
  assert.equal(runtime.updateCheck.enabled, true);
  assert.equal(runtime.updateCheck.intervalHours, 24);
});

test("resolveMem9Home uses MEM9_HOME and otherwise falls back to home .mem9", () => {
  assert.equal(
    resolveMem9Home(undefined, { MEM9_HOME: "/shared/mem9" }, "/home/example"),
    "/shared/mem9",
  );
  assert.equal(
    resolveMem9Home(undefined, {}, "/home/example"),
    "/home/example/.mem9",
  );
});
