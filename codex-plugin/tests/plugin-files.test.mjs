import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("plugin manifest exposes mem9 setup skill and basic metadata", () => {
  assert.equal(existsSync("./.codex-plugin/plugin.json"), true);
  const manifest = JSON.parse(
    readFileSync("./.codex-plugin/plugin.json", "utf8"),
  );
  const packageManifest = JSON.parse(
    readFileSync("./package.json", "utf8"),
  );

  assert.equal(manifest.name, "mem9");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(typeof manifest.description, "string");
  assert.match(manifest.description, /\$mem9:setup/);
  assert.equal(packageManifest.engines.node, ">=22");
  assert.equal(packageManifest.files.includes("lib/"), true);
});

test("plugin templates and skills exist with mem9 hook wiring", () => {
  assert.equal(existsSync("./skills/setup/SKILL.md"), true);
  assert.equal(existsSync("./skills/project-config/SKILL.md"), true);
  assert.equal(existsSync("./skills/recall/SKILL.md"), true);
  assert.equal(existsSync("./skills/store/SKILL.md"), true);
  assert.equal(existsSync("./lib/config.mjs"), true);
  assert.equal(existsSync("./hooks/session-start.mjs"), true);
  assert.equal(existsSync("./bootstrap-hooks/session-start.mjs"), true);
  assert.equal(existsSync("./templates/hooks.json"), true);
  assert.equal(existsSync("../.agents/plugins/marketplace.json"), true);
  assert.equal(existsSync("./hooks/shared/config.mjs"), false);
  assert.equal(existsSync("./hooks/shared/http.mjs"), false);
  assert.equal(existsSync("./hooks/shared/project-root.mjs"), false);
  assert.equal(existsSync("./hooks/shared/skill-runtime.mjs"), false);

  const setupSkill = readFileSync("./skills/setup/SKILL.md", "utf8");
  const projectSkill = readFileSync("./skills/project-config/SKILL.md", "utf8");
  const recallSkill = readFileSync("./skills/recall/SKILL.md", "utf8");
  const storeSkill = readFileSync("./skills/store/SKILL.md", "utf8");
  const marketplace = JSON.parse(
    readFileSync("../.agents/plugins/marketplace.json", "utf8"),
  );
  const hooksTemplate = JSON.parse(
    readFileSync("./templates/hooks.json", "utf8"),
  );

  assert.match(setupSkill, /node \.\/scripts\/setup\.mjs/);
  assert.match(setupSkill, /--inspect-profiles/);
  assert.match(setupSkill, /Ask the user which path to take|ask the user which path to take/i);
  assert.doesNotMatch(setupSkill, /disable-model-invocation:\s*true/);
  assert.doesNotMatch(setupSkill, /--scope/);
  assert.match(projectSkill, /node \.\/scripts\/project-config\.mjs/);
  assert.match(recallSkill, /cat <<'EOF' \| node \.\/scripts\/recall\.mjs/);
  assert.match(storeSkill, /cat <<'EOF' \| node \.\/scripts\/store\.mjs/);
  assert.match(projectSkill, /<project>\.\/?\.codex\/mem9\/config\.json|<project>\/\.codex\/mem9\/config\.json/);
  assert.equal(marketplace.name, "mem9-ai");
  assert.equal(marketplace.plugins[0].name, "mem9");
  assert.equal(marketplace.plugins[0].source.path, "./codex-plugin");
  assert.equal(marketplace.plugins[0].policy.authentication, "ON_INSTALL");
  assert.equal(
    hooksTemplate.hooks.SessionStart[0].hooks[0].statusMessage,
    "[mem9] session start",
  );
  assert.equal(
    hooksTemplate.hooks.UserPromptSubmit[0].hooks[0].command,
    "__MEM9_USER_PROMPT_SUBMIT_COMMAND__",
  );
  assert.equal(
    hooksTemplate.hooks.Stop[0].hooks[0].timeout,
    20,
  );
});

test("README explains global hooks and project overrides", () => {
  const readme = readFileSync("./README.md", "utf8");

  assert.match(readme, /^# Mem9 for Codex/m);
  assert.match(readme, /persistent memory/i);
  assert.match(readme, /## Quick Start/);
  assert.match(readme, /\$mem9:setup/);
  assert.match(readme, /\$mem9:project-config/);
  assert.match(readme, /\$mem9:recall/);
  assert.match(readme, /\$mem9:store/);
  assert.match(readme, /inspects the saved global profiles first/i);
  assert.match(readme, /codex plugin marketplace add mem9-ai\/mem9/);
  assert.match(readme, /install `mem9` from the `mem9-ai` marketplace inside Codex/i);
  assert.match(readme, /<repo>\/\.agents\/plugins\/marketplace\.json/);
  assert.match(readme, /Codex CLI `0\.122\.0` or newer/);
  assert.match(readme, /Node\.js 22 or newer/);
  assert.match(readme, /\$CODEX_HOME\/hooks\.json/);
  assert.match(readme, /<project>\/\.codex\/mem9\/config\.json/);
  assert.match(readme, /\$MEM9_HOME\/\.credentials\.json/);
  assert.match(readme, /\$CODEX_HOME\/mem9\/hooks\//);
  assert.match(readme, /\$CODEX_HOME\/mem9\/install\.json/);
  assert.match(readme, /MEM9_DEBUG=1/);
  assert.match(readme, /\$CODEX_HOME\/mem9\/logs\/codex-hooks\.jsonl/);
  assert.match(readme, /You do not need to enable hooks manually first/);
  assert.doesNotMatch(readme, /--scope project/);
});
