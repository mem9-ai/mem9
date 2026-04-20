import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { mergeConfigLayers, resolveRuntimeIdentity } from "./config.js";
import mem9Plugin from "./index.js";
import { resolveMem9Paths } from "./platform-paths.js";

type PathGetter = (...args: Parameters<PluginInput["client"]["path"]["get"]>) => Promise<unknown>;

function createPluginInput(pathGet: PathGetter): PluginInput {
  return {
    client: {
      path: {
        get: pathGet as PluginInput["client"]["path"]["get"],
      },
    } as PluginInput["client"],
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

test("resolveMem9Paths uses config and data directories separately", () => {
  const configDir = path.join(path.sep, "home", "demo", ".config", "opencode");
  const dataDir = path.join(path.sep, "home", "demo", ".local", "share", "opencode");
  const projectDir = path.join(path.sep, "work", "repo");
  const paths = resolveMem9Paths({
    configDir,
    dataDir,
    projectDir,
  });

  assert.equal(paths.globalConfigFile, path.join(configDir, "mem9.json"));
  assert.equal(paths.projectConfigFile, path.join(projectDir, ".opencode", "mem9.json"));
  assert.equal(
    paths.credentialsFile,
    path.join(dataDir, "plugins", "mem9", ".credentials.json"),
  );
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

test("mem9 plugin stays usable when path.get throws and env identity exists", async () => {
  await withEnv(
    {
      MEM9_API_KEY: "mk_env",
      MEM9_API_URL: "https://api.mem9.ai",
      MEM9_TENANT_ID: undefined,
    },
    async () => {
      const input = createPluginInput(async () => {
        throw new Error("path lookup failed");
      });

      const warnings = await captureWarnings(async () => {
        const info = await captureInfo(async () => {
          const hooks = await mem9Plugin(input);
          assert.ok(hooks.tool);
          assert.ok(hooks.tool?.memory_search);
        });

        assert.equal(
          info.some((message) => message.includes("Server mode (mem9 REST API via env)")),
          true,
        );
      });

      assert.equal(
        warnings.some((message) => message.includes("Unable to resolve OpenCode paths")),
        true,
      );
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
      const input = createPluginInput(async () => ({
        state: path.join(path.sep, "missing", "state"),
        config: path.join(path.sep, "missing", "config"),
        worktree: path.join(path.sep, "work", "repo"),
        directory: path.join(path.sep, "work", "repo"),
      }));

      const warnings = await captureWarnings(async () => {
        const hooks = await mem9Plugin(input);
        assert.deepEqual(hooks, {});
      });

      assert.equal(
        warnings.some((message) => message.includes("Setup pending")),
        true,
      );
    },
  );
});
