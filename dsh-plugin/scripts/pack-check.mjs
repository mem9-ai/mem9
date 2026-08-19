import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { createRequire } from "node:module";

const root = dirname(dirname(new URL(import.meta.url).pathname));
const temp = mkdtempSync(join(tmpdir(), "mem9-dsh-pack-"));
const require = createRequire(import.meta.url);
const dshBin = join(dirname(require.resolve("@deepseek-ai/dsh/package.json")), "lib", "bin.js");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DSH_HOME: join(temp, ".dsh"), DSH_AGENTS_HOME: join(temp, ".agents") },
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${String(result.status)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.stdout;
}

try {
  const packed = run("pnpm", ["pack", "--pack-destination", temp]);
  const tarballName = packed.trim().split("\n").at(-1);
  if (!tarballName?.endsWith(".tgz")) throw new Error(`pnpm pack did not report a tarball: ${packed}`);
  const tarball = isAbsolute(tarballName) ? tarballName : join(temp, tarballName);

  run(process.execPath, [dshBin, "plugin", "--profile", "mem9-pack-smoke", "add", tarball]);
  const config = run(process.execPath, [dshBin, "--profile", "mem9-pack-smoke", "--dump-config"]);
  if (!config.includes("@mem9/dsh-plugin") || !config.includes("id: mem9")) {
    throw new Error(`installed profile did not activate the Mem9 bundle:\n${config}`);
  }

  const profileManifest = JSON.parse(readFileSync(join(temp, ".dsh", "profiles", "mem9-pack-smoke", "package.json"), "utf8"));
  if (!profileManifest.dsh?.profile?.bundles?.includes("@mem9/dsh-plugin")) {
    throw new Error("profile manifest did not list @mem9/dsh-plugin as a bundle");
  }
  run(process.execPath, [dshBin, "plugin", "--profile", "mem9-pack-smoke", "remove", "@mem9/dsh-plugin"]);
  process.stdout.write("mem9 package/profile smoke passed\n");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
