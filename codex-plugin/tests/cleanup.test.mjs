// @ts-nocheck

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  inspectCleanup,
  runCleanup,
} from "../skills/cleanup/scripts/cleanup.mjs";
import { createTempRoot } from "./test-temp.mjs";

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function createCleanupFixture() {
  const tempRoot = createTempRoot("cleanup");
  const projectRoot = path.join(tempRoot, "repo");
  const codexHome = path.join(tempRoot, "codex-home");
  const mem9Home = path.join(tempRoot, "mem9-home");

  mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
  mkdirSync(path.join(codexHome, "mem9", "hooks"), { recursive: true });
  mkdirSync(path.join(codexHome, "mem9", "logs"), { recursive: true });

  writeJson(path.join(codexHome, "hooks.json"), {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: `node ${path.join(codexHome, "mem9", "hooks", "session-start.mjs")}`,
              statusMessage: "[mem9] session start",
            },
            {
              type: "command",
              command: "echo foreign-session-start",
              statusMessage: "foreign-session-start",
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `node ${path.join(codexHome, "mem9", "hooks", "user-prompt-submit.mjs")}`,
              statusMessage: "[mem9] recall",
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: `node ${path.join(codexHome, "mem9", "hooks", "stop.mjs")}`,
              statusMessage: "[mem9] save",
            },
          ],
        },
      ],
    },
  });
  writeFileSync(path.join(codexHome, "mem9", "hooks", "session-start.mjs"), "export {};\n");
  writeJson(path.join(codexHome, "mem9", "install.json"), {
    pluginVersion: "local",
  });
  writeJson(path.join(codexHome, "mem9", "config.json"), {
    schemaVersion: 1,
    enabled: true,
    profileId: "default",
  });
  writeJson(path.join(codexHome, "mem9", "state.json"), {
    schemaVersion: 1,
    lastSeenVersion: "0.1.0",
  });
  writeJson(path.join(projectRoot, ".codex", "mem9", "config.json"), {
    schemaVersion: 1,
    profileId: "work",
  });
  writeJson(path.join(mem9Home, ".credentials.json"), {
    schemaVersion: 1,
    profiles: {
      default: {
        label: "Default",
        baseUrl: "https://api.mem9.ai",
        apiKey: "secret-token",
      },
    },
  });
  writeFileSync(path.join(codexHome, "config.toml"), "[features]\ncodex_hooks = true\n");
  writeFileSync(
    path.join(codexHome, "mem9", "logs", "codex-hooks.jsonl"),
    "{\"event\":\"debug\"}\n",
  );

  return {
    tempRoot,
    projectRoot,
    codexHome,
    mem9Home,
  };
}

function createStdoutCapture() {
  const chunks = [];

  return {
    chunks,
    write(chunk) {
      chunks.push(chunk);
    },
  };
}

test("inspect reports sanitized removable targets", () => {
  const fixture = createCleanupFixture();

  try {
    const stdout = createStdoutCapture();
    const summary = inspectCleanup(["inspect"], {
      cwd: fixture.projectRoot,
      codexHome: fixture.codexHome,
      mem9Home: fixture.mem9Home,
      stdout,
    });

    assert.equal(summary.command, "inspect");
    assert.equal(summary.wouldRemove.global, true);
    assert.equal(summary.wouldRemove.project, true);
    assert.equal(summary.wouldRemove.any, true);
    assert.equal(summary.wouldRemove.credentials, false);
    assert.equal(summary.global.managedHooks.managedHookCount, 3);
    assert.equal(summary.global.managedHooks.wouldRemove, true);
    assert.equal(summary.global.hooksDir.path, "$CODEX_HOME/mem9/hooks");
    assert.equal(summary.global.installMetadata.path, "$CODEX_HOME/mem9/install.json");
    assert.equal(summary.global.globalConfig.path, "$CODEX_HOME/mem9/config.json");
    assert.equal(summary.global.stateFile.path, "$CODEX_HOME/mem9/state.json");
    assert.equal(summary.project.config.path, ".codex/mem9/config.json");
    assert.equal(summary.credentials.path, "$MEM9_HOME/.credentials.json");
    assert.equal(summary.configToml.path, "$CODEX_HOME/config.toml");
    assert.equal(summary.debugLogs.path, "$CODEX_HOME/mem9/logs/codex-hooks.jsonl");
    assert.deepEqual(summary.removableTargets.global, [
      {
        kind: "managedHooks",
        path: "$CODEX_HOME/hooks.json",
        managedHookCount: 3,
      },
      {
        kind: "hooksDir",
        path: "$CODEX_HOME/mem9/hooks",
      },
      {
        kind: "installMetadata",
        path: "$CODEX_HOME/mem9/install.json",
      },
      {
        kind: "globalConfig",
        path: "$CODEX_HOME/mem9/config.json",
      },
      {
        kind: "stateFile",
        path: "$CODEX_HOME/mem9/state.json",
      },
    ]);
    assert.deepEqual(summary.removableTargets.project, [
      {
        kind: "projectConfig",
        path: ".codex/mem9/config.json",
      },
    ]);
    assert.deepEqual(
      JSON.parse(stdout.chunks.join("").trim()),
      summary,
    );
  } finally {
    rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("run removes only mem9-managed global artifacts", () => {
  const fixture = createCleanupFixture();

  try {
    const stdout = createStdoutCapture();
    const result = runCleanup(["run"], {
      cwd: fixture.projectRoot,
      codexHome: fixture.codexHome,
      mem9Home: fixture.mem9Home,
      stdout,
    });

    assert.equal(result.command, "run");
    assert.equal(result.includeProject, false);
    assert.equal(result.removed.managedHooks, "updated");
    assert.equal(result.removed.hooksDir, true);
    assert.equal(result.removed.installMetadata, true);
    assert.equal(result.removed.globalConfig, true);
    assert.equal(result.removed.stateFile, true);
    assert.equal(result.removed.projectConfig, false);
    assert.equal(result.paths.hooksDir, "$CODEX_HOME/mem9/hooks");
    assert.equal(result.paths.projectConfig, ".codex/mem9/config.json");
    assert.deepEqual(
      JSON.parse(stdout.chunks.join("").trim()),
      result,
    );

    const hooks = readJson(path.join(fixture.codexHome, "hooks.json"));
    assert.equal(hooks.hooks.SessionStart.length, 1);
    assert.equal(hooks.hooks.SessionStart[0].hooks.length, 1);
    assert.equal(
      hooks.hooks.SessionStart[0].hooks[0].statusMessage,
      "foreign-session-start",
    );
    assert.equal(hooks.hooks.UserPromptSubmit.length, 0);
    assert.equal(hooks.hooks.Stop.length, 0);
    assert.equal(existsSync(path.join(fixture.codexHome, "mem9", "hooks")), false);
    assert.equal(existsSync(path.join(fixture.codexHome, "mem9", "install.json")), false);
    assert.equal(existsSync(path.join(fixture.codexHome, "mem9", "config.json")), false);
    assert.equal(existsSync(path.join(fixture.codexHome, "mem9", "state.json")), false);
    assert.equal(existsSync(path.join(fixture.projectRoot, ".codex", "mem9", "config.json")), true);
  } finally {
    rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("run leaves a foreign-only hooks.json byte-for-byte untouched", () => {
  const fixture = createCleanupFixture();

  try {
    const hooksPath = path.join(fixture.codexHome, "hooks.json");
    const foreignOnlyHooks = [
      "{",
      "  \"hooks\": {",
      "    \"SessionStart\": [",
      "      {",
      "        \"hooks\": [",
      "          {",
      "            \"statusMessage\": \"foreign-session-start\",",
      "            \"command\": \"echo foreign-session-start\",",
      "            \"type\": \"command\"",
      "          }",
      "        ]",
      "      }",
      "    ]",
      "  }",
      "}",
      "",
    ].join("\n");

    writeFileSync(hooksPath, foreignOnlyHooks);

    const result = runCleanup(["run"], {
      cwd: fixture.projectRoot,
      codexHome: fixture.codexHome,
      mem9Home: fixture.mem9Home,
      stdout: createStdoutCapture(),
    });

    assert.equal(result.removed.managedHooks, "already-clear");
    assert.equal(readFileSync(hooksPath, "utf8"), foreignOnlyHooks);
  } finally {
    rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("run preserves sparse foreign hook structure after removing mem9 hooks", () => {
  const fixture = createCleanupFixture();

  try {
    const hooksPath = path.join(fixture.codexHome, "hooks.json");
    writeJson(hooksPath, {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: `node ${path.join(fixture.codexHome, "mem9", "hooks", "session-start.mjs")}`,
                statusMessage: "[mem9] session start",
              },
              {
                type: "command",
                command: "echo foreign-session-start",
                statusMessage: "foreign-session-start",
              },
            ],
          },
        ],
      },
    });

    const result = runCleanup(["run"], {
      cwd: fixture.projectRoot,
      codexHome: fixture.codexHome,
      mem9Home: fixture.mem9Home,
      stdout: createStdoutCapture(),
    });

    assert.equal(result.removed.managedHooks, "updated");

    const hooks = readJson(hooksPath);
    assert.deepEqual(hooks, {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "echo foreign-session-start",
                statusMessage: "foreign-session-start",
              },
            ],
          },
        ],
      },
    });
    assert.equal("UserPromptSubmit" in hooks.hooks, false);
    assert.equal("Stop" in hooks.hooks, false);
  } finally {
    rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("run --include-project also removes the current project config", () => {
  const fixture = createCleanupFixture();

  try {
    const result = runCleanup(["run", "--include-project"], {
      cwd: fixture.projectRoot,
      codexHome: fixture.codexHome,
      mem9Home: fixture.mem9Home,
      stdout: createStdoutCapture(),
    });

    assert.equal(result.includeProject, true);
    assert.equal(result.removed.projectConfig, true);
    assert.equal(
      existsSync(path.join(fixture.projectRoot, ".codex", "mem9", "config.json")),
      false,
    );
  } finally {
    rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("inspect and run keep project paths readable from a nested repo cwd", () => {
  const fixture = createCleanupFixture();
  const nestedCwd = path.join(fixture.projectRoot, "packages", "web");
  mkdirSync(nestedCwd, { recursive: true });

  try {
    const inspectSummary = inspectCleanup(["inspect"], {
      cwd: nestedCwd,
      codexHome: fixture.codexHome,
      mem9Home: fixture.mem9Home,
      stdout: createStdoutCapture(),
    });

    assert.equal(inspectSummary.cwd, ".");
    assert.equal(inspectSummary.projectRoot, "../..");
    assert.equal(inspectSummary.project.config.path, ".codex/mem9/config.json");

    const runResult = runCleanup(["run", "--include-project"], {
      cwd: nestedCwd,
      codexHome: fixture.codexHome,
      mem9Home: fixture.mem9Home,
      stdout: createStdoutCapture(),
    });

    assert.equal(runResult.cwd, ".");
    assert.equal(runResult.projectRoot, "../..");
    assert.equal(runResult.paths.projectConfig, ".codex/mem9/config.json");
    assert.equal(runResult.removed.projectConfig, true);
  } finally {
    rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("cleanup preserves credentials, config.toml, and debug logs", () => {
  const fixture = createCleanupFixture();

  try {
    const credentialsPath = path.join(fixture.mem9Home, ".credentials.json");
    const configTomlPath = path.join(fixture.codexHome, "config.toml");
    const debugLogsPath = path.join(fixture.codexHome, "mem9", "logs", "codex-hooks.jsonl");
    const beforeCredentials = readFileSync(credentialsPath, "utf8");
    const beforeConfigToml = readFileSync(configTomlPath, "utf8");
    const beforeDebugLogs = readFileSync(debugLogsPath, "utf8");

    const result = runCleanup(["run", "--include-project"], {
      cwd: fixture.projectRoot,
      codexHome: fixture.codexHome,
      mem9Home: fixture.mem9Home,
      stdout: createStdoutCapture(),
    });

    assert.equal(result.credentials.untouched, true);
    assert.equal(result.configToml.untouched, true);
    assert.equal(result.debugLogs.untouched, true);
    assert.equal(readFileSync(credentialsPath, "utf8"), beforeCredentials);
    assert.equal(readFileSync(configTomlPath, "utf8"), beforeConfigToml);
    assert.equal(readFileSync(debugLogsPath, "utf8"), beforeDebugLogs);
  } finally {
    rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});
