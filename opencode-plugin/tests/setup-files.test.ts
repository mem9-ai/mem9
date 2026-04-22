import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { resolveMem9Paths } from "../src/shared/platform-paths.js";
import {
  loadSetupState,
  provisionApiKey,
  writeScopeConfig,
  writeSetupFiles,
} from "../src/shared/setup-files.js";

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

async function writeJSON(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

test("loadSetupState falls back to fresh profile and scope defaults", async () => {
  const { root, paths } = await createPaths();

  try {
    const state = await loadSetupState(paths);
    assert.deepEqual(state, {
      suggestedProfileId: "default",
      suggestedNewProfileId: "default",
      suggestedLabel: "Personal",
      suggestedBaseUrl: "https://api.mem9.ai",
      profiles: [],
      usableProfiles: [],
      scopeStates: {
        user: {
          profileId: "default",
          debug: false,
          defaultTimeoutMs: 8000,
          searchTimeoutMs: 15000,
        },
        project: {
          profileId: "default",
          debug: false,
          defaultTimeoutMs: 8000,
          searchTimeoutMs: 15000,
        },
      },
    });
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
});

test("loadSetupState returns profile summaries and scope defaults for user and project", async () => {
  const { root, paths } = await createPaths();

  try {
    await writeJSON(paths.globalConfigFile, {
      schemaVersion: 1,
      profileId: "acme",
      debug: true,
      defaultTimeoutMs: 12000,
    });
    await writeJSON(paths.projectConfigFile, {
      schemaVersion: 1,
      profileId: "default",
      searchTimeoutMs: 20000,
    });
    await writeJSON(paths.credentialsFile, {
      schemaVersion: 1,
      profiles: {
        default: {
          label: "Personal",
          baseUrl: "https://api.mem9.ai",
          apiKey: "mk_default",
        },
        acme: {
          label: "Acme",
          baseUrl: "https://acme.mem9.ai/",
          apiKey: "   ",
        },
      },
    });

    const state = await loadSetupState(paths);
    assert.deepEqual(state, {
      suggestedProfileId: "acme",
      suggestedNewProfileId: "acme",
      suggestedLabel: "Acme",
      suggestedBaseUrl: "https://acme.mem9.ai",
      profiles: [
        {
          profileId: "default",
          label: "Personal",
          baseUrl: "https://api.mem9.ai",
          hasApiKey: true,
        },
        {
          profileId: "acme",
          label: "Acme",
          baseUrl: "https://acme.mem9.ai",
          hasApiKey: false,
        },
      ],
      usableProfiles: [
        {
          profileId: "default",
          label: "Personal",
          baseUrl: "https://api.mem9.ai",
          hasApiKey: true,
        },
      ],
      scopeStates: {
        user: {
          profileId: "default",
          debug: true,
          defaultTimeoutMs: 12000,
          searchTimeoutMs: 15000,
        },
        project: {
          profileId: "default",
          debug: true,
          defaultTimeoutMs: 12000,
          searchTimeoutMs: 20000,
        },
      },
    });
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
});

test("writeSetupFiles writes shared credentials and keeps the user scope usable", async () => {
  const { root, paths } = await createPaths();

  try {
    await writeJSON(paths.globalConfigFile, {
      schemaVersion: 1,
      debug: true,
      defaultTimeoutMs: 12000,
      searchTimeoutMs: 18000,
      extraFlag: "keep-me",
    });

    await writeSetupFiles({
      paths,
      profileId: "acme",
      label: "Acme",
      baseUrl: "https://api.mem9.ai/",
      apiKey: "mk_demo",
    });

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

    const globalConfig = JSON.parse(await readFile(paths.globalConfigFile, "utf8")) as {
      schemaVersion: number;
      profileId: string;
      debug: boolean;
      defaultTimeoutMs: number;
      searchTimeoutMs: number;
      extraFlag: string;
    };
    assert.deepEqual(globalConfig, {
      schemaVersion: 1,
      profileId: "acme",
      debug: true,
      defaultTimeoutMs: 12000,
      searchTimeoutMs: 18000,
      extraFlag: "keep-me",
    });
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
});

test("writeScopeConfig writes project settings without touching credentials", async () => {
  const { root, paths } = await createPaths();

  try {
    await writeJSON(paths.projectConfigFile, {
      schemaVersion: 1,
      profileId: "default",
      debug: false,
      defaultTimeoutMs: 8000,
      searchTimeoutMs: 15000,
      extraFlag: "keep-project",
    });
    await writeJSON(paths.credentialsFile, {
      schemaVersion: 1,
      profiles: {
        default: {
          label: "Personal",
          baseUrl: "https://api.mem9.ai",
          apiKey: "mk_default",
        },
      },
    });

    await writeScopeConfig({
      paths,
      scope: "project",
      profileId: "default",
      debug: true,
      defaultTimeoutMs: 9000,
      searchTimeoutMs: 16000,
    });

    const credentials = JSON.parse(await readFile(paths.credentialsFile, "utf8")) as {
      schemaVersion: number;
      profiles: Record<string, { apiKey: string }>;
    };
    const projectConfig = JSON.parse(await readFile(paths.projectConfigFile, "utf8")) as {
      schemaVersion: number;
      profileId: string;
      debug: boolean;
      defaultTimeoutMs: number;
      searchTimeoutMs: number;
      extraFlag: string;
    };

    assert.deepEqual(credentials, {
      schemaVersion: 1,
      profiles: {
        default: {
          label: "Personal",
          baseUrl: "https://api.mem9.ai",
          apiKey: "mk_default",
        },
      },
    });
    assert.deepEqual(projectConfig, {
      schemaVersion: 1,
      profileId: "default",
      debug: true,
      defaultTimeoutMs: 9000,
      searchTimeoutMs: 16000,
      extraFlag: "keep-project",
    });
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
});

test("writeScopeConfig rejects profiles without usable credentials", async () => {
  const { root, paths } = await createPaths();

  try {
    await writeJSON(paths.credentialsFile, {
      schemaVersion: 1,
      profiles: {
        broken: {
          label: "Broken",
          baseUrl: "https://api.mem9.ai",
          apiKey: "   ",
        },
      },
    });

    await assert.rejects(
      writeScopeConfig({
        paths,
        scope: "user",
        profileId: "broken",
        debug: false,
        defaultTimeoutMs: 8000,
        searchTimeoutMs: 15000,
      }),
      /unavailable/,
    );
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
});

test("provisionApiKey requests a new API key from mem9", async () => {
  const apiKey = await provisionApiKey({
    baseUrl: "https://api.mem9.ai/",
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://api.mem9.ai/v1alpha1/mem9s");
      assert.equal(init?.method, "POST");
      assert.equal(
        (init?.headers as Record<string, string>)["Content-Type"],
        "application/json",
      );

      return new Response(JSON.stringify({ id: "mk_generated" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
  });

  assert.equal(apiKey, "mk_generated");
});
