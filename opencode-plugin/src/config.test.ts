import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { mergeConfigLayers, resolveRuntimeIdentity } from "./config.js";
import mem9PluginModule from "./index.js";
import {
  resolveMem9Home,
  resolveMem9Paths,
  resolveOpenCodeBasePaths,
} from "./platform-paths.js";

function createPluginInput(): PluginInput {
  return {
    client: {} as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: path.join(path.sep, "work", "repo"),
    worktree: path.join(path.sep, "work", "repo"),
    experimental_workspace: {
      register(): void {},
    },
    serverUrl: new URL("https://example.com"),
    $: {} as PluginInput["$"],
  };
}

async function withEnv(
  patch: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const original = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    original.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function captureWarnings(run: () => Promise<void>): Promise<string[]> {
  const warnings: string[] = [];
  const originalWarn = console.warn;

  console.warn = (message?: unknown, ...args: unknown[]): void => {
    warnings.push([message, ...args].map(String).join(" "));
  };

  try {
    await run();
    return warnings;
  } finally {
    console.warn = originalWarn;
  }
}

async function captureInfo(run: () => Promise<void>): Promise<string[]> {
  const info: string[] = [];
  const originalInfo = console.info;

  console.info = (message?: unknown, ...args: unknown[]): void => {
    info.push([message, ...args].map(String).join(" "));
  };

  try {
    await run();
    return info;
  } finally {
    console.info = originalInfo;
  }
}

async function writeJSON(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

test("resolveMem9Home prefers MEM9_HOME and otherwise falls back to home .mem9", () => {
  assert.equal(
    resolveMem9Home({ MEM9_HOME: path.join(path.sep, "shared", "mem9") }),
    path.join(path.sep, "shared", "mem9"),
  );
  assert.equal(
    resolveMem9Home({}, path.join(path.sep, "home", "demo")),
    path.join(path.sep, "home", "demo", ".mem9"),
  );
});

test("resolveMem9Paths uses shared mem9 home for credentials and opencode data dir for logs", () => {
  const configDir = path.join(path.sep, "home", "demo", ".config", "opencode");
  const dataDir = path.join(path.sep, "home", "demo", ".local", "share", "opencode");
  const projectDir = path.join(path.sep, "work", "repo");
  const mem9Home = path.join(path.sep, "home", "demo", ".mem9");
  const paths = resolveMem9Paths({
    configDir,
    dataDir,
    projectDir,
    mem9Home,
  });

  assert.equal(paths.globalConfigFile, path.join(configDir, "mem9.json"));
  assert.equal(paths.projectConfigFile, path.join(projectDir, ".opencode", "mem9.json"));
  assert.equal(paths.globalPluginConfigFile, path.join(configDir, "opencode.json"));
  assert.equal(paths.projectPluginConfigFile, path.join(projectDir, ".opencode", "opencode.json"));
  assert.equal(paths.credentialsFile, path.join(mem9Home, ".credentials.json"));
  assert.equal(paths.logDir, path.join(dataDir, "plugins", "mem9", "log"));
});

test("resolveOpenCodeBasePaths follows XDG directories on unix-like platforms", () => {
  const paths = resolveOpenCodeBasePaths(
    {
      XDG_CONFIG_HOME: path.join(path.sep, "config-root"),
      XDG_DATA_HOME: path.join(path.sep, "data-root"),
    },
    path.join(path.sep, "home", "demo"),
    "linux",
  );

  assert.deepEqual(paths, {
    configDir: path.join(path.sep, "config-root", "opencode"),
    dataDir: path.join(path.sep, "data-root", "opencode"),
  });
});

test("resolveOpenCodeBasePaths falls back to AppData on windows", () => {
  const paths = resolveOpenCodeBasePaths(
    {},
    path.join("C:", "Users", "demo"),
    "win32",
  );

  assert.deepEqual(paths, {
    configDir: path.join("C:", "Users", "demo", "AppData", "Roaming", "opencode"),
    dataDir: path.join("C:", "Users", "demo", "AppData", "Local", "opencode"),
  });
});

test("mergeConfigLayers applies defaults and project overrides", () => {
  const result = mergeConfigLayers(
    {
      schemaVersion: 1,
      profileId: "default",
      debug: true,
      searchTimeoutMs: 12000,
    },
    {
      schemaVersion: 1,
      profileId: "projectA",
      defaultTimeoutMs: 9000,
    },
  );

  assert.deepEqual(result, {
    schemaVersion: 1,
    profileId: "projectA",
    debug: true,
    defaultTimeoutMs: 9000,
    searchTimeoutMs: 12000,
  });
});

test("mergeConfigLayers uses built-in defaults when config layers are missing", () => {
  const result = mergeConfigLayers();

  assert.deepEqual(result, {
    schemaVersion: 1,
    debug: false,
    defaultTimeoutMs: 8000,
    searchTimeoutMs: 15000,
  });
});

test("resolveRuntimeIdentity prefers MEM9_API_KEY over legacy MEM9_TENANT_ID", () => {
  const identity = resolveRuntimeIdentity(
    {
      MEM9_API_KEY: "mk_new",
      MEM9_TENANT_ID: "legacy_space",
      MEM9_API_URL: "https://api.mem9.ai",
    },
    {
      schemaVersion: 1,
      profiles: {},
    },
    {
      schemaVersion: 1,
      profileId: "default",
    },
  );

  assert.equal(identity?.apiKey, "mk_new");
  assert.equal(identity?.source, "env");
});

test("resolveRuntimeIdentity falls back to the configured profile", () => {
  const identity = resolveRuntimeIdentity(
    {},
    {
      schemaVersion: 1,
      profiles: {
        default: {
          label: "Default",
          baseUrl: "https://api.mem9.ai",
          apiKey: "mk_profile",
        },
      },
    },
    {
      schemaVersion: 1,
      profileId: "default",
    },
  );

  assert.equal(identity?.apiKey, "mk_profile");
  assert.equal(identity?.baseUrl, "https://api.mem9.ai");
  assert.equal(identity?.source, "profile");
});

test("resolveRuntimeIdentity skips blank profile credentials", () => {
  const identity = resolveRuntimeIdentity(
    {},
    {
      schemaVersion: 1,
      profiles: {
        default: {
          label: "Default",
          baseUrl: "   ",
          apiKey: "   ",
        },
      },
    },
    {
      schemaVersion: 1,
      profileId: " default ",
    },
  );

  assert.equal(identity, null);
});

test("resolveRuntimeIdentity trims env overrides before use", () => {
  const identity = resolveRuntimeIdentity(
    {
      MEM9_API_KEY: "  mk_trimmed  ",
      MEM9_API_URL: "  https://api.mem9.ai  ",
    },
    {
      schemaVersion: 1,
      profiles: {},
    },
    {
      schemaVersion: 1,
    },
  );

  assert.deepEqual(identity, {
    apiKey: "mk_trimmed",
    baseUrl: "https://api.mem9.ai",
    source: "env",
  });
});

test("mem9 plugin starts from local path inference when env identity exists", async () => {
  await withEnv(
    {
      MEM9_API_KEY: "mk_env",
      MEM9_API_URL: "https://api.mem9.ai",
      MEM9_TENANT_ID: undefined,
    },
    async () => {
      const input = createPluginInput();

      const warnings = await captureWarnings(async () => {
        const info = await captureInfo(async () => {
          const hooks = await mem9PluginModule.server(input);
          assert.ok(hooks.tool);
          assert.ok(hooks.tool?.memory_search);
        });

        assert.equal(
          info.some((message) => message.includes("Server mode (mem9 REST API via env)")),
          true,
        );
      });

      assert.equal(warnings.length, 0);
    },
  );
});

test("mem9 plugin returns the pending setup skeleton when no identity is available", async () => {
  await withEnv(
    {
      MEM9_API_KEY: undefined,
      MEM9_API_URL: undefined,
      MEM9_TENANT_ID: undefined,
    },
    async () => {
      const input = createPluginInput();

      const warnings = await captureWarnings(async () => {
        const hooks = await mem9PluginModule.server(input);
        assert.deepEqual(hooks, {});
      });

      assert.equal(
        warnings.some((message) => message.includes("Setup pending")),
        true,
      );
    },
  );
});

test("mem9 plugin becomes usable from profile config and credentials files", async () => {
  const fixtureRoot = path.join(
    process.cwd(),
    "dist-test",
    `profile-startup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const configDir = path.join(fixtureRoot, "config");
  const dataDir = path.join(fixtureRoot, "state");
  const mem9Home = path.join(fixtureRoot, "mem9-home");
  const projectDir = path.join(fixtureRoot, "worktree");
  const resolvedPaths = resolveMem9Paths({
    configDir,
    dataDir,
    projectDir,
    mem9Home,
  });

  try {
    await writeJSON(resolvedPaths.projectConfigFile, {
      schemaVersion: 1,
      profileId: "default",
      debug: true,
    });
    await writeJSON(resolvedPaths.credentialsFile, {
      schemaVersion: 1,
      profiles: {
        default: {
          label: "Workspace Default",
          baseUrl: "https://api.mem9.ai",
          apiKey: "mk_profile_integration",
        },
      },
    });

    await withEnv(
      {
        MEM9_API_KEY: undefined,
        MEM9_API_URL: undefined,
        MEM9_HOME: mem9Home,
        XDG_CONFIG_HOME: configDir,
        XDG_DATA_HOME: dataDir,
        MEM9_TENANT_ID: undefined,
      },
      async () => {
        const input: PluginInput = {
          ...createPluginInput(),
          directory: projectDir,
          worktree: projectDir,
        };

        const warnings = await captureWarnings(async () => {
          const info = await captureInfo(async () => {
            const hooks = await mem9PluginModule.server(input);
            assert.ok(hooks.tool?.memory_search);
          });

          assert.equal(
            info.some((message) => message.includes("Server mode (mem9 REST API via profile)")),
            true,
          );
        });

        assert.equal(
          warnings.some((message) => message.includes("Setup pending")),
          false,
        );
      },
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
