// @ts-check

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = 1;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 200;

/**
 * @param {string} message
 * @returns {string}
 */
export function noticeHash(message) {
  return `sha256:${createHash("sha256").update(message).digest("hex")}`;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

/**
 * @param {string} filePath
 * @returns {{schemaVersion: number, sessions: Record<string, {seenMessages: string[], updatedAt: string}>}}
 */
function readState(filePath) {
  if (!existsSync(filePath)) {
    return { schemaVersion: SCHEMA_VERSION, sessions: {} };
  }

  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  const sessions = isRecord(parsed?.sessions) ? parsed.sessions : {};
  /** @type {Record<string, {seenMessages: string[], updatedAt: string}>} */
  const normalized = {};
  for (const [sessionID, rawSession] of Object.entries(sessions)) {
    if (!isRecord(rawSession)) {
      continue;
    }
    normalized[sessionID] = {
      seenMessages: stringArray(rawSession.seenMessages),
      updatedAt: typeof rawSession.updatedAt === "string" ? rawSession.updatedAt : "",
    };
  }

  return { schemaVersion: SCHEMA_VERSION, sessions: normalized };
}

/**
 * @param {ReturnType<typeof readState>} state
 * @param {Date} now
 */
function pruneState(state, now) {
  const cutoff = now.getTime() - RETENTION_MS;
  for (const [sessionID, session] of Object.entries(state.sessions)) {
    const updated = Date.parse(session.updatedAt);
    if (!Number.isFinite(updated) || updated < cutoff) {
      delete state.sessions[sessionID];
    }
  }

  const entries = Object.entries(state.sessions)
    .sort((left, right) => Date.parse(right[1].updatedAt) - Date.parse(left[1].updatedAt));
  for (const [sessionID] of entries.slice(MAX_SESSIONS)) {
    delete state.sessions[sessionID];
  }
}

/**
 * @param {string} filePath
 * @param {ReturnType<typeof readState>} state
 */
function writeState(filePath, state) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tempPath, filePath);
}

/**
 * Returns true when this message should be shown for the current hook run.
 *
 * @param {{stateFile?: string, sessionID?: string, message: string, now?: Date}} input
 * @returns {boolean}
 */
export function claimRuntimeNotice(input) {
  const message = String(input.message ?? "").trim();
  const sessionID = String(input.sessionID ?? "").trim();
  const stateFile = String(input.stateFile ?? "").trim();
  if (!message) {
    return false;
  }
  if (!sessionID || !stateFile) {
    return true;
  }

  try {
    const now = input.now ?? new Date();
    const state = readState(stateFile);
    pruneState(state, now);
    const session = state.sessions[sessionID] ?? { seenMessages: [], updatedAt: "" };
    if (session.seenMessages.includes(message)) {
      session.updatedAt = now.toISOString();
      state.sessions[sessionID] = session;
      writeState(stateFile, state);
      return false;
    }

    session.seenMessages.push(message);
    session.updatedAt = now.toISOString();
    state.sessions[sessionID] = session;
    writeState(stateFile, state);
    return true;
  } catch {
    return true;
  }
}
