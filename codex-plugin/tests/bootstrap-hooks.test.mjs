import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  readInstallMetadata,
  resolveActivePluginVersion,
  runHookShim,
} from "../bootstrap-hooks/shared/bootstrap.mjs";

function createTempRoot() {
  const parent = path.join(process.cwd(), ".tmp-bootstrap-tests");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, "case-"));
}

/**
 * @param {string} filePath
 * @param {unknown} value
 */
function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test("resolveActivePluginVersion matches Codex local preference and lexical sort", () => {
  const tempRoot = createTempRoot();

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
