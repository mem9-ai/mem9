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
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(typeof manifest.description, "string");
  assert.match(manifest.description, /\$mem9:setup/);
  assert.equal(packageManifest.version, "0.2.0");
  assert.equal(packageManifest.version, manifest.version);
  assert.equal(packageManifest.engines.node, ">=22");
  assert.equal(packageManifest.files.includes("lib/"), true);
});

test("plugin templates and skills exist with mem9 hook wiring", () => {
  assert.equal(existsSync("./skills/setup/SKILL.md"), true);
  assert.equal(existsSync("./skills/project-config/SKILL.md"), false);
  assert.equal(existsSync("./skills/cleanup/SKILL.md"), true);
  assert.equal(existsSync("./skills/recall/SKILL.md"), true);
  assert.equal(existsSync("./skills/recall/agents/openai.yaml"), true);
  assert.equal(existsSync("./skills/store/SKILL.md"), true);
  assert.equal(existsSync("./skills/store/agents/openai.yaml"), true);
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
  const cleanupSkill = readFileSync("./skills/cleanup/SKILL.md", "utf8");
  const recallSkill = readFileSync("./skills/recall/SKILL.md", "utf8");
  const recallSkillPolicy = readFileSync("./skills/recall/agents/openai.yaml", "utf8");
  const storeSkill = readFileSync("./skills/store/SKILL.md", "utf8");
  const storeSkillPolicy = readFileSync("./skills/store/agents/openai.yaml", "utf8");
  const marketplace = JSON.parse(
    readFileSync("../.agents/plugins/marketplace.json", "utf8"),
  );
  const hooksTemplate = JSON.parse(
    readFileSync("./templates/hooks.json", "utf8"),
  );

  assert.match(setupSkill, /node \.\/scripts\/setup\.mjs/);
  assert.match(setupSkill, /node \.\/scripts\/setup\.mjs --help/);
  assert.match(setupSkill, /profile save-key --help/);
  assert.match(setupSkill, /setup\.mjs inspect/);
  assert.match(setupSkill, /profile create/);
  assert.match(setupSkill, /profile save-key/);
  assert.match(setupSkill, /scope apply/);
  assert.match(setupSkill, /scope clear/);
  assert.match(setupSkill, /MEM9_API_KEY/);
  assert.match(setupSkill, /copy `profiles\.items\[\*\]\.displaySummary` verbatim/);
  assert.match(setupSkill, /Do not rewrite it into generic text like `key saved`/);
  assert.match(setupSkill, /Example: `default \(019d\.\.\.4356\) · https:\/\/api\.mem9\.ai`/);
  assert.match(setupSkill, /updateCheck/);
  assert.match(setupSkill, /--update-check enabled\|disabled/);
  assert.match(setupSkill, /--update-check-interval-hours <hours>/);
  assert.doesNotMatch(setupSkill, /disable-model-invocation:\s*true/);
  assert.match(cleanupSkill, /node \.\/scripts\/cleanup\.mjs --help/);
  assert.match(cleanupSkill, /cleanup\.mjs run --help/);
  assert.match(cleanupSkill, /node \.\/scripts\/cleanup\.mjs inspect/);
  assert.match(cleanupSkill, /node \.\/scripts\/cleanup\.mjs run/);
  assert.match(cleanupSkill, /--include-project/);
  assert.match(cleanupSkill, /\$CODEX_HOME\/hooks\.json/);
  assert.match(cleanupSkill, /\$CODEX_HOME\/mem9\/state\.json/);
  assert.match(cleanupSkill, /\$MEM9_HOME\/\.credentials\.json/);
  assert.match(recallSkill, /node \.\/scripts\/recall\.mjs --help/);
  assert.match(recallSkill, /cat <<'EOF' \| node \.\/scripts\/recall\.mjs/);
  assert.match(recallSkillPolicy, /allow_implicit_invocation:\s*false/);
  assert.match(storeSkill, /node \.\/scripts\/store\.mjs --help/);
  assert.match(storeSkill, /cat <<'EOF' \| node \.\/scripts\/store\.mjs/);
  assert.match(storeSkillPolicy, /allow_implicit_invocation:\s*false/);
  assert.equal(marketplace.name, "mem9-ai");
  assert.equal(marketplace.plugins[0].name, "mem9");
  assert.equal(marketplace.plugins[0].source.path, "./codex-plugin");
  assert.equal(marketplace.plugins[0].policy.authentication, "ON_USE");
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

  assert.match(readme, /^# Codex Plugin for mem9/m);
  assert.match(readme, /Persistent memory for \[Codex\]\(https:\/\/developers\.openai\.com\/codex\)\./);
  assert.match(readme, /## Install and First-Time Setup/);
  assert.match(readme, /## Daily Commands/);
  assert.match(readme, /\$mem9:setup/);
  assert.match(readme, /\$mem9:cleanup/);
  assert.match(readme, /\$mem9:recall/);
  assert.match(readme, /\$mem9:store/);
  assert.doesNotMatch(readme, /\$mem9:project-config/);
  assert.match(readme, /codex plugin marketplace add mem9-ai\/mem9/);
  assert.match(readme, /run `\/plugins`, search for `mem9`, open the `mem9-ai` marketplace entry, and choose `Install plugin`/i);
  assert.match(readme, /## Upgrade/);
  assert.match(readme, /codex plugin marketplace upgrade mem9-ai/);
  assert.match(readme, /This updates the installed mem9 plugin for normal releases\./);
  assert.match(readme, /## Uninstall \/ Reset/);
  assert.match(readme, /Follow this order:/);
  assert.match(readme, /1\.\s+Enter Codex and run `\$mem9:cleanup`\./);
  assert.match(readme, /2\.\s+In Codex, open `\/plugins`, search for `mem9`, and uninstall the plugin\./);
  assert.match(readme, /3\.\s+After step 2 succeeds, exit Codex and run:/);
  assert.match(readme, /codex plugin marketplace remove mem9-ai/);
  assert.match(readme, /keeps mem9-managed hooks and plugin state in sync/i);
  assert.match(readme, /keeps `\$MEM9_HOME\/\.credentials\.json`/);
  assert.match(readme, /delete `\$MEM9_HOME\/\.credentials\.json` after the uninstall steps finish/i);
  assert.match(readme, /## Local Development \/ Testing/);
  assert.match(readme, /open the repo-local marketplace entry for this checkout, and choose `Install plugin`/i);
  assert.match(readme, /## Debugging/);
  assert.match(readme, /## Reference: Files, Config, Environment/);
  assert.match(readme, /### File Layout/);
  assert.match(readme, /### Config Files/);
  assert.match(readme, /<project>\/\.codex\/mem9\/config\.json/);
  assert.match(readme, /\$MEM9_HOME\/\.credentials\.json/);
  assert.match(readme, /\$CODEX_HOME\/mem9\/install\.json/);
  assert.match(readme, /MEM9_DEBUG=1/);
  assert.match(readme, /\$CODEX_HOME\/mem9\/logs\/codex-hooks\.jsonl/);
  assert.match(readme, /searches `\/v1alpha2\/mem9s\/memories` with the current API key/);
  assert.doesNotMatch(readme, /agent_id=codex/);
  assert.match(readme, /node \.\/skills\/setup\/scripts\/setup\.mjs --help/);
  assert.match(readme, /node \.\/skills\/cleanup\/scripts\/cleanup\.mjs --help/);
  assert.match(readme, /You do not need to enable hooks manually first/);
  assert.doesNotMatch(readme, /--use-existing/);
  assert.match(readme, /rerun `\$mem9:setup`, then choose `use-existing`/);
});
