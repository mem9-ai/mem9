#!/usr/bin/env node
// @ts-nocheck

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildMem9Url, mem9FetchJson, mem9Headers } from "../../../lib/http.mjs";
import { loadReadyRuntimeState } from "../../../lib/skill-runtime.mjs";

const DEFAULT_LIMIT = 10;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isHelpToken(token) {
  const normalized = normalizeString(token);
  return normalized === "--help" || normalized === "-h";
}

function shouldWriteRecallHelp(argv = process.argv.slice(2)) {
  const tokens = Array.isArray(argv)
    ? argv.map((token) => normalizeString(token)).filter(Boolean)
    : [];
  return tokens.length === 0 || tokens.some(isHelpToken);
}

function buildRecallHelpText() {
  return [
    "mem9 recall",
    "",
    "Recall mem9 memories with the current effective profile.",
    "",
    "Usage:",
    "  node ./scripts/recall.mjs --query <query> [--limit <count>] [--cwd <path>]",
    "  cat <<'EOF' | node ./scripts/recall.mjs [--limit <count>] [--cwd <path>]",
    "  your query here",
    "  EOF",
    "",
    "Flags:",
    "  --query <query>    Recall query text. Reads stdin when omitted.",
    "  --limit <count>    Maximum memories to return. Defaults to 10.",
    "  --cwd <path>       Resolve repo-local runtime config from this directory.",
    "",
    "Notes:",
    "  - Successful non-help commands print a sanitized JSON summary.",
    "  - This script uses the current effective mem9 profile and project override when present.",
    "",
    "Examples:",
    "  node ./scripts/recall.mjs --query 'release checklist' --limit 5",
    "  cat <<'EOF' | node ./scripts/recall.mjs --cwd .",
    "  team preferences",
    "  EOF",
    "",
  ].join("\n");
}

function parseIntegerArg(flag, value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }

  return parsed;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    cwd: "",
    query: "",
    limit: DEFAULT_LIMIT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const nextValue = argv[index + 1];

    switch (token) {
      case "--cwd":
        args.cwd = normalizeString(nextValue);
        index += 1;
        break;
      case "--query":
        args.query = normalizeString(nextValue);
        index += 1;
        break;
      case "--limit":
        args.limit = parseIntegerArg(token, nextValue);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

export function buildRecallUrl(baseUrl, query, limit = DEFAULT_LIMIT) {
  const url = buildMem9Url(baseUrl, "v1alpha2/mem9s/memories");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

export function extractMemories(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.memories)) {
      return payload.memories;
    }
    if (Array.isArray(payload.data)) {
      return payload.data;
    }
  }

  return [];
}

export function normalizeMemorySummary(memory) {
  return {
    id: normalizeString(memory?.id),
    content: normalizeString(memory?.content),
    memoryType: normalizeString(memory?.memory_type),
    tags: Array.isArray(memory?.tags)
      ? memory.tags.filter((value) => typeof value === "string" && value.trim())
      : [],
    score: typeof memory?.score === "number" ? memory.score : null,
    relativeAge: normalizeString(memory?.relative_age),
  };
}

function readStdinText() {
  return readFileSync(0, "utf8");
}

export async function runRecall(argv = process.argv.slice(2), options = {}) {
  const args = Array.isArray(argv) ? parseArgs(argv) : argv;
  const query = normalizeString(args.query)
    || normalizeString(options.stdinText)
    || (
      (options.stdin ?? process.stdin)?.isTTY === false
        ? normalizeString(readStdinText())
        : ""
    );

  if (!query) {
    throw new Error("--query is required.");
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
  const payload = await fetchJson(
    buildRecallUrl(
      state.runtime.baseUrl,
      query,
      args.limit,
    ),
    {
      method: "GET",
      headers: mem9Headers(state.runtime.apiKey, state.runtime.agentId),
      timeoutMs: state.runtime.searchTimeoutMs,
    },
  );
  const memories = extractMemories(payload)
    .slice(0, args.limit)
    .map(normalizeMemorySummary)
    .filter((memory) => memory.content);
  const summary = {
    status: "ok",
    profileId: state.runtime.profileId,
    configSource: state.configSource,
    query,
    memoryCount: memories.length,
    memories,
  };
  const stdout = options.stdout ?? process.stdout;
  stdout?.write?.(`${JSON.stringify(summary)}\n`);
  return summary;
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout ?? process.stdout;
  if (Array.isArray(argv) && shouldWriteRecallHelp(argv)) {
    stdout?.write?.(buildRecallHelpText());
    return {
      status: "ok",
      command: "help",
      topic: "root",
    };
  }

  return runRecall(argv, options);
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
