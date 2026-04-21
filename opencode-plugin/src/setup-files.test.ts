import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { resolveMem9Paths } from "./platform-paths.js";
import { loadSetupDefaults, writeSetupFiles } from "./setup-files.js";

async function createPaths(): Promise<{
  root: string;
  paths: ReturnType<typeof resolveMem9Paths>;
}> {
  const parent = path.join(process.cwd(), ".tmp");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "mem9-opencode-setup-"));
  const paths = resolveMem9Paths({
    configDir: path.join(root, "config", "opencode"),
    dataDir: path.join(root, "data", "opencode"),
    projectDir: path.join(root, "project"),
    mem9Home: path.join(root, ".mem9"),
  });
  return { root, paths };
}

test("loadSetupDefaults falls back to a fresh default profile", async () => {
  const { root, paths } = await createPaths();

  try {
    const defaults = await loadSetupDefaults(paths, "user");
    assert.deepEqual(defaults, {
      profileId: "default",
      label: "Personal",
      baseUrl: "https://api.mem9.ai",
    });
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
});

test("writeSetupFiles writes credentials, scope config, and plugin registration", async () => {
  const { root, paths } = await createPaths();

  try {
    const result = await writeSetupFiles({
      paths,
      scope: "project",
      pluginSpec: "@mem9/opencode@latest",
      profileId: "acme",
      label: "Acme",
      baseUrl: "https://api.mem9.ai",
      apiKey: "mk_demo",
    });

    assert.equal(result.credentialsFile, paths.credentialsFile);
    assert.equal(result.scopeConfigFile, paths.projectConfigFile);
    assert.equal(result.pluginConfigFile, paths.projectPluginConfigFile);

    const credentials = JSON.parse(await readFile(paths.credentialsFile, "utf8")) as {
      schemaVersion: number;
      profiles: Record<string, { label: string; baseUrl: string; apiKey: string }>;
    };
    assert.deepEqual(credentials, {
      schemaVersion: 1,
      profiles: {
        acme: {
          label: "Acme",
          baseUrl: "https://api.mem9.ai",
          apiKey: "mk_demo",
        },
      },
    });

    const scopeConfig = JSON.parse(await readFile(paths.projectConfigFile, "utf8")) as {
      profileId: string;
      debug: boolean;
      defaultTimeoutMs: number;
      searchTimeoutMs: number;
    };
    assert.deepEqual(scopeConfig, {
      schemaVersion: 1,
      profileId: "acme",
      debug: false,
      defaultTimeoutMs: 8000,
      searchTimeoutMs: 15000,
    });

    const pluginConfig = JSON.parse(
      await readFile(paths.projectPluginConfigFile, "utf8"),
    ) as { plugin: string[] };
    assert.deepEqual(pluginConfig, {
      plugin: ["@mem9/opencode@latest"],
    });
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
});

test("writeSetupFiles preserves existing plugin entries and flags duplicate scope registration", async () => {
  const { root, paths } = await createPaths();

  try {
    await writeSetupFiles({
      paths,
      scope: "user",
      pluginSpec: "@mem9/opencode@latest",
      profileId: "default",
      label: "Personal",
      baseUrl: "https://api.mem9.ai",
      apiKey: "mk_old",
    });

    const result = await writeSetupFiles({
      paths,
      scope: "project",
      pluginSpec: "@mem9/opencode",
      profileId: "project",
      label: "Project",
      baseUrl: "https://api.mem9.ai",
      apiKey: "mk_project",
    });

    assert.equal(result.duplicatePluginConfigFile, paths.globalPluginConfigFile);

    const userPluginConfig = JSON.parse(
      await readFile(paths.globalPluginConfigFile, "utf8"),
    ) as { plugin: string[] };
    const projectPluginConfig = JSON.parse(
      await readFile(paths.projectPluginConfigFile, "utf8"),
    ) as { plugin: string[] };

    assert.deepEqual(userPluginConfig, {
      plugin: ["@mem9/opencode@latest"],
    });
    assert.deepEqual(projectPluginConfig, {
      plugin: ["@mem9/opencode"],
    });
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
});
