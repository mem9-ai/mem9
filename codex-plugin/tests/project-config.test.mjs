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

import { runProjectConfig } from "../skills/project-config/scripts/project-config.mjs";

function createTempRoot() {
  const parent = path.join(process.cwd(), ".tmp-project-config-tests");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, "case-"));
}

test("project-config writes a local profile override and preserves local timeouts", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "repo");
    const codexHome = path.join(tempRoot, "codex-home");
    const mem9Home = path.join(tempRoot, "mem9-home");
    mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    mkdirSync(path.join(projectRoot, "packages", "web"), { recursive: true });
    mkdirSync(path.join(projectRoot, ".codex", "mem9"), { recursive: true });
    mkdirSync(path.join(codexHome, "mem9"), { recursive: true });
    mkdirSync(mem9Home, { recursive: true });

    writeFileSync(
      path.join(codexHome, "mem9", "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        profileId: "default",
      }, null, 2),
    );
    writeFileSync(
      path.join(projectRoot, ".codex", "mem9", "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        profileId: "default",
        defaultTimeoutMs: 8100,
      }, null, 2),
    );
    writeFileSync(
      path.join(mem9Home, ".credentials.json"),
      JSON.stringify({
        schemaVersion: 1,
        profiles: {
          default: {
            label: "Personal",
            baseUrl: "https://api.mem9.ai",
            apiKey: "key-1",
          },
          work: {
            label: "Work",
            baseUrl: "https://api.mem9.ai",
            apiKey: "key-2",
          },
        },
      }, null, 2),
    );

    await runProjectConfig(
      ["--profile", "work"],
      {
        cwd: path.join(projectRoot, "packages", "web"),
        codexHome,
        mem9Home,
        interactive: false,
      },
    );

    const saved = JSON.parse(
      readFileSync(path.join(projectRoot, ".codex", "mem9", "config.json"), "utf8"),
    );
    assert.equal(saved.profileId, "work");
    assert.equal(saved.defaultTimeoutMs, 8100);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("project-config writes enabled false for disable", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "repo");
    mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

    await runProjectConfig(["--disable"], {
      cwd: projectRoot,
      interactive: false,
    });

    const saved = JSON.parse(
      readFileSync(path.join(projectRoot, ".codex", "mem9", "config.json"), "utf8"),
    );
    assert.equal(saved.enabled, false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("project-config reset removes the override file", async () => {
  const tempRoot = createTempRoot();

  try {
    const projectRoot = path.join(tempRoot, "repo");
    mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    mkdirSync(path.join(projectRoot, ".codex", "mem9"), { recursive: true });
    writeFileSync(
      path.join(projectRoot, ".codex", "mem9", "config.json"),
      JSON.stringify({ schemaVersion: 1, profileId: "work" }, null, 2),
    );

    await runProjectConfig(["--reset"], {
      cwd: projectRoot,
      interactive: false,
    });

    assert.equal(
      existsSync(path.join(projectRoot, ".codex", "mem9", "config.json")),
      false,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("project-config errors outside a git repository", async () => {
  await assert.rejects(
    () => runProjectConfig(["--disable"], {
      cwd: "/workspace/scratch",
      interactive: false,
      existsSync() {
        return false;
      },
    }),
    /not inside a Git repository/,
  );
});
