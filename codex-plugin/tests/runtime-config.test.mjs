import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AGENT_ID,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  loadRuntimeFromDisk,
  loadRuntimeStateFromDisk,
  resolveMem9Home,
  resolveRuntimeConfig,
} from "../runtime/shared/config.mjs";
import { resolveProjectRoot } from "../runtime/shared/project-root.mjs";

const REPO_ROOT = "/workspace/app";
const PROJECT_CWD = "/workspace/app/packages/web";
const OUTSIDE_CWD = "/workspace/scratch";
const CODEX_HOME = "/CODEX_HOME";
const MEM9_HOME = "/MEM9_HOME";

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
  const state = loadRuntimeStateFromDisk({
    cwd: OUTSIDE_CWD,
    codexHome: CODEX_HOME,
    mem9Home: MEM9_HOME,
    env: {},
    /** @param {string} filePath */
    exists(filePath) {
      return filePath === `${CODEX_HOME}/mem9/config.json`;
    },
    /** @param {string} filePath */
    readJson(filePath) {
      if (filePath === `${CODEX_HOME}/mem9/config.json`) {
        return {
          schemaVersion: 1,
          profileId: "default",
        };
      }

      assert.equal(filePath, `${MEM9_HOME}/.credentials.json`);
      return {
        schemaVersion: 1,
        profiles: {
          default: {
            label: "Personal",
            baseUrl: "https://api.mem9.ai",
            apiKey: "key-1",
          },
        },
      };
    },
  });

  assert.equal(state.projectRoot, null);
  assert.equal(state.configSource, "global");
  assert.equal(state.projectConfigMatched, false);
  assert.equal(state.scope, "user");
  assert.equal(state.issueCode, "ready");
  assert.equal(state.runtime.profileId, "default");
});

test("inside a repo without a project override still uses the global config", () => {
  const state = loadRuntimeStateFromDisk({
    cwd: PROJECT_CWD,
    codexHome: CODEX_HOME,
    mem9Home: MEM9_HOME,
    env: {},
    exists(filePath) {
      return (
        filePath === `${REPO_ROOT}/.git`
        || filePath === `${CODEX_HOME}/mem9/config.json`
      );
    },
    readJson(filePath) {
      if (filePath === `${CODEX_HOME}/mem9/config.json`) {
        return {
          schemaVersion: 1,
          profileId: "default",
          defaultTimeoutMs: 8_400,
        };
      }

      assert.equal(filePath, `${MEM9_HOME}/.credentials.json`);
      return {
        schemaVersion: 1,
        profiles: {
          default: {
            label: "Personal",
            baseUrl: "https://api.mem9.ai",
            apiKey: "global-key",
          },
        },
      };
    },
  });

  assert.equal(state.projectRoot, REPO_ROOT);
  assert.equal(state.configSource, "global");
  assert.equal(state.projectConfigMatched, false);
  assert.equal(state.scope, "user");
  assert.equal(state.issueCode, "ready");
  assert.equal(state.runtime.profileId, "default");
  assert.equal(state.runtime.defaultTimeoutMs, 8_400);
});

test("project override wins over global config", () => {
  const state = loadRuntimeStateFromDisk({
    cwd: PROJECT_CWD,
    codexHome: CODEX_HOME,
    mem9Home: MEM9_HOME,
    env: {},
    /** @param {string} filePath */
    exists(filePath) {
      return (
        filePath === `${REPO_ROOT}/.git`
        || filePath === `${CODEX_HOME}/mem9/config.json`
        || filePath === `${REPO_ROOT}/.codex/mem9/config.json`
      );
    },
    /** @param {string} filePath */
    readJson(filePath) {
      if (filePath === `${CODEX_HOME}/mem9/config.json`) {
        return {
          schemaVersion: 1,
          profileId: "default",
          defaultTimeoutMs: 8_100,
          searchTimeoutMs: 15_100,
        };
      }

      if (filePath === `${REPO_ROOT}/.codex/mem9/config.json`) {
        return {
          schemaVersion: 1,
          profileId: "work",
          searchTimeoutMs: 16_200,
        };
      }

      assert.equal(filePath, `${MEM9_HOME}/.credentials.json`);
      return {
        schemaVersion: 1,
        profiles: {
          default: {
            label: "Personal",
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
    },
  });

  const runtime = loadRuntimeFromDisk({
    cwd: PROJECT_CWD,
    codexHome: CODEX_HOME,
    mem9Home: MEM9_HOME,
    env: {},
    /** @param {string} filePath */
    exists(filePath) {
      return (
        filePath === `${REPO_ROOT}/.git`
        || filePath === `${CODEX_HOME}/mem9/config.json`
        || filePath === `${REPO_ROOT}/.codex/mem9/config.json`
      );
    },
    readJson(filePath) {
      if (filePath === `${CODEX_HOME}/mem9/config.json`) {
        return {
          schemaVersion: 1,
          profileId: "default",
          defaultTimeoutMs: 8_100,
          searchTimeoutMs: 15_100,
        };
      }

      if (filePath === `${REPO_ROOT}/.codex/mem9/config.json`) {
        return {
          schemaVersion: 1,
          profileId: "work",
          searchTimeoutMs: 16_200,
        };
      }

      assert.equal(filePath, `${MEM9_HOME}/.credentials.json`);
      return {
        schemaVersion: 1,
        profiles: {
          default: {
            label: "Personal",
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
    },
  });

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
});

test("a project override can be ready without a global config file", () => {
  const runtime = loadRuntimeFromDisk({
    cwd: PROJECT_CWD,
    codexHome: CODEX_HOME,
    mem9Home: MEM9_HOME,
    env: {},
    exists(filePath) {
      return (
        filePath === `${REPO_ROOT}/.git`
        || filePath === `${REPO_ROOT}/.codex/mem9/config.json`
      );
    },
    readJson(filePath) {
      if (filePath === `${REPO_ROOT}/.codex/mem9/config.json`) {
        return {
          schemaVersion: 1,
          profileId: "work",
          defaultTimeoutMs: 8_250,
        };
      }

      assert.equal(filePath, `${MEM9_HOME}/.credentials.json`);
      return {
        schemaVersion: 1,
        profiles: {
          work: {
            label: "Work",
            baseUrl: "https://work.mem9.ai",
            apiKey: "project-key",
          },
        },
      };
    },
  });

  assert.equal(runtime.scope, "project");
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.profileId, "work");
  assert.equal(runtime.baseUrl, "https://work.mem9.ai");
  assert.equal(runtime.defaultTimeoutMs, 8_250);
});

test("enabled false short-circuits missing profile and api key validation", () => {
  const state = loadRuntimeStateFromDisk({
    cwd: PROJECT_CWD,
    codexHome: CODEX_HOME,
    mem9Home: MEM9_HOME,
    env: {},
    /** @param {string} filePath */
    exists(filePath) {
      return (
        filePath === `${REPO_ROOT}/.git`
        || filePath === `${REPO_ROOT}/.codex/mem9/config.json`
      );
    },
    /** @param {string} filePath */
    readJson(filePath) {
      if (filePath === `${REPO_ROOT}/.codex/mem9/config.json`) {
        return {
          schemaVersion: 1,
          enabled: false,
        };
      }

      assert.equal(filePath, `${MEM9_HOME}/.credentials.json`);
      return {
        schemaVersion: 1,
        profiles: {},
      };
    },
  });

  assert.equal(state.configSource, "project");
  assert.equal(state.projectConfigMatched, true);
  assert.equal(state.scope, "project");
  assert.equal(state.runtime.enabled, false);
  assert.equal(state.runtime.profileId, "");
  assert.equal(state.runtime.apiKey, "");
  assert.equal(state.issueCode, "disabled");
});

test("invalid project override surfaces invalid_config", () => {
  const state = loadRuntimeStateFromDisk({
    cwd: PROJECT_CWD,
    codexHome: CODEX_HOME,
    mem9Home: MEM9_HOME,
    env: {},
    /** @param {string} filePath */
    exists(filePath) {
      return (
        filePath === `${REPO_ROOT}/.git`
        || filePath === `${CODEX_HOME}/mem9/config.json`
        || filePath === `${REPO_ROOT}/.codex/mem9/config.json`
      );
    },
    /** @param {string} filePath */
    readJson(filePath) {
      if (filePath === `${CODEX_HOME}/mem9/config.json`) {
        return {
          schemaVersion: 1,
          profileId: "default",
        };
      }

      if (filePath === `${REPO_ROOT}/.codex/mem9/config.json`) {
        throw new SyntaxError("Unexpected token");
      }

      assert.equal(filePath, `${MEM9_HOME}/.credentials.json`);
      return {
        schemaVersion: 1,
        profiles: {
          default: {
            label: "Personal",
            baseUrl: "https://api.mem9.ai",
            apiKey: "key-1",
          },
        },
      };
    },
  });

  assert.equal(state.configSource, "project");
  assert.equal(state.projectConfigMatched, true);
  assert.equal(state.scope, "project");
  assert.equal(state.issueCode, "invalid_config");
});

test("loadRuntimeFromDisk throws when the runtime state is not ready", () => {
  assert.throws(
    () => loadRuntimeFromDisk({
      cwd: PROJECT_CWD,
      codexHome: CODEX_HOME,
      mem9Home: MEM9_HOME,
      env: {},
      exists(filePath) {
        return (
          filePath === `${REPO_ROOT}/.git`
          || filePath === `${REPO_ROOT}/.codex/mem9/config.json`
        );
      },
      readJson(filePath) {
        if (filePath === `${REPO_ROOT}/.codex/mem9/config.json`) {
          return {
            schemaVersion: 1,
            enabled: false,
          };
        }

        return {
          schemaVersion: 1,
          profiles: {},
        };
      },
    }),
    /mem9 runtime is not ready: disabled/,
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
