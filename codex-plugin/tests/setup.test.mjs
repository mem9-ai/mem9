import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
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
  inspectProfiles,
  main,
  mergeMem9Hooks,
  removeManagedHooks,
  renderHooksTemplate,
  runSetup,
} from "../skills/setup/scripts/setup.mjs";

function createTempRoot() {
  const parent = path.join(process.cwd(), ".tmp-setup-tests");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, "case-"));
}

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
  assert.match(patched, /codex_hooks = true/);
  assert.match(patched, /\[model\]/);
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

test("buildNodeCommand shell-quotes POSIX metacharacters", () => {
  assert.equal(
    buildNodeCommand("/tmp/mem9/$HOME/`hook`/'quote'.mjs", "linux"),
    "node '/tmp/mem9/$HOME/`hook`/'\"'\"'quote'\"'\"'.mjs'",
  );
});

test("inspectProfiles summarizes saved global profiles without exposing api keys", () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    writeFileSync(
      path.join(mem9Home, ".credentials.json"),
      JSON.stringify({
        schemaVersion: 1,
        profiles: {
          default: {
            label: "Default",
            baseUrl: "https://api.mem9.ai",
            apiKey: "key-default",
          },
          draft: {
            label: "Draft",
            baseUrl: "https://staging.mem9.ai",
            apiKey: "",
          },
        },
      }, null, 2),
    );

    const summary = inspectProfiles([], {
      cwd: projectRoot,
      codexHome,
      mem9Home,
    });

    assert.equal(summary.status, "ok");
    assert.equal(summary.credentialsState, "ready");
    assert.equal(summary.credentialsPath, "$MEM9_HOME/.credentials.json");
    assert.equal(summary.defaultProfileId, "default");
    assert.equal(summary.hasUsableProfiles, true);
    assert.equal(summary.recommendedMode, "use-existing");
    assert.deepEqual(summary.usableProfileIds, ["default"]);
    assert.deepEqual(summary.profiles, [
      {
        profileId: "default",
        label: "Default",
        baseUrl: "https://api.mem9.ai",
        hasApiKey: true,
      },
      {
        profileId: "draft",
        label: "Draft",
        baseUrl: "https://staging.mem9.ai",
        hasApiKey: false,
      },
    ]);
    assert.equal(JSON.stringify(summary).includes("key-default"), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("main prints inspectProfiles json to a provided stdout without mutating setup files", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    let stdoutText = "";
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    writeFileSync(
      path.join(mem9Home, ".credentials.json"),
      JSON.stringify({
        schemaVersion: 1,
        profiles: {
          work: {
            label: "Work",
            baseUrl: "https://api.mem9.ai",
            apiKey: "key-work",
          },
        },
      }, null, 2),
    );

    const result = await main(
      ["--inspect-profiles"],
      {
        cwd: projectRoot,
        codexHome,
        mem9Home,
        stdout: {
          write(/** @type {string} */ chunk) {
            stdoutText += chunk;
          },
        },
      },
    );

    assert.equal("recommendedMode" in result, true);
    assert.equal("usableProfileIds" in result, true);
    if (!("recommendedMode" in result) || !("usableProfileIds" in result)) {
      throw new Error("Expected inspectProfiles result.");
    }

    assert.equal(result.status, "ok");
    assert.equal(result.recommendedMode, "use-existing");
    assert.deepEqual(result.usableProfileIds, ["work"]);
    assert.equal(stdoutText.trim().length > 0, true);
    assert.deepEqual(JSON.parse(stdoutText), result);
    assert.equal(stdoutText.includes("key-work"), false);
    assert.equal(existsSync(path.join(codexHome, "mem9", "config.json")), false);
    assert.equal(existsSync(path.join(codexHome, "hooks.json")), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("main prints inspectProfiles json to process.stdout by default", async () => {
  const tempRoot = createTempRoot();
  const originalWrite = process.stdout.write;

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    let stdoutText = "";
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    writeFileSync(
      path.join(mem9Home, ".credentials.json"),
      JSON.stringify({
        schemaVersion: 1,
        profiles: {
          default: {
            label: "Default",
            baseUrl: "https://api.mem9.ai",
            apiKey: "key-default",
          },
        },
      }, null, 2),
    );

    process.stdout.write = /** @type {typeof process.stdout.write} */ ((chunk, ...args) => {
      stdoutText += typeof chunk === "string" ? chunk : chunk.toString();
      const callback = args.find((value) => typeof value === "function");
      callback?.();
      return true;
    });

    const result = await main(
      ["--inspect-profiles"],
      {
        cwd: projectRoot,
        codexHome,
        mem9Home,
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(stdoutText.trim().length > 0, true);
    assert.deepEqual(JSON.parse(stdoutText), result);
    assert.equal(stdoutText.includes("key-default"), false);
  } finally {
    process.stdout.write = originalWrite;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runSetup installs global config, hooks, credentials, and hook shims", async () => {
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
    writeFileSync(
      path.join(codexHome, "hooks.json"),
      JSON.stringify({
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
      }, null, 2),
    );
    writeFileSync(
      path.join(projectRoot, ".codex", "hooks.json"),
      JSON.stringify({
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
      }, null, 2),
    );
    writeFileSync(
      path.join(mem9Home, ".credentials.json"),
      JSON.stringify({
        schemaVersion: 1,
        profiles: {
          work: {
            label: "Work",
            baseUrl: "https://api.mem9.ai",
            apiKey: "key-1",
          },
        },
      }, null, 2),
    );

    const result = await runSetup(
      ["--profile", "work"],
      {
        cwd: projectRoot,
        codexHome,
        mem9Home,
        interactive: false,
        userWritable: true,
        credentialsWritable: true,
        stdout: {
          write(/** @type {string} */ chunk) {
            stdoutText += chunk;
          },
        },
      },
    );

    assert.equal(result.scope, "global");
    assert.equal(result.profileId, "work");
    assert.equal(
      existsSync(path.join(codexHome, "mem9", "hooks", "session-start.mjs")),
      true,
    );
    assert.equal(
      existsSync(path.join(codexHome, "mem9", "hooks", "shared", "bootstrap.mjs")),
      true,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(codexHome, "mem9", "install.json"), "utf8")),
      {
        schemaVersion: 1,
        marketplaceName: "mem9-ai",
        pluginName: "mem9",
        shimVersion: 1,
      },
    );

    const globalConfig = JSON.parse(
      readFileSync(path.join(codexHome, "mem9", "config.json"), "utf8"),
    );
    assert.equal(globalConfig.profileId, "work");
    assert.equal(globalConfig.defaultTimeoutMs, 8000);
    assert.equal(globalConfig.searchTimeoutMs, 15000);

    const patchedToml = readFileSync(path.join(codexHome, "config.toml"), "utf8");
    assert.match(patchedToml, /other = true/);
    assert.match(patchedToml, /codex_hooks = true/);

    const hooks = JSON.parse(
      readFileSync(path.join(codexHome, "hooks.json"), "utf8"),
    );
    assert.equal(
      hooks.hooks.SessionStart[0].hooks[0].command,
      buildNodeCommand(path.join(codexHome, "mem9", "hooks", "session-start.mjs")),
    );
    assert.equal(
      hooks.hooks.SessionStart[1].hooks[0].command,
      "echo existing-session-start",
    );

    const legacyHooks = JSON.parse(
      readFileSync(path.join(projectRoot, ".codex", "hooks.json"), "utf8"),
    );
    assert.equal(legacyHooks.hooks.SessionStart.length, 1);
    assert.equal(legacyHooks.hooks.SessionStart[0].hooks.length, 1);
    assert.equal(
      legacyHooks.hooks.SessionStart[0].hooks[0].statusMessage,
      "foreign-session-start",
    );

    const credentials = JSON.parse(
      readFileSync(path.join(mem9Home, ".credentials.json"), "utf8"),
    );
    assert.equal(credentials.profiles.work.apiKey, "key-1");

    const stdoutSummary = JSON.parse(stdoutText);
    assert.equal(stdoutSummary.scope, "global");
    assert.equal(stdoutText.includes("key-1"), false);
    assert.equal(JSON.stringify(stdoutSummary).includes("key-1"), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runSetup can create a global profile from CLI args", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(codexHome, { recursive: true });

    const result = await runSetup(
      [
        "--profile",
        "personal",
        "--label",
        "Personal",
        "--base-url",
        "https://api.mem9.ai",
        "--api-key",
        "key-2",
        "--default-timeout-ms",
        "8100",
        "--search-timeout-ms",
        "15100",
      ],
      {
        cwd: projectRoot,
        codexHome,
        mem9Home,
        interactive: false,
        userWritable: true,
        credentialsWritable: true,
      },
    );

    assert.equal(result.scope, "global");

    const globalConfig = JSON.parse(
      readFileSync(path.join(codexHome, "mem9", "config.json"), "utf8"),
    );
    assert.equal(globalConfig.profileId, "personal");
    assert.equal(globalConfig.defaultTimeoutMs, 8100);
    assert.equal(globalConfig.searchTimeoutMs, 15100);

    const credentials = JSON.parse(
      readFileSync(path.join(mem9Home, ".credentials.json"), "utf8"),
    );
    assert.equal(credentials.profiles.personal.label, "Personal");
    assert.equal(credentials.profiles.personal.apiKey, "key-2");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runSetup provisions a global profile when api key is omitted", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    /** @type {Array<{url: string, method: string}>} */
    const fetchCalls = [];

    const result = await runSetup(
      [
        "--profile",
        "default",
        "--label",
        "default",
        "--base-url",
        "https://api.mem9.ai",
      ],
      {
        cwd: projectRoot,
        codexHome,
        mem9Home,
        interactive: false,
        userWritable: true,
        credentialsWritable: true,
        fetch: async (
          /** @type {string | URL} */ url,
          /** @type {{method?: string} | undefined} */ init,
        ) => {
          const request = init ?? {};
          fetchCalls.push({
            url: String(url),
            method: String(request.method ?? "GET"),
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
      },
    );

    assert.equal(result.selection, "provisioned");
    assert.deepEqual(fetchCalls, [
      {
        url: "https://api.mem9.ai/v1alpha1/mem9s",
        method: "POST",
      },
    ]);

    const credentials = JSON.parse(
      readFileSync(path.join(mem9Home, ".credentials.json"), "utf8"),
    );
    assert.equal(credentials.profiles.default.apiKey, "key-provisioned");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runSetup provisions an existing profile missing api key in non-interactive mode", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "project");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    writeFileSync(
      path.join(mem9Home, ".credentials.json"),
      JSON.stringify({
        schemaVersion: 1,
        profiles: {
          work: {
            label: "Work",
            baseUrl: "https://api.mem9.ai",
            apiKey: "",
          },
        },
      }, null, 2),
    );

    const result = await runSetup(
      ["--profile", "work"],
      {
        cwd: projectRoot,
        codexHome,
        mem9Home,
        interactive: false,
        userWritable: true,
        credentialsWritable: true,
        fetch: async () => ({
          ok: true,
          status: 200,
          async json() {
            return {
              id: "key-repaired",
            };
          },
        }),
      },
    );

    assert.equal(result.selection, "provisioned");

    const credentials = JSON.parse(
      readFileSync(path.join(mem9Home, ".credentials.json"), "utf8"),
    );
    assert.equal(credentials.profiles.work.apiKey, "key-repaired");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runSetup manual mode prints guidance instead of reading an api key", async () => {
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
        [],
        {
          cwd: projectRoot,
          codexHome,
          mem9Home,
          interactive: true,
          userWritable: true,
          credentialsWritable: true,
          prompter: {
            async text() {
              return "manual";
            },
            close() {},
          },
        },
      ),
      /Add a mem9 profile manually in `\$MEM9_HOME\/\.credentials\.json`\./,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runSetup repairs malformed global json files and rewrites them with valid config", async () => {
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
    writeFileSync(path.join(mem9Home, ".credentials.json"), "{broken");

    const result = await runSetup(
      [
        "--profile",
        "work",
        "--label",
        "Work",
        "--base-url",
        "https://api.mem9.ai",
        "--api-key",
        "key-fixed",
      ],
      {
        cwd: projectRoot,
        codexHome,
        mem9Home,
        interactive: false,
        userWritable: true,
        credentialsWritable: true,
        stdout: {
          write(/** @type {string} */ chunk) {
            stdoutText += chunk;
          },
        },
      },
    );

    assert.equal(result.scope, "global");
    assert.equal(result.backups.length, 3);

    const repairedConfig = JSON.parse(
      readFileSync(path.join(codexHome, "mem9", "config.json"), "utf8"),
    );
    const repairedHooks = JSON.parse(
      readFileSync(path.join(codexHome, "hooks.json"), "utf8"),
    );
    const repairedCredentials = JSON.parse(
      readFileSync(path.join(mem9Home, ".credentials.json"), "utf8"),
    );

    assert.equal(repairedConfig.profileId, "work");
    assert.equal(repairedHooks.hooks.Stop[0].hooks[0].statusMessage, "[mem9] save");
    assert.equal(repairedCredentials.profiles.work.apiKey, "key-fixed");

    for (const backup of result.backups) {
      assert.equal(existsSync(backup.backupPath), true);
      assert.equal(readFileSync(backup.backupPath, "utf8"), "{broken");
    }

    const stdoutSummary = JSON.parse(stdoutText);
    assert.equal(stdoutSummary.backups.length, 3);
    assert.equal(stdoutText.includes("key-fixed"), false);
    const summaryBackups = /** @type {Array<{ backupPath: string }>} */ (
      stdoutSummary.backups
    );
    assert.equal(
      summaryBackups.some((backup) =>
        String(backup.backupPath).startsWith("$MEM9_HOME/")),
      true,
    );
    assert.equal(
      summaryBackups.some((backup) =>
        String(backup.backupPath).startsWith("$CODEX_HOME/")),
      true,
    );
    assert.equal(stdoutText.includes(tempRoot), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
