#!/usr/bin/env node
// @ts-nocheck

import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveCodexHome, resolveMem9Home } from "../../../lib/config.mjs";
import { resolveProjectRoot } from "../../../lib/project-root.mjs";

const MEM9_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop"];
const MEM9_MANAGED_HOOKS = {
  SessionStart: {
    statusMessage: "[mem9] session start",
    scriptName: "session-start.mjs",
  },
  UserPromptSubmit: {
    statusMessage: "[mem9] recall",
    scriptName: "user-prompt-submit.mjs",
  },
  Stop: {
    statusMessage: "[mem9] save",
    scriptName: "stop.mjs",
  },
};

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isHelpToken(token) {
  const normalized = normalizeString(token);
  return normalized === "--help" || normalized === "-h";
}

function detectCleanupHelpRequest(argv = process.argv.slice(2)) {
  const tokens = Array.isArray(argv)
    ? argv.map((token) => normalizeString(token)).filter(Boolean)
    : [];
  const helpIndex = tokens.findIndex(isHelpToken);

  if (tokens.length === 0 || helpIndex === 0) {
    return {
      command: "",
    };
  }

  if (helpIndex === -1) {
    return null;
  }

  return {
    command: tokens[0] || "",
  };
}

function buildCleanupHelpText(command = "") {
  switch (normalizeString(command)) {
    case "inspect":
      return [
        "mem9 cleanup inspect",
        "",
        "Usage:",
        "  node ./scripts/cleanup.mjs inspect [--cwd <path>]",
        "",
        "Print the current cleanup targets as JSON.",
        "",
        "Flags:",
        "  --cwd <path>    Resolve repo-local paths from this directory.",
        "",
        "Example:",
        "  node ./scripts/cleanup.mjs inspect --cwd .",
        "",
      ].join("\n");
    case "run":
      return [
        "mem9 cleanup run",
        "",
        "Usage:",
        "  node ./scripts/cleanup.mjs run [--include-project] [--cwd <path>]",
        "",
        "Remove mem9-managed Codex files.",
        "",
        "Flags:",
        "  --include-project   Also remove the current project's .codex/mem9/config.json override.",
        "  --cwd <path>        Resolve repo-local paths from this directory.",
        "",
        "Examples:",
        "  node ./scripts/cleanup.mjs run",
        "  node ./scripts/cleanup.mjs run --include-project --cwd .",
        "",
      ].join("\n");
    default:
      return [
        "mem9 cleanup",
        "",
        "Remove mem9-managed Codex files before reinstalling, resetting, or uninstalling mem9.",
        "",
        "Usage:",
        "  node ./scripts/cleanup.mjs inspect [--cwd <path>]",
        "  node ./scripts/cleanup.mjs run [--include-project] [--cwd <path>]",
        "",
        "Commands:",
        "  inspect     Print the current cleanup targets as JSON.",
        "  run         Remove mem9-managed global files and optionally the current project override.",
        "",
        "Notes:",
        "  - Successful non-help commands print sanitized JSON summaries.",
        "  - Global cleanup keeps $MEM9_HOME/.credentials.json, $CODEX_HOME/config.toml, and debug logs.",
        "",
        "Examples:",
        "  node ./scripts/cleanup.mjs inspect --cwd .",
        "  node ./scripts/cleanup.mjs run",
        "  node ./scripts/cleanup.mjs run --include-project --cwd .",
        "",
        "Run a subcommand with --help for more detail.",
        "",
      ].join("\n");
  }
}

function maybeWriteCleanupHelp(argv, stdout) {
  const request = detectCleanupHelpRequest(argv);
  if (!request) {
    return null;
  }

  stdout.write(buildCleanupHelpText(request.command));
  return {
    status: "ok",
    command: "help",
    topic: request.command || "root",
  };
}

function sanitizeRelativePath(filePath, basePath, options = {}) {
  const resolvedBase = normalizeString(basePath) ? path.resolve(basePath) : "";
  if (!resolvedBase) {
    return "";
  }

  const resolved = path.resolve(filePath);
  if (!options.allowParentTraversal) {
    if (resolved === resolvedBase) {
      return ".";
    }

    if (resolved.startsWith(`${resolvedBase}${path.sep}`)) {
      return path.relative(resolvedBase, resolved).replaceAll(path.sep, "/");
    }

    return "";
  }

  const relative = path.relative(resolvedBase, resolved).replaceAll(path.sep, "/");
  if (!relative) {
    return ".";
  }

  return path.isAbsolute(relative) ? "" : relative;
}

function sanitizeDisplayPath(filePath, { cwd, codexHome, mem9Home }) {
  const resolved = path.resolve(filePath);
  const resolvedCwd = normalizeString(cwd) ? path.resolve(cwd) : "";
  const resolvedCodexHome = normalizeString(codexHome) ? path.resolve(codexHome) : "";
  const resolvedMem9Home = normalizeString(mem9Home) ? path.resolve(mem9Home) : "";

  if (
    resolved === resolvedMem9Home
    || resolved.startsWith(`${resolvedMem9Home}${path.sep}`)
  ) {
    const suffix = path.relative(resolvedMem9Home, resolved).replaceAll(path.sep, "/");
    return suffix ? `$MEM9_HOME/${suffix}` : "$MEM9_HOME";
  }

  if (
    resolved === resolvedCodexHome
    || resolved.startsWith(`${resolvedCodexHome}${path.sep}`)
  ) {
    const suffix = path.relative(resolvedCodexHome, resolved).replaceAll(path.sep, "/");
    return suffix ? `$CODEX_HOME/${suffix}` : "$CODEX_HOME";
  }

  if (
    resolved === resolvedCwd
    || resolved.startsWith(`${resolvedCwd}${path.sep}`)
  ) {
    const suffix = path.relative(resolvedCwd, resolved).replaceAll(path.sep, "/");
    return suffix || ".";
  }

  return path.basename(resolved);
}

function sanitizeProjectConfigPath(filePath, context) {
  const projectRelative = sanitizeRelativePath(filePath, context.projectRoot);
  return projectRelative || sanitizeDisplayPath(filePath, context);
}

function sanitizeProjectRootPath(filePath, context) {
  const cwdRelative = sanitizeRelativePath(filePath, context.cwd, {
    allowParentTraversal: true,
  });
  return cwdRelative || sanitizeDisplayPath(filePath, context);
}

function sanitizeOptionalPath(filePath, context) {
  return normalizeString(filePath)
    ? sanitizeDisplayPath(filePath, context)
    : "";
}

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "", ...rest] = argv;
  const args = {
    command: normalizeString(command),
    cwd: "",
    includeProject: false,
  };

  if (!["inspect", "run"].includes(args.command)) {
    throw new Error("Expected `inspect` or `run`.");
  }

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const nextValue = rest[index + 1];

    switch (token) {
      case "--cwd":
        args.cwd = normalizeString(nextValue);
        index += 1;
        break;
      case "--include-project":
        args.includeProject = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function isWritablePath(targetPath, fsOps = {}) {
  const exists = fsOps.existsSync ?? existsSync;
  const access = fsOps.accessSync ?? accessSync;
  const accessConstants = fsOps.constants ?? constants;
  let probe = path.resolve(targetPath);

  while (!exists(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) {
      return false;
    }
    probe = parent;
  }

  try {
    access(probe, accessConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveContext(args = {}, options = {}) {
  const env = options.env ?? process.env;
  const cwd = path.resolve(
    normalizeString(options.cwd)
      || normalizeString(args.cwd)
      || process.cwd(),
  );
  const codexHome = resolveCodexHome(options.codexHome, env, options.homeDir);
  const mem9Home = resolveMem9Home(options.mem9Home, env, options.homeDir);
  const fsOps = {
    accessSync: options.accessSync,
    constants: options.constants,
    existsSync: options.existsSync,
    readFileSync: options.readFileSync,
    rmSync: options.rmSync,
    writeFileSync: options.writeFileSync,
  };
  const projectRoot = resolveProjectRoot({
    cwd,
    exists: fsOps.existsSync ?? existsSync,
  });
  const globalPaths = {
    hooksPath: path.join(codexHome, "hooks.json"),
    hooksDir: path.join(codexHome, "mem9", "hooks"),
    installPath: path.join(codexHome, "mem9", "install.json"),
    configPath: path.join(codexHome, "mem9", "config.json"),
    statePath: path.join(codexHome, "mem9", "state.json"),
    configTomlPath: path.join(codexHome, "config.toml"),
    debugLogPath: path.join(codexHome, "mem9", "logs", "codex-hooks.jsonl"),
  };
  const projectConfigPath = projectRoot
    ? path.join(projectRoot, ".codex", "mem9", "config.json")
    : "";

  return {
    args,
    cwd,
    codexHome,
    mem9Home,
    fsOps,
    projectRoot,
    globalPaths,
    projectConfigPath,
    pathContext: {
      cwd,
      codexHome,
      mem9Home,
      projectRoot,
    },
  };
}

function normalizeHookCommand(command) {
  return String(command).replaceAll("\\", "/");
}

function managedHookCommandFragments(scriptName) {
  return [
    `mem9/hooks/${scriptName}`,
    `mem9/runtime/${scriptName}`,
  ];
}

function isMem9ManagedHook(eventName, hook) {
  if (!isRecord(hook) || typeof hook.command !== "string") {
    return false;
  }

  const expected = MEM9_MANAGED_HOOKS[eventName];
  if (!expected) {
    return false;
  }

  return hook.statusMessage === expected.statusMessage
    && managedHookCommandFragments(expected.scriptName)
      .some((fragment) => normalizeHookCommand(hook.command).includes(fragment));
}

function readJsonFile(filePath, fsOps = {}) {
  const readFile = fsOps.readFileSync ?? readFileSync;
  return JSON.parse(readFile(filePath, "utf8"));
}

function writeJsonFile(filePath, value, fsOps = {}) {
  const writeFile = fsOps.writeFileSync ?? writeFileSync;
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function buildCleanupSnapshot(context) {
  const exists = context.fsOps.existsSync ?? existsSync;
  const managedHooks = inspectManagedHooks(context.globalPaths.hooksPath, context);
  const hooksDirPresent = exists(context.globalPaths.hooksDir);
  const installMetadataPresent = exists(context.globalPaths.installPath);
  const globalConfigPresent = exists(context.globalPaths.configPath);
  const stateFilePresent = exists(context.globalPaths.statePath);
  const projectConfigPresent = context.projectRoot && context.projectConfigPath
    ? exists(context.projectConfigPath)
    : false;
  const credentialsPresent = exists(path.join(context.mem9Home, ".credentials.json"));
  const configTomlPresent = exists(context.globalPaths.configTomlPath);
  const debugLogsPresent = exists(context.globalPaths.debugLogPath);

  const managedHooksTarget = {
    ...managedHooks,
    wouldRemove: managedHooks.state === "present" && managedHooks.managedHookCount > 0,
  };
  const hooksDirTarget = {
    present: hooksDirPresent,
    path: sanitizeDisplayPath(context.globalPaths.hooksDir, context.pathContext),
    wouldRemove: hooksDirPresent,
  };
  const installMetadataTarget = {
    present: installMetadataPresent,
    path: sanitizeDisplayPath(context.globalPaths.installPath, context.pathContext),
    wouldRemove: installMetadataPresent,
  };
  const globalConfigTarget = {
    present: globalConfigPresent,
    path: sanitizeDisplayPath(context.globalPaths.configPath, context.pathContext),
    wouldRemove: globalConfigPresent,
  };
  const stateFileTarget = {
    present: stateFilePresent,
    path: sanitizeDisplayPath(context.globalPaths.statePath, context.pathContext),
    wouldRemove: stateFilePresent,
  };
  const projectConfigTarget = {
    available: Boolean(context.projectRoot),
    present: Boolean(projectConfigPresent),
    path: normalizeString(context.projectConfigPath)
      ? sanitizeProjectConfigPath(context.projectConfigPath, context.pathContext)
      : "",
    wouldRemove: Boolean(projectConfigPresent),
  };
  const credentialsTarget = {
    present: credentialsPresent,
    path: sanitizeDisplayPath(path.join(context.mem9Home, ".credentials.json"), context.pathContext),
    untouched: true,
    wouldRemove: false,
  };
  const configTomlTarget = {
    present: configTomlPresent,
    path: sanitizeDisplayPath(context.globalPaths.configTomlPath, context.pathContext),
    untouched: true,
    wouldRemove: false,
  };
  const debugLogsTarget = {
    present: debugLogsPresent,
    path: sanitizeDisplayPath(context.globalPaths.debugLogPath, context.pathContext),
    untouched: true,
    wouldRemove: false,
  };

  const removableTargets = {
    global: [
      managedHooksTarget.wouldRemove
        ? {
          kind: "managedHooks",
          path: managedHooksTarget.path,
          managedHookCount: managedHooksTarget.managedHookCount,
        }
        : null,
      hooksDirTarget.wouldRemove
        ? {
          kind: "hooksDir",
          path: hooksDirTarget.path,
        }
        : null,
      installMetadataTarget.wouldRemove
        ? {
          kind: "installMetadata",
          path: installMetadataTarget.path,
        }
        : null,
      globalConfigTarget.wouldRemove
        ? {
          kind: "globalConfig",
          path: globalConfigTarget.path,
        }
        : null,
      stateFileTarget.wouldRemove
        ? {
          kind: "stateFile",
          path: stateFileTarget.path,
        }
        : null,
    ].filter(Boolean),
    project: [
      projectConfigTarget.wouldRemove
        ? {
          kind: "projectConfig",
          path: projectConfigTarget.path,
        }
        : null,
    ].filter(Boolean),
  };

  return {
    removableTargets,
    wouldRemove: {
      global: removableTargets.global.length > 0,
      project: removableTargets.project.length > 0,
      any: removableTargets.global.length > 0 || removableTargets.project.length > 0,
      credentials: false,
    },
    global: {
      managedHooks: managedHooksTarget,
      hooksDir: hooksDirTarget,
      installMetadata: installMetadataTarget,
      globalConfig: globalConfigTarget,
      stateFile: stateFileTarget,
    },
    project: {
      available: Boolean(context.projectRoot),
      config: projectConfigTarget,
    },
    credentials: credentialsTarget,
    configToml: configTomlTarget,
    debugLogs: debugLogsTarget,
  };
}

function inspectManagedHooks(filePath, context) {
  const exists = context.fsOps.existsSync ?? existsSync;

  if (!exists(filePath)) {
    return {
      state: "missing",
      present: false,
      path: sanitizeDisplayPath(filePath, context.pathContext),
      managedHookCount: 0,
    };
  }

  try {
    const value = readJsonFile(filePath, context.fsOps);
    let managedHookCount = 0;

    for (const eventName of MEM9_EVENTS) {
      const groups = Array.isArray(value?.hooks?.[eventName]) ? value.hooks[eventName] : [];
      for (const group of groups) {
        const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
        managedHookCount += hooks.filter((hook) => isMem9ManagedHook(eventName, hook)).length;
      }
    }

    return {
      state: "present",
      present: true,
      path: sanitizeDisplayPath(filePath, context.pathContext),
      managedHookCount,
    };
  } catch {
    return {
      state: "invalid",
      present: true,
      path: sanitizeDisplayPath(filePath, context.pathContext),
      managedHookCount: 0,
    };
  }
}

function removeManagedHooks(existingHooks) {
  const next = isRecord(existingHooks) ? structuredClone(existingHooks) : {};
  next.hooks = isRecord(next.hooks) ? next.hooks : {};

  for (const eventName of MEM9_EVENTS) {
    if (!Array.isArray(next.hooks[eventName])) {
      continue;
    }

    const groups = next.hooks[eventName];
    next.hooks[eventName] = groups
      .map((group) => {
        if (!isRecord(group) || !Array.isArray(group.hooks)) {
          return group;
        }

        const remainingHooks = group.hooks.filter(
          (hook) => !isMem9ManagedHook(eventName, hook),
        );
        if (remainingHooks.length === 0) {
          return null;
        }

        return {
          ...group,
          hooks: remainingHooks,
        };
      })
      .filter(Boolean);
  }

  return next;
}

function inspectCleanup(argv = process.argv.slice(2), options = {}) {
  const args = Array.isArray(argv) ? parseArgs(argv) : argv;
  const context = resolveContext(args, options);
  const snapshot = buildCleanupSnapshot(context);

  const summary = {
    status: "ok",
    command: "inspect",
    cwd: sanitizeDisplayPath(context.cwd, context.pathContext),
    projectRoot: normalizeString(context.projectRoot)
      ? sanitizeProjectRootPath(context.projectRoot, context.pathContext)
      : "",
    wouldRemove: snapshot.wouldRemove,
    removableTargets: snapshot.removableTargets,
    global: snapshot.global,
    project: snapshot.project,
    credentials: snapshot.credentials,
    configToml: snapshot.configToml,
    debugLogs: snapshot.debugLogs,
  };

  options.stdout?.write?.(`${JSON.stringify(summary)}\n`);
  return summary;
}

function ensureWritableCleanupTargets(context, includeProject) {
  if (!isWritablePath(context.codexHome, context.fsOps)) {
    throw new Error("Global Codex home is not writable.");
  }

  if (includeProject) {
    if (!context.projectRoot) {
      throw new Error("Current directory is not inside a Git repository. Run cleanup from a project before using `--include-project`.");
    }

    if (!isWritablePath(context.projectConfigPath, context.fsOps)) {
      throw new Error("Current project mem9 config path is not writable.");
    }
  }
}

function runCleanup(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const helpResult = Array.isArray(argv) ? maybeWriteCleanupHelp(argv, stdout) : null;
  if (helpResult) {
    return helpResult;
  }

  const args = Array.isArray(argv) ? parseArgs(argv) : argv;
  const context = resolveContext(args, options);
  const exists = context.fsOps.existsSync ?? existsSync;
  const removePath = context.fsOps.rmSync ?? rmSync;

  if (args.command === "inspect") {
    return inspectCleanup(args, {
      ...options,
      stdout,
    });
  }

  ensureWritableCleanupTargets(context, args.includeProject);

  const before = buildCleanupSnapshot(context);
  let managedHooksAction = "already-clear";

  if (
    before.global.managedHooks.state === "present"
    && before.global.managedHooks.managedHookCount > 0
  ) {
    const existingHooks = readJsonFile(context.globalPaths.hooksPath, context.fsOps);
    const nextHooks = removeManagedHooks(existingHooks);
    writeJsonFile(context.globalPaths.hooksPath, nextHooks, context.fsOps);
    managedHooksAction = "updated";
  } else if (before.global.managedHooks.state === "invalid") {
    managedHooksAction = "skipped-invalid";
  }

  const removedHooksDir = exists(context.globalPaths.hooksDir);
  removePath(context.globalPaths.hooksDir, { recursive: true, force: true });
  const removedInstallMetadata = exists(context.globalPaths.installPath);
  removePath(context.globalPaths.installPath, { force: true });
  const removedGlobalConfig = exists(context.globalPaths.configPath);
  removePath(context.globalPaths.configPath, { force: true });
  const removedStateFile = exists(context.globalPaths.statePath);
  removePath(context.globalPaths.statePath, { force: true });

  let removedProjectConfig = false;
  if (args.includeProject && context.projectConfigPath) {
    removedProjectConfig = exists(context.projectConfigPath);
    removePath(context.projectConfigPath, { force: true });
  }

  const result = {
    status: "ok",
    command: "run",
    includeProject: args.includeProject,
    cwd: sanitizeDisplayPath(context.cwd, context.pathContext),
    projectRoot: normalizeString(context.projectRoot)
      ? sanitizeProjectRootPath(context.projectRoot, context.pathContext)
      : "",
    wouldRemoveBefore: before.wouldRemove,
    removableTargetsBefore: before.removableTargets,
    removed: {
      managedHooks: managedHooksAction,
      hooksDir: removedHooksDir,
      installMetadata: removedInstallMetadata,
      globalConfig: removedGlobalConfig,
      stateFile: removedStateFile,
      projectConfig: removedProjectConfig,
    },
    paths: {
      managedHooks: before.global.managedHooks.path,
      hooksDir: before.global.hooksDir.path,
      installMetadata: before.global.installMetadata.path,
      globalConfig: before.global.globalConfig.path,
      stateFile: before.global.stateFile.path,
      projectConfig: before.project.config.path,
    },
    credentials: before.credentials,
    configToml: before.configToml,
    debugLogs: before.debugLogs,
  };

  stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

export {
  inspectCleanup,
  main,
  parseArgs,
  runCleanup,
};

function main(argv = process.argv.slice(2), options = {}) {
  return runCleanup(argv, {
    ...options,
    stdout: options.stdout ?? process.stdout,
  });
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  Promise.resolve()
    .then(() => main(process.argv.slice(2)))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
