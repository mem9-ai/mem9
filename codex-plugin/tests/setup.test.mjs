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
  applyCodexHooksPatch,
  assertNodeVersion,
  buildInstallMetadata,
  buildNodeCommand,
  buildHookCommands,
  inspectSetup,
  main,
  mergeMem9Hooks,
  parseArgs,
  removeManagedHooks,
  renderHooksTemplate,
  runSetup,
} from "../skills/setup/scripts/setup.mjs";
import { createTempRoot } from "./test-temp.mjs";

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function installActivePlugin(codexHome) {
  mkdirSync(
    path.join(codexHome, "plugins", "cache", "mem9-ai", "mem9", "local"),
    { recursive: true },
  );
}

test("parseArgs supports the setup subcommands", () => {
  assert.deepEqual(
    parseArgs(["inspect"]),
    {
      command: "inspect",
      subcommand: "",
      cwd: "",
      profileId: "",
      label: "",
      baseUrl: "",
      apiKeyEnv: "",
      provisionApiKey: false,
      scope: "",
      defaultTimeoutMs: undefined,
      searchTimeoutMs: undefined,
      updateCheck: "",
      updateCheckIntervalHours: undefined,
    },
  );

  assert.deepEqual(
    parseArgs([
      "profile",
      "create",
      "--profile",
      "work",
      "--label",
      "Work",
      "--base-url",
      "https://api.mem9.ai/",
      "--provision-api-key",
    ]),
    {
      command: "profile",
      subcommand: "create",
      cwd: "",
      profileId: "work",
      label: "Work",
      baseUrl: "https://api.mem9.ai",
      apiKeyEnv: "",
      provisionApiKey: true,
      scope: "",
      defaultTimeoutMs: undefined,
      searchTimeoutMs: undefined,
      updateCheck: "",
      updateCheckIntervalHours: undefined,
    },
  );

  assert.deepEqual(
    parseArgs([
      "scope",
      "apply",
      "--scope",
      "project",
      "--profile",
      "work",
      "--default-timeout-ms",
      "8100",
      "--search-timeout-ms",
      "15100",
    ]),
    {
      command: "scope",
      subcommand: "apply",
      cwd: "",
      profileId: "work",
      label: "",
      baseUrl: "",
      apiKeyEnv: "",
      provisionApiKey: false,
      scope: "project",
      defaultTimeoutMs: 8100,
      searchTimeoutMs: 15100,
      updateCheck: "",
      updateCheckIntervalHours: undefined,
    },
  );

  assert.deepEqual(
    parseArgs([
      "scope",
      "apply",
      "--scope",
      "user",
      "--profile",
      "work",
      "--update-check",
      "disabled",
      "--update-check-interval-hours",
      "72",
    ]),
    {
      command: "scope",
      subcommand: "apply",
      cwd: "",
      profileId: "work",
      label: "",
      baseUrl: "",
      apiKeyEnv: "",
      provisionApiKey: false,
      scope: "user",
      defaultTimeoutMs: undefined,
      searchTimeoutMs: undefined,
      updateCheck: "disabled",
      updateCheckIntervalHours: 72,
    },
  );

  assert.throws(
    () =>
      parseArgs([
        "scope",
        "apply",
        "--scope",
        "project",
        "--profile",
        "work",
        "--update-check",
        "disabled",
      ]),
    /--scope user/,
  );
});

test("assertNodeVersion rejects runtimes below Node 22", () => {
  assert.equal(assertNodeVersion("22.1.0"), 22);
  assert.throws(
    () => assertNodeVersion("20.12.0"),
    /Node\.js 22\+/,
  );
});

test("applyCodexHooksPatch enables codex hooks without removing existing feature keys", () => {
  const patched = applyCodexHooksPatch([
    "[features]",
    "foo = true",
    "codex_hooks = false",
    "",
    "[model]",
    "name = \"gpt-5\"",
    "",
  ].join("\n"));

  assert.match(patched, /\[features\]/);
  assert.match(patched, /foo = true/);
  assert.match(patched, /foo = true\ncodex_hooks = true/);
  assert.match(patched, /\[model\]/);
});

test("applyCodexHooksPatch inserts codex_hooks directly under features when missing", () => {
  const patched = applyCodexHooksPatch([
    "[features]",
    "multi_agent = true",
    "",
    "# [mcp_servers]",
    "# enabled = true",
    "",
    "[model_providers.example]",
    "name = \"Example\"",
    "",
  ].join("\n"));

  assert.match(
    patched,
    /\[features\]\ncodex_hooks = true\nmulti_agent = true\n\n# \[mcp_servers\]/,
  );
});

test("applyCodexHooksPatch handles commented features and next section headers", () => {
  const patched = applyCodexHooksPatch([
    "[features] # local overrides",
    "multi_agent = true",
    "",
    "[model_providers.example] # keep this section boundary",
    "name = \"Example\"",
    "",
  ].join("\n"));

  assert.match(
    patched,
    /\[features\] # local overrides\ncodex_hooks = true\nmulti_agent = true\n\n\[model_providers\.example\] # keep this section boundary/,
  );
  assert.doesNotMatch(
    patched,
    /\n\[features\]\ncodex_hooks = true\n\[model_providers\.example\]/,
  );
});

test("removeManagedHooks removes only mem9 hooks from mixed groups", () => {
  const cleaned = removeManagedHooks({
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: buildNodeCommand("/tmp/example/mem9/runtime/session-start.mjs"),
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

  assert.equal(cleaned.hooks.SessionStart.length, 1);
  assert.equal(cleaned.hooks.SessionStart[0].hooks.length, 1);
  assert.equal(
    cleaned.hooks.SessionStart[0].hooks[0].statusMessage,
    "foreign-session-start",
  );
});

test("mergeMem9Hooks replaces old mem9-managed groups and keeps foreign hooks", () => {
  const merged = mergeMem9Hooks(
    {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: buildNodeCommand("/tmp/example/mem9/runtime/session-start.mjs"),
                statusMessage: "[mem9] session start",
              },
              {
                type: "command",
                command: "echo mixed-foreign",
                statusMessage: "foreign-session-start",
              },
            ],
          },
          {
            hooks: [
              {
                type: "command",
                command: "echo existing-session-start",
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "echo existing-stop",
              },
            ],
          },
        ],
      },
    },
    renderHooksTemplate({
      templateText: readFileSync("./templates/hooks.json", "utf8"),
      hooksDir: "/scope/mem9/hooks",
    }),
  );

  assert.equal(
    merged.hooks.SessionStart[0].hooks[0].command,
    buildNodeCommand("/scope/mem9/hooks/session-start.mjs"),
  );
  assert.equal(
    merged.hooks.SessionStart[1].hooks[0].command,
    "echo mixed-foreign",
  );
  assert.equal(
    merged.hooks.SessionStart[2].hooks[0].command,
    "echo existing-session-start",
  );
  assert.equal(
    merged.hooks.Stop[1].hooks[0].command,
    "echo existing-stop",
  );
});

test("buildHookCommands points hooks at the installed hook shim directory", () => {
  const commands = buildHookCommands("/scope/mem9/hooks");

  assert.deepEqual(commands, {
    sessionStartCommand: buildNodeCommand("/scope/mem9/hooks/session-start.mjs"),
    userPromptSubmitCommand: buildNodeCommand("/scope/mem9/hooks/user-prompt-submit.mjs"),
    stopCommand: buildNodeCommand("/scope/mem9/hooks/stop.mjs"),
  });
});

test("buildInstallMetadata derives marketplace and plugin identity from the installed cache path", () => {
  const installMetadata = buildInstallMetadata(
    "/scope/codex-home",
    "/scope/codex-home/plugins/cache/acme-labs/mem9-pro/local",
  );

  assert.deepEqual(installMetadata, {
    schemaVersion: 1,
    marketplaceName: "acme-labs",
    pluginName: "mem9-pro",
    shimVersion: 1,
  });
});

test("inspect reports runtime, plugin, configs, and saved profiles without exposing API keys", () => {
  const tempRoot = createTempRoot("setup");

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    mkdirSync(path.join(codexHome, "mem9", "hooks", "shared"), { recursive: true });
    mkdirSync(mem9Home, { recursive: true });
    installActivePlugin(codexHome);

    writeFileSync(
      path.join(codexHome, "config.toml"),
      "[features]\ncodex_hooks = true\n",
    );
    writeJson(path.join(codexHome, "mem9", "install.json"), {
      schemaVersion: 1,
      marketplaceName: "mem9-ai",
      pluginName: "mem9",
      shimVersion: 1,
    });
    writeJson(path.join(codexHome, "hooks.json"), renderHooksTemplate({
      templateText: readFileSync("./templates/hooks.json", "utf8"),
      hooksDir: path.join(codexHome, "mem9", "hooks"),
    }));
    writeJson(path.join(codexHome, "mem9", "config.json"), {
      schemaVersion: 1,
      enabled: false,
      profileId: "default",
      defaultTimeoutMs: 8300,
      searchTimeoutMs: 15300,
      updateCheck: {
        enabled: false,
        intervalHours: 72,
      },
    });
    writeJson(path.join(projectRoot, ".codex", "mem9", "config.json"), {
      schemaVersion: 1,
      enabled: false,
      profileId: "work",
      defaultTimeoutMs: 9100,
      searchTimeoutMs: 15500,
      updateCheck: {
        enabled: true,
        intervalHours: 6,
      },
    });
    writeJson(path.join(mem9Home, ".credentials.json"), {
      schemaVersion: 1,
      profiles: {
        default: {
          label: "Default",
          baseUrl: "https://api.mem9.ai",
          apiKey: "key-default",
        },
        solo: {
          label: "",
          baseUrl: "https://api.mem9.ai",
          apiKey: "",
        },
        work: {
          label: "Work",
          baseUrl: "https://api.mem9.ai",
          apiKey: "",
        },
      },
    });

    const summary = inspectSetup(["inspect"], {
      cwd: projectRoot,
      codexHome,
      mem9Home,
      hookShimSourceDir: "./bootstrap-hooks",
    });

    assert.equal(summary.status, "ok");
    assert.equal(summary.command, "inspect");
    assert.equal(summary.environment.nodeVersionSupported, true);
    assert.equal(summary.runtime.pluginState, "enabled");
    assert.deepEqual(summary.runtime.legacyPausedSources, ["global", "project"]);
    assert.equal(summary.runtime.effectiveLegacyPausedSource, "project");
    assert.equal(summary.plugin.hooksFeatureEnabled, true);
    assert.equal(summary.plugin.hooksInstalled, true);
    assert.equal(summary.plugin.installMetadataPresent, true);
    assert.equal(summary.globalConfig.summary.profileId, "default");
    assert.equal(summary.globalConfig.summary.legacyEnabledFalse, true);
    assert.deepEqual(summary.globalConfig.summary.updateCheck, {
      enabled: false,
      intervalHours: 72,
    });
    assert.equal(summary.projectConfig.summary.profileId, "work");
    assert.equal(summary.projectConfig.summary.legacyEnabledFalse, true);
    assert.equal(summary.projectConfig.summary.updateCheck, undefined);
    assert.deepEqual(summary.profiles.usableProfileIds, ["default"]);
    const profilesById = Object.fromEntries(
      summary.profiles.items.map((profile) => [profile.profileId, profile]),
    );
    assert.equal(profilesById.default.displayName, "Default (default)");
    assert.equal(
      profilesById.default.displaySummary,
      "Default (default · key-...ault) · https://api.mem9.ai",
    );
    assert.equal(profilesById.default.apiKeyPreview, "key-...ault");
    assert.equal(profilesById.solo.hasApiKey, false);
    assert.equal(profilesById.solo.displayName, "solo");
    assert.equal(
      profilesById.solo.displaySummary,
      "solo (API key pending) · https://api.mem9.ai",
    );
    assert.equal(profilesById.solo.apiKeyPreview, "");
    assert.equal(profilesById.work.hasApiKey, false);
    assert.equal(profilesById.work.displayName, "Work (work)");
    assert.equal(
      profilesById.work.displaySummary,
      "Work (work · API key pending) · https://api.mem9.ai",
    );
    assert.equal(profilesById.work.apiKeyPreview, "");
    assert.equal(JSON.stringify(summary).includes("key-default"), false);
    assert.equal(JSON.stringify(summary).includes(tempRoot), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("main prints inspect json without mutating files", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    let stdoutText = "";
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    writeJson(path.join(mem9Home, ".credentials.json"), {
      schemaVersion: 1,
      profiles: {
        work: {
          label: "Work",
          baseUrl: "https://api.mem9.ai",
          apiKey: "key-work",
        },
      },
    });

    const result = await main(
      ["inspect"],
      {
        cwd: projectRoot,
        codexHome,
        mem9Home,
        stdout: {
          write(chunk) {
            stdoutText += chunk;
          },
        },
      },
    );

    assert.equal(result.command, "inspect");
    assert.deepEqual(JSON.parse(stdoutText), result);
    assert.equal(stdoutText.includes("key-work"), false);
    assert.equal(existsSync(path.join(codexHome, "mem9", "config.json")), false);
    assert.equal(existsSync(path.join(codexHome, "hooks.json")), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("profile create provisions an API key without printing it", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    let stdoutText = "";
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    /** @type {Array<{url: string, method: string}>} */
    const fetchCalls = [];

    const result = await runSetup(
      [
        "profile",
        "create",
        "--profile",
        "personal",
        "--label",
        "Personal",
        "--base-url",
        "https://api.mem9.ai",
        "--provision-api-key",
      ],
      {
        cwd: projectRoot,
        codexHome,
        mem9Home,
        credentialsWritable: true,
        fetch: async (url, init) => {
          fetchCalls.push({
            url: String(url),
            method: String(init?.method ?? "GET"),
          });

          return {
            ok: true,
            status: 200,
            async json() {
              return {
                id: "key-provisioned",
              };
            },
          };
        },
        stdout: {
          write(chunk) {
            stdoutText += chunk;
          },
        },
      },
    );

    assert.equal(result.command, "profile.create");
    assert.equal(result.action, "created");
    assert.deepEqual(fetchCalls, [
      {
        url: "https://api.mem9.ai/v1alpha1/mem9s",
        method: "POST",
      },
    ]);
    assert.equal(
      readJson(path.join(mem9Home, ".credentials.json")).profiles.personal.apiKey,
      "key-provisioned",
    );
    assert.equal(stdoutText.includes("key-provisioned"), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("profile save-key uses MEM9_API_KEY and keeps the key out of stdout", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    let stdoutText = "";
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    const result = await runSetup(
      [
        "profile",
        "save-key",
        "--profile",
        "work",
        "--label",
        "Work",
        "--base-url",
        "https://api.mem9.ai",
        "--api-key-env",
        "MEM9_API_KEY",
      ],
      {
        cwd: projectRoot,
        codexHome,
        mem9Home,
        credentialsWritable: true,
        env: {
          MEM9_API_KEY: "key-from-env",
        },
        stdout: {
          write(chunk) {
            stdoutText += chunk;
          },
        },
      },
    );

    assert.equal(result.command, "profile.save-key");
    assert.equal(result.apiKeyEnv, "MEM9_API_KEY");
    assert.equal(
      readJson(path.join(mem9Home, ".credentials.json")).profiles.work.apiKey,
      "key-from-env",
    );
    assert.equal(stdoutText.includes("key-from-env"), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("profile save-key errors with guidance when the env var is missing", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    await assert.rejects(
      () => runSetup(
        [
          "profile",
          "save-key",
          "--profile",
          "work",
          "--label",
          "Work",
          "--base-url",
          "https://api.mem9.ai",
          "--api-key-env",
          "MEM9_API_KEY",
        ],
        {
          cwd: projectRoot,
          codexHome,
          mem9Home,
          credentialsWritable: true,
          env: {},
        },
      ),
      /MEM9_API_KEY/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("scope apply user installs global config, hooks, metadata, and repairs legacy project hooks", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    let stdoutText = "";
    mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    writeFileSync(
      path.join(codexHome, "config.toml"),
      "[features]\nother = true\n",
    );
    writeJson(path.join(codexHome, "hooks.json"), {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: buildNodeCommand(path.join(codexHome, "mem9", "runtime", "session-start.mjs")),
                statusMessage: "[mem9] session start",
              },
              {
                type: "command",
                command: "echo existing-session-start",
              },
            ],
          },
        ],
      },
    });
    writeJson(path.join(projectRoot, ".codex", "hooks.json"), {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: buildNodeCommand(path.join(projectRoot, ".codex", "mem9", "runtime", "session-start.mjs")),
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
    writeJson(path.join(mem9Home, ".credentials.json"), {
      schemaVersion: 1,
      profiles: {
        work: {
          label: "Work",
          baseUrl: "https://api.mem9.ai",
          apiKey: "key-1",
        },
      },
    });

    const result = await runSetup(
      [
        "scope",
        "apply",
        "--scope",
        "user",
        "--profile",
        "work",
        "--update-check",
        "disabled",
        "--update-check-interval-hours",
        "72",
      ],
      {
        cwd: projectRoot,
        codexHome,
        mem9Home,
        userWritable: true,
        stdout: {
          write(chunk) {
            stdoutText += chunk;
          },
        },
      },
    );

    assert.equal(result.command, "scope.apply");
    assert.equal(result.scope, "user");
    assert.equal(result.profileId, "work");
    assert.deepEqual(result.configSummary.updateCheck, {
      enabled: false,
      intervalHours: 72,
    });
    assert.equal(
      existsSync(path.join(codexHome, "mem9", "hooks", "session-start.mjs")),
      true,
    );
    assert.equal(
      existsSync(path.join(codexHome, "mem9", "hooks", "shared", "bootstrap.mjs")),
      true,
    );
    assert.deepEqual(
      readJson(path.join(codexHome, "mem9", "install.json")),
      {
        schemaVersion: 1,
        marketplaceName: "mem9-ai",
        pluginName: "mem9",
        shimVersion: 1,
      },
    );

    const globalConfig = readJson(path.join(codexHome, "mem9", "config.json"));
    assert.equal(globalConfig.profileId, "work");
    assert.equal(globalConfig.defaultTimeoutMs, 8000);
    assert.equal(globalConfig.searchTimeoutMs, 15000);
    assert.deepEqual(globalConfig.updateCheck, {
      enabled: false,
      intervalHours: 72,
    });

    const patchedToml = readFileSync(path.join(codexHome, "config.toml"), "utf8");
    assert.match(patchedToml, /other = true/);
    assert.match(patchedToml, /codex_hooks = true/);

    const hooks = readJson(path.join(codexHome, "hooks.json"));
    assert.equal(
      hooks.hooks.SessionStart[0].hooks[0].command,
      buildNodeCommand(path.join(codexHome, "mem9", "hooks", "session-start.mjs")),
    );
    assert.equal(
      hooks.hooks.SessionStart[1].hooks[0].command,
      "echo existing-session-start",
    );

    const legacyHooks = readJson(path.join(projectRoot, ".codex", "hooks.json"));
    assert.equal(legacyHooks.hooks.SessionStart.length, 1);
    assert.equal(legacyHooks.hooks.SessionStart[0].hooks.length, 1);
    assert.equal(
      legacyHooks.hooks.SessionStart[0].hooks[0].statusMessage,
      "foreign-session-start",
    );

    const stdoutSummary = JSON.parse(stdoutText);
    assert.equal(stdoutSummary.scope, "user");
    assert.deepEqual(stdoutSummary.configSummary.updateCheck, {
      enabled: false,
      intervalHours: 72,
    });
    assert.equal(stdoutText.includes("key-1"), false);
    assert.equal(JSON.stringify(stdoutSummary).includes("key-1"), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("scope apply project writes a local override and clears legacy enabled false", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "repo");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    mkdirSync(path.join(projectRoot, "packages", "web"), { recursive: true });
    mkdirSync(path.join(codexHome, "mem9"), { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    writeJson(path.join(codexHome, "mem9", "config.json"), {
      schemaVersion: 1,
      profileId: "default",
      defaultTimeoutMs: 8200,
      searchTimeoutMs: 15200,
    });
    writeJson(path.join(mem9Home, ".credentials.json"), {
      schemaVersion: 1,
      profiles: {
        default: {
          label: "Default",
          baseUrl: "https://api.mem9.ai",
          apiKey: "key-default",
        },
        work: {
          label: "Work",
          baseUrl: "https://api.mem9.ai",
          apiKey: "key-work",
        },
      },
    });
    writeJson(path.join(projectRoot, ".codex", "mem9", "config.json"), {
      schemaVersion: 1,
      enabled: false,
      profileId: "default",
      defaultTimeoutMs: 9100,
    });

    await runSetup(
      [
        "scope",
        "apply",
        "--scope",
        "project",
        "--profile",
        "work",
      ],
      {
        cwd: path.join(projectRoot, "packages", "web"),
        codexHome,
        mem9Home,
        userWritable: true,
      },
    );

    const saved = readJson(path.join(projectRoot, ".codex", "mem9", "config.json"));
    assert.equal(saved.profileId, "work");
    assert.equal(saved.defaultTimeoutMs, 9100);
    assert.equal(saved.searchTimeoutMs, 15200);
    assert.equal("enabled" in saved, false);
    assert.equal("updateCheck" in saved, false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("scope clear removes the project override", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "repo");
    const codexHome = path.join(tempRoot, "codex-home");
    mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    mkdirSync(path.join(codexHome, "mem9"), { recursive: true });
    writeJson(path.join(projectRoot, ".codex", "mem9", "config.json"), {
      schemaVersion: 1,
      profileId: "work",
    });

    const result = await runSetup(
      [
        "scope",
        "clear",
        "--scope",
        "project",
      ],
      {
        cwd: projectRoot,
        codexHome,
        userWritable: true,
      },
    );

    assert.equal(result.command, "scope.clear");
    assert.equal(result.action, "removed");
    assert.equal(
      existsSync(path.join(projectRoot, ".codex", "mem9", "config.json")),
      false,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("scope apply project fails before mutating global runtime files when the project path is not writable", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "repo");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(path.join(codexHome, "mem9"), { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    writeJson(path.join(mem9Home, ".credentials.json"), {
      schemaVersion: 1,
      profiles: {
        work: {
          label: "Work",
          baseUrl: "https://api.mem9.ai",
          apiKey: "key-work",
        },
      },
    });

    await assert.rejects(
      () =>
        runSetup(
          [
            "scope",
            "apply",
            "--scope",
            "project",
            "--profile",
            "work",
          ],
          {
            cwd: projectRoot,
            codexHome,
            mem9Home,
            userWritable: true,
            projectWritable: false,
          },
        ),
      /not writable/,
    );

    assert.equal(existsSync(path.join(codexHome, "config.toml")), false);
    assert.equal(existsSync(path.join(codexHome, "hooks.json")), false);
    assert.equal(existsSync(path.join(codexHome, "mem9", "install.json")), false);
    assert.equal(existsSync(path.join(codexHome, "mem9", "hooks")), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("scope clear project fails before mutating global runtime files when the project path is not writable", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "repo");
    const codexHome = path.join(tempRoot, "codex-home");
    mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    mkdirSync(path.join(codexHome, "mem9"), { recursive: true });
    writeJson(path.join(projectRoot, ".codex", "mem9", "config.json"), {
      schemaVersion: 1,
      profileId: "work",
    });

    await assert.rejects(
      () =>
        runSetup(
          [
            "scope",
            "clear",
            "--scope",
            "project",
          ],
          {
            cwd: projectRoot,
            codexHome,
            userWritable: true,
            projectWritable: false,
          },
        ),
      /not writable/,
    );

    assert.equal(existsSync(path.join(codexHome, "config.toml")), false);
    assert.equal(existsSync(path.join(codexHome, "hooks.json")), false);
    assert.equal(existsSync(path.join(codexHome, "mem9", "install.json")), false);
    assert.equal(existsSync(path.join(projectRoot, ".codex", "mem9", "config.json")), true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("scope apply repairs malformed json files and rewrites them with valid config", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    let stdoutText = "";
    mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(path.join(codexHome, "mem9"), { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    writeFileSync(path.join(codexHome, "config.toml"), "[features]\n");
    writeFileSync(path.join(codexHome, "hooks.json"), "{broken");
    writeFileSync(path.join(codexHome, "mem9", "config.json"), "{broken");
    writeFileSync(path.join(codexHome, "mem9", "install.json"), "{broken");
    writeJson(path.join(mem9Home, ".credentials.json"), {
      schemaVersion: 1,
      profiles: {
        work: {
          label: "Work",
          baseUrl: "https://api.mem9.ai",
          apiKey: "key-fixed",
        },
      },
    });

    const result = await runSetup(
      [
        "scope",
        "apply",
        "--scope",
        "user",
        "--profile",
        "work",
      ],
      {
        cwd: projectRoot,
        codexHome,
        mem9Home,
        userWritable: true,
        stdout: {
          write(chunk) {
            stdoutText += chunk;
          },
        },
      },
    );

    assert.equal(result.scope, "user");
    assert.equal(result.backups.length, 3);

    const repairedConfig = readJson(path.join(codexHome, "mem9", "config.json"));
    const repairedHooks = readJson(path.join(codexHome, "hooks.json"));
    const repairedInstall = readJson(path.join(codexHome, "mem9", "install.json"));

    assert.equal(repairedConfig.profileId, "work");
    assert.deepEqual(repairedConfig.updateCheck, {
      enabled: true,
      intervalHours: 24,
    });
    assert.equal(repairedHooks.hooks.Stop[0].hooks[0].statusMessage, "[mem9] save");
    assert.equal(repairedInstall.pluginName, "mem9");

    for (const backup of result.backups) {
      assert.equal(existsSync(backup.backupPath), true);
      assert.equal(readFileSync(backup.backupPath, "utf8"), "{broken");
    }

    const stdoutSummary = JSON.parse(stdoutText);
    assert.equal(stdoutSummary.backups.length, 3);
    assert.deepEqual(stdoutSummary.configSummary.updateCheck, {
      enabled: true,
      intervalHours: 24,
    });
    assert.equal(stdoutText.includes("key-fixed"), false);
    assert.equal(stdoutText.includes(tempRoot), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
