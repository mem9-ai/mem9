// @ts-check

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(THIS_DIR, "..");

/**
 * Parse simple YAML frontmatter key/value pairs from a Markdown document.
 * @param {string} markdown
 * @returns {{ frontmatter: Record<string, string>, body: string, hasFrontmatter: boolean }}
 */
function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: markdown, hasFrontmatter: false };
  }

  /** @type {Record<string, string>} */
  const frontmatter = {};
  const lines = match[1].split(/\r?\n/);
  let currentKey = "";
  let blockMode = false;

  for (const line of lines) {
    if (blockMode && /^\s+/.test(line)) {
      frontmatter[currentKey] = frontmatter[currentKey]
        ? `${frontmatter[currentKey]} ${line.trim()}`
        : line.trim();
      continue;
    }
    blockMode = false;

    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) {
      continue;
    }

    const [, key, rawVal] = kv;
    currentKey = key;
    if (rawVal === ">" || rawVal === ">-" || rawVal === "|" || rawVal === "|-") {
      frontmatter[key] = "";
      blockMode = true;
    } else {
      frontmatter[key] = rawVal.replace(/^["']|["']$/g, "").trim();
    }
  }

  return { frontmatter, body: match[2], hasFrontmatter: true };
}

/**
 * Check whether the `agy` CLI binary is available on PATH.
 * @returns {boolean}
 */
function isAgyAvailable() {
  const probe = spawnSync("agy", ["--version"], { encoding: "utf8" });
  return !probe.error && probe.status === 0;
}

test("plugin.json matches official Antigravity schema and branding rules", () => {
  const manifestPath = path.join(PLUGIN_ROOT, "plugin.json");
  assert.equal(existsSync(manifestPath), true);

  const manifest = /** @type {Record<string, unknown>} */ (
    JSON.parse(readFileSync(manifestPath, "utf8"))
  );

  const allowedKeys = new Set([
    "$schema",
    "name",
    "displayName",
    "version",
    "description",
    "logo",
    "suggestedPrompts",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
  ]);
  for (const key of Object.keys(manifest)) {
    assert.equal(allowedKeys.has(key), true, `Unexpected manifest property: ${key}`);
  }
  assert.equal("mcpServers" in manifest, false);
  assert.equal("hooks" in manifest, false);

  assert.equal(manifest.$schema, "https://antigravity.google/schemas/v1/plugin.json");
  assert.equal(manifest.name, "mem9");
  assert.match(String(manifest.name), /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal(manifest.displayName, "mem9");
  assert.doesNotMatch(String(manifest.displayName), /^(Antigravity|Gemini|Claude|Cursor)/i);
  assert.doesNotMatch(String(manifest.displayName), /(Plugin|MCP)$/i);
  assert.match(String(manifest.version), /^\d+\.\d+\.\d+$/);

  const description = String(manifest.description ?? "");
  assert.equal(
    description.length >= 120 && description.length <= 160,
    true,
    `Expected description length 120-160, got ${description.length}`,
  );

  assert.equal(manifest.logo, "assets/logo.svg");
  const logoPath = path.join(PLUGIN_ROOT, String(manifest.logo));
  assert.equal(existsSync(logoPath), true);
  const logoSvg = readFileSync(logoPath, "utf8");
  assert.match(logoSvg, /viewBox="0 0 180 180"/);
  assert.match(logoSvg, /width="180"/);
  assert.match(logoSvg, /height="180"/);
  assert.match(logoSvg, /monospace/);

  assert.equal(Array.isArray(manifest.suggestedPrompts), true);
  const prompts = /** @type {string[]} */ (manifest.suggestedPrompts);
  assert.equal(prompts.length, 3);
  for (const prompt of prompts) {
    assert.equal(typeof prompt === "string" && prompt.trim().length > 0, true);
  }

  assert.deepEqual(manifest.author, { name: "mem9-ai", url: "https://mem9.ai" });
  assert.equal(manifest.homepage, "https://mem9.ai");
  assert.equal(manifest.repository, "https://github.com/mem9-ai/mem9");
  assert.equal(manifest.license, "Apache-2.0");
  assert.deepEqual(manifest.keywords, ["mem9", "memory", "persistent-memory", "context", "tidb"]);
});

test("no root AGENTS.md or node_modules exists, and rules/AGENTS.md is plain Markdown", () => {
  assert.equal(existsSync(path.join(PLUGIN_ROOT, "AGENTS.md")), false);
  assert.equal(existsSync(path.join(PLUGIN_ROOT, "node_modules")), false);

  const rulesPath = path.join(PLUGIN_ROOT, "rules", "AGENTS.md");
  assert.equal(existsSync(rulesPath), true);
  const rulesText = readFileSync(rulesPath, "utf8");
  assert.equal(rulesText.trimStart().startsWith("---"), false);
  assert.match(rulesText, /<relevant-memories>/);
  assert.match(rulesText, /<mem9-status-warning>/);

  for (const toolName of [
    "memory_search",
    "memory_store",
    "memory_get",
    "memory_update",
    "memory_delete",
    "memory_status",
  ]) {
    assert.equal(rulesText.includes(toolName), true, `rules/AGENTS.md missing ${toolName}`);
  }
});

test("agents/memory-curator.md has required Antigravity frontmatter", () => {
  const agentPath = path.join(PLUGIN_ROOT, "agents", "memory-curator.md");
  assert.equal(existsSync(agentPath), true);

  const parsed = parseFrontmatter(readFileSync(agentPath, "utf8"));
  assert.equal(parsed.hasFrontmatter, true);
  assert.equal(parsed.frontmatter.name, "memory-curator");
  assert.equal(parsed.frontmatter.description.length > 0, true);
  assert.equal(parsed.frontmatter.model, "flash");
  assert.equal(parsed.frontmatter.mainAgent, "true");
  assert.equal(parsed.frontmatter.subagent, "true");
  assert.equal(parsed.frontmatter.commandExecutionPolicy, "sandbox");
  assert.equal(parsed.frontmatter.inheritMcp, "true");
  assert.equal(parsed.frontmatter.inheritCustomizations, "true");
});

test("skills match folder names and use only Antigravity-supported frontmatter", () => {
  const skillsDir = path.join(PLUGIN_ROOT, "skills");
  const skillFolders = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(skillFolders, ["mem9-recall", "mem9-setup", "mem9-store"]);

  const allowedFrontmatterKeys = new Set(["name", "description", "disable-model-invocation"]);
  for (const folder of skillFolders) {
    const skillPath = path.join(skillsDir, folder, "SKILL.md");
    assert.equal(existsSync(skillPath), true);
    const raw = readFileSync(skillPath, "utf8");
    const parsed = parseFrontmatter(raw);
    assert.equal(parsed.hasFrontmatter, true);
    assert.equal(parsed.frontmatter.name, folder);
    assert.equal(parsed.frontmatter.description.length > 0, true);
    assert.equal(parsed.frontmatter.description.length <= 1024, true);

    for (const key of Object.keys(parsed.frontmatter)) {
      assert.equal(
        allowedFrontmatterKeys.has(key),
        true,
        `Unsupported skill frontmatter key "${key}" in ${folder}`,
      );
    }
    assert.doesNotMatch(raw, /^context:\s*fork/m);
    assert.doesNotMatch(raw, /^allowed-tools:/m);
  }
});

test("hooks.json uses flat event arrays with relative ./scripts/ paths", () => {
  const hooksPath = path.join(PLUGIN_ROOT, "hooks.json");
  assert.equal(existsSync(hooksPath), true);

  const hooksJson = /** @type {Record<string, Record<string, unknown>>} */ (
    JSON.parse(readFileSync(hooksPath, "utf8"))
  );
  const groupNames = Object.keys(hooksJson);
  assert.equal(groupNames.length > 0, true);

  const mem9Group = hooksJson["mem9-memory"];
  assert.ok(mem9Group, "Expected mem9-memory hook group");
  assert.equal(mem9Group.enabled, true);

  for (const eventName of ["SessionStart", "PreInvocation", "Stop"]) {
    const handlers = mem9Group[eventName];
    assert.equal(Array.isArray(handlers), true, `${eventName} must be an array`);
    const list = /** @type {Record<string, unknown>[]} */ (handlers);
    assert.equal(list.length > 0, true, `${eventName} must have at least one handler`);
    for (const handler of list) {
      assert.equal("matcher" in handler, false, `${eventName} must be flat without matcher`);
      assert.equal("hooks" in handler, false, `${eventName} must be flat without hooks wrapper`);
      assert.equal(handler.type, "command");
      const command = String(handler.command ?? "");
      assert.match(command, /\.\/scripts\/[a-z-]+\.mjs\b/);
      assert.equal(command.includes("${PLUGIN_ROOT}"), false);
    }
  }
});

test("mcp_config.json uses PLUGIN_ROOT script arg without variables or duplicate env vars", () => {
  const mcpPath = path.join(PLUGIN_ROOT, "mcp_config.json");
  assert.equal(existsSync(mcpPath), true);

  const mcpJson = /** @type {Record<string, unknown>} */ (
    JSON.parse(readFileSync(mcpPath, "utf8"))
  );
  assert.equal("variables" in mcpJson, false);

  const servers = /** @type {Record<string, Record<string, unknown>>} */ (mcpJson.mcpServers);
  assert.ok(servers?.mem9, "Expected mcpServers.mem9");
  assert.equal(servers.mem9.command, "node");
  assert.deepEqual(servers.mem9.args, ["${PLUGIN_ROOT}/scripts/mcp-server.mjs"]);
  assert.equal("variables" in servers.mem9, false);

  const env = /** @type {Record<string, unknown> | undefined} */ (servers.mem9.env);
  if (env) {
    assert.equal("PLUGIN_ROOT" in env, false);
    assert.equal("PLUGIN_DATA" in env, false);
  }
});

test("runtime and setup scripts have 0755 permissions and zero npm dependencies", () => {
  const packageJson = /** @type {Record<string, unknown>} */ (
    JSON.parse(readFileSync(path.join(PLUGIN_ROOT, "package.json"), "utf8"))
  );
  assert.equal(packageJson.name, "@mem9/antigravity-plugin");
  assert.equal(packageJson.type, "module");
  assert.equal("dependencies" in packageJson, false);
  assert.equal("devDependencies" in packageJson, false);

  const executables = [
    "scripts/session-start.mjs",
    "scripts/pre-invocation.mjs",
    "scripts/stop.mjs",
    "scripts/mcp-server.mjs",
    "skills/mem9-setup/scripts/setup.mjs",
  ];
  for (const relativePath of executables) {
    const fullPath = path.join(PLUGIN_ROOT, relativePath);
    assert.equal(existsSync(fullPath), true, `Missing executable script: ${relativePath}`);
    if (process.platform !== "win32") {
      assert.equal(
        statSync(fullPath).mode & 0o777,
        0o755,
        `Expected 0755 permissions on ${relativePath}`,
      );
    }
  }
});

test("agy plugin validate --strict --json reports zero findings and exact component counts", (t) => {
  if (!isAgyAvailable()) {
    t.skip("agy CLI not installed on PATH");
    return;
  }

  const output = execFileSync(
    "agy",
    ["plugin", "validate", "--strict", "--json", "."],
    {
      cwd: PLUGIN_ROOT,
      encoding: "utf8",
    },
  );
  const report = /** @type {{
    name?: string,
    findings?: unknown[],
    components?: Record<string, number>,
  }} */ (JSON.parse(output));

  assert.equal(report.name, "mem9");
  assert.deepEqual(report.findings, []);
  assert.equal(report.components?.skills, 3);
  assert.equal(report.components?.mcpServers, 1);
  assert.equal(report.components?.agents, 1);
  assert.equal(report.components?.rules, 1);
  assert.equal(report.components?.hooks, 1);
});
