import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  readInstallMetadata,
  resolveActivePluginVersion,
  runHookShim,
} from "../bootstrap-hooks/shared/bootstrap.mjs";
import { createTempRoot } from "./test-temp.mjs";

/**
 * @param {string} filePath
 * @param {unknown} value
 */
function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test("resolveActivePluginVersion matches Codex local preference and lexical sort", () => {
  const tempRoot = createTempRoot("bootstrap");

  try {
    const codexHome = path.join(tempRoot, "codex-home");
    const cacheRoot = path.join(codexHome, "plugins", "cache", "mem9-ai", "mem9");
    mkdirSync(path.join(cacheRoot, "0.10.0"), { recursive: true });
    mkdirSync(path.join(cacheRoot, "0.9.0"), { recursive: true });
    mkdirSync(path.join(cacheRoot, "local"), { recursive: true });
    mkdirSync(path.join(cacheRoot, "bad version"), { recursive: true });

    assert.equal(
      resolveActivePluginVersion({
        codexHome,
        marketplaceName: "mem9-ai",
        pluginName: "mem9",
      }),
      "local",
    );

    rmSync(path.join(cacheRoot, "local"), { recursive: true, force: true });

    assert.equal(
      resolveActivePluginVersion({
        codexHome,
        marketplaceName: "mem9-ai",
        pluginName: "mem9",
      }),
      "0.9.0",
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runHookShim loads the active plugin hook from install metadata", async () => {
  const tempRoot = createTempRoot();
  const originalWrite = process.stdout.write;
  const originalPluginVersion = process.env.MEM9_CODEX_PLUGIN_VERSION;

  try {
    const codexHome = path.join(tempRoot, "codex-home");
    const pluginRoot = path.join(
      codexHome,
      "plugins",
      "cache",
      "mem9-ai",
      "mem9",
      "local",
    );
    writeJson(path.join(codexHome, "mem9", "install.json"), {
      schemaVersion: 1,
      marketplaceName: "mem9-ai",
      pluginName: "mem9",
      shimVersion: 1,
    });
    mkdirSync(path.join(pluginRoot, "hooks"), { recursive: true });
    writeFileSync(
      path.join(pluginRoot, "hooks", "session-start.mjs"),
      "export async function main() { return 'shim-ok'; }\n",
    );

    let stdoutText = "";
    process.stdout.write = /** @type {typeof process.stdout.write} */ ((chunk) => {
      stdoutText += String(chunk);
      return true;
    });

    const install = readInstallMetadata({ codexHome });
    assert.equal(install.marketplaceName, "mem9-ai");
    assert.equal(install.pluginName, "mem9");

    const output = await runHookShim("session-start.mjs", { codexHome });
    assert.equal(output, "shim-ok");
    assert.equal(stdoutText, "shim-ok");
    assert.equal(process.env.MEM9_CODEX_PLUGIN_VERSION, "local");
  } finally {
    process.stdout.write = originalWrite;
    if (originalPluginVersion) {
      process.env.MEM9_CODEX_PLUGIN_VERSION = originalPluginVersion;
    } else {
      delete process.env.MEM9_CODEX_PLUGIN_VERSION;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runHookShim takes the repair path when install metadata is missing", async () => {
  const tempRoot = createTempRoot();
  const originalWrite = process.stdout.write;

  try {
    const codexHome = path.join(tempRoot, "codex-home");
    const pluginRoot = path.join(
      codexHome,
      "plugins",
      "cache",
      "mem9-ai",
      "mem9",
      "local",
    );
    mkdirSync(path.join(pluginRoot, "hooks"), { recursive: true });
    writeFileSync(
      path.join(pluginRoot, "hooks", "session-start.mjs"),
      "export async function main() { return 'should-not-run'; }\n",
    );

    let stdoutText = "";
    process.stdout.write = /** @type {typeof process.stdout.write} */ ((chunk) => {
      stdoutText += String(chunk);
      return true;
    });

    const output = await runHookShim("session-start.mjs", { codexHome });
    const parsed = JSON.parse(output);

    assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(parsed.hookSpecificOutput.additionalContext, /hooks remain installed/);
    assert.match(parsed.hookSpecificOutput.additionalContext, /\$mem9:cleanup/);
    assert.equal(stdoutText, output);
  } finally {
    process.stdout.write = originalWrite;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runHookShim takes the repair path when install metadata is invalid", async () => {
  const tempRoot = createTempRoot();
  const originalWrite = process.stdout.write;

  try {
    const codexHome = path.join(tempRoot, "codex-home");
    const pluginRoot = path.join(
      codexHome,
      "plugins",
      "cache",
      "mem9-ai",
      "mem9",
      "local",
    );
    writeJson(path.join(codexHome, "mem9", "install.json"), {
      schemaVersion: 1,
      marketplaceName: "mem9-ai",
      shimVersion: 1,
    });
    mkdirSync(path.join(pluginRoot, "hooks"), { recursive: true });
    writeFileSync(
      path.join(pluginRoot, "hooks", "stop.mjs"),
      "export async function main() { throw new Error('should-not-run'); }\n",
    );

    let stdoutText = "";
    process.stdout.write = /** @type {typeof process.stdout.write} */ ((chunk) => {
      stdoutText += String(chunk);
      return true;
    });

    const output = await runHookShim("stop.mjs", { codexHome });
    assert.equal(output, undefined);
    assert.equal(stdoutText, "");
  } finally {
    process.stdout.write = originalWrite;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runHookShim takes the repair path when the active plugin root is missing", async () => {
  const tempRoot = createTempRoot();
  const originalWrite = process.stdout.write;

  try {
    const codexHome = path.join(tempRoot, "codex-home");
    writeJson(path.join(codexHome, "mem9", "install.json"), {
      schemaVersion: 1,
      marketplaceName: "mem9-ai",
      pluginName: "mem9",
      shimVersion: 1,
    });

    let stdoutText = "";
    process.stdout.write = /** @type {typeof process.stdout.write} */ ((chunk) => {
      stdoutText += String(chunk);
      return true;
    });

    const output = await runHookShim("session-start.mjs", { codexHome });
    const parsed = JSON.parse(output);

    assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(parsed.hookSpecificOutput.additionalContext, /active mem9 plugin files are unavailable/);
    assert.equal(stdoutText, output);
  } finally {
    process.stdout.write = originalWrite;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("installed bootstrap shim keeps the repair path self-contained", async () => {
  const tempRoot = createTempRoot();
  const originalWrite = process.stdout.write;

  try {
    const codexHome = path.join(tempRoot, "codex-home");
    const shimPath = path.join(codexHome, "mem9", "hooks", "shared", "bootstrap.mjs");
    mkdirSync(path.dirname(shimPath), { recursive: true });
    writeFileSync(
      shimPath,
      readFileSync(new URL("../bootstrap-hooks/shared/bootstrap.mjs", import.meta.url), "utf8"),
    );

    let stdoutText = "";
    process.stdout.write = /** @type {typeof process.stdout.write} */ ((chunk) => {
      stdoutText += String(chunk);
      return true;
    });

    const installedShim = await import(pathToFileURL(shimPath).href);
    const output = await installedShim.runHookShim("session-start.mjs", { codexHome });
    const parsed = JSON.parse(output);

    assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(parsed.hookSpecificOutput.additionalContext, /hooks remain installed/);
    assert.match(parsed.hookSpecificOutput.additionalContext, /\$mem9:cleanup/);
    assert.equal(stdoutText, output);
  } finally {
    process.stdout.write = originalWrite;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bootstrap hook wrapper keeps a zero exit status when the real hook throws", () => {
  const tempRoot = createTempRoot();

  try {
    const codexHome = path.join(tempRoot, "codex-home");
    const pluginRoot = path.join(
      codexHome,
      "plugins",
      "cache",
      "mem9-ai",
      "mem9",
      "local",
    );
    const wrapperPath = path.resolve("./bootstrap-hooks/stop.mjs");

    writeJson(path.join(codexHome, "mem9", "install.json"), {
      schemaVersion: 1,
      marketplaceName: "mem9-ai",
      pluginName: "mem9",
      shimVersion: 1,
    });
    mkdirSync(path.join(pluginRoot, "hooks"), { recursive: true });
    writeFileSync(
      path.join(pluginRoot, "hooks", "stop.mjs"),
      "export async function main() { throw new Error('boom'); }\n",
    );

    const result = spawnSync(
      process.execPath,
      [wrapperPath],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
        },
        input: "{}",
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
