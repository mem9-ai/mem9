#!/usr/bin/env node
// @ts-nocheck

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildMem9Url, mem9FetchJson, mem9Headers } from "../../../lib/http.mjs";
import { loadReadyRuntimeState } from "../../../lib/skill-runtime.mjs";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isHelpToken(token) {
  const normalized = normalizeString(token);
  return normalized === "--help" || normalized === "-h";
}

function shouldWriteStoreHelp(argv = process.argv.slice(2)) {
  const tokens = Array.isArray(argv)
    ? argv.map((token) => normalizeString(token)).filter(Boolean)
    : [];
  return tokens.length === 0 || tokens.some(isHelpToken);
}

function buildStoreHelpText() {
  return [
    "mem9 store",
    "",
    "Store one memory with the current effective profile.",
    "",
    "Usage:",
    "  node ./scripts/store.mjs --content <memory-text> [--cwd <path>]",
    "  cat <<'EOF' | node ./scripts/store.mjs [--cwd <path>]",
    "  memory text here",
    "  EOF",
    "",
    "Flags:",
    "  --content <memory-text>   Memory content to store. Reads stdin when omitted.",
    "  --cwd <path>              Resolve repo-local runtime config from this directory.",
    "",
    "Notes:",
    "  - Successful non-help commands print a sanitized JSON summary.",
    "  - This script uses the current effective mem9 profile and project override when present.",
    "",
    "Examples:",
    "  node ./scripts/store.mjs --content 'The team prefers short release notes.'",
    "  cat <<'EOF' | node ./scripts/store.mjs --cwd .",
    "  Remember that we pin Node 22 for Codex hooks.",
    "  EOF",
    "",
  ].join("\n");
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    cwd: "",
    content: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const nextValue = argv[index + 1];

    switch (token) {
      case "--cwd":
        args.cwd = normalizeString(nextValue);
        index += 1;
        break;
      case "--content":
        args.content = normalizeString(nextValue);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function readStdinText() {
  return readFileSync(0, "utf8");
}

export async function runStore(argv = process.argv.slice(2), options = {}) {
  const args = Array.isArray(argv) ? parseArgs(argv) : argv;
  const content = normalizeString(args.content)
    || normalizeString(options.stdinText)
    || (
      (options.stdin ?? process.stdin)?.isTTY === false
        ? normalizeString(readStdinText())
        : ""
    );

  if (!content) {
    throw new Error("--content is required.");
  }

  const cwd = path.resolve(
    normalizeString(options.cwd)
      || normalizeString(args.cwd)
      || process.cwd(),
  );
  const state = options.state ?? loadReadyRuntimeState({
    cwd,
    codexHome: options.codexHome,
    mem9Home: options.mem9Home,
    homeDir: options.homeDir,
    env: options.env,
  });
  const fetchJson = options.fetchJson ?? mem9FetchJson;
  await fetchJson(
    buildMem9Url(state.runtime.baseUrl, "v1alpha2/mem9s/memories").toString(),
    {
      method: "POST",
      headers: mem9Headers(state.runtime.apiKey, state.runtime.agentId),
      body: JSON.stringify({
        content,
        sync: true,
      }),
      timeoutMs: state.runtime.defaultTimeoutMs,
    },
  );

  const summary = {
    status: "ok",
    profileId: state.runtime.profileId,
    configSource: state.configSource,
    contentChars: content.length,
  };
  const stdout = options.stdout ?? process.stdout;
  stdout?.write?.(`${JSON.stringify(summary)}\n`);
  return summary;
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout ?? process.stdout;
  if (Array.isArray(argv) && shouldWriteStoreHelp(argv)) {
    stdout?.write?.(buildStoreHelpText());
    return {
      status: "ok",
      command: "help",
      topic: "root",
    };
  }

  return runStore(argv, options);
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
