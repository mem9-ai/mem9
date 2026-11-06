// wire.mjs — extract recent conversation messages from a Kimi session's
// wire.jsonl for mem9 ingest.
//
// Usage: node wire.mjs <session_id> <stop|precompact|sessionend> [maxMessages] [maxBytes]
// Prints {"messages":[{role,content}]} on stdout; {"messages":[]} on any failure.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [, , sessionId, mode = "stop", maxMessagesArg, maxBytesArg] = process.argv;
const maxMessages = Number(maxMessagesArg) || 8;
const maxBytes = Number(maxBytesArg) || 20000;

// Previously injected recall context must never be re-ingested.
const STRIP_PATTERNS = [
  /<relevant-memories>[\s\S]*?<\/relevant-memories>/g,
  /<mem9-status-warning>[\s\S]*?<\/mem9-status-warning>/g,
  /<hook_result\b[^>]*>[\s\S]*?<\/hook_result>/g,
];

function stripInjected(text) {
  let out = text;
  for (const pattern of STRIP_PATTERNS) {
    out = out.replace(pattern, "");
  }
  return out.trim();
}

function truncateUtf8(text, budgetBytes) {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= budgetBytes) return text;
  let end = Math.max(budgetBytes, 0);
  // Back off to a code-point boundary so no partial sequence is emitted.
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString("utf8");
}

function findWireFile(home, id) {
  // Primary: the session index maps sessionId -> sessionDir.
  const indexPath = path.join(home, "session_index.jsonl");
  if (existsSync(indexPath)) {
    const lines = readFileSync(indexPath, "utf8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.sessionId !== id || !entry.sessionDir) continue;
        const candidate = path.join(entry.sessionDir, "agents", "main", "wire.jsonl");
        if (existsSync(candidate)) return candidate;
      } catch {}
    }
  }
  // Fallback: scan the sessions tree.
  const sessionsDir = path.join(home, "sessions");
  if (!existsSync(sessionsDir)) return null;
  for (const workDir of readdirSync(sessionsDir)) {
    const candidate = path.join(sessionsDir, workDir, id, "agents", "main", "wire.jsonl");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function parseWire(filePath) {
  const lines = readFileSync(filePath, "utf8").split("\n");

  // Protocol gate: fail soft on anything but wire protocol v1.
  const firstLine = lines.find((line) => line.trim());
  if (firstLine) {
    try {
      const version = String(JSON.parse(firstLine).protocol_version ?? "");
      if (version && !version.startsWith("1.")) return [];
    } catch {}
  }

  const entries = []; // { seq, role, content } in file order
  const turnTexts = new Map(); // turnId -> entry (assistant text accumulates)
  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type === "context.append_message") {
      const message = record.message ?? {};
      if (message.role !== "user" || message.origin?.kind !== "user") continue;
      const text = (Array.isArray(message.content) ? message.content : [])
        .filter((part) => part && part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
      const content = stripInjected(text);
      if (content) entries.push({ role: "user", content });
    } else if (record.type === "context.append_loop_event") {
      const event = record.event ?? {};
      const part = event.part ?? {};
      if (event.type !== "content.part" || part.type !== "text") continue;
      if (typeof part.text !== "string" || part.text.startsWith("blobref:")) continue;
      const turnId = String(event.turnId ?? "");
      let entry = turnTexts.get(turnId);
      if (!entry) {
        entry = { role: "assistant", content: "" };
        turnTexts.set(turnId, entry);
        entries.push(entry);
      }
      entry.content += part.text;
    }
  }

  return entries
    .map((entry) => ({ role: entry.role, content: stripInjected(entry.content) }))
    .filter((entry) => entry.content);
}

function selectWindow(messages) {
  let window = messages;
  if (mode !== "precompact") {
    // stop/sessionend: from the last user message onward.
    let lastUser = -1;
    for (let i = window.length - 1; i >= 0; i -= 1) {
      if (window[i].role === "user") {
        lastUser = i;
        break;
      }
    }
    if (lastUser >= 0) window = window.slice(lastUser);
  }
  window = window.slice(-maxMessages);

  // Byte budget from the tail; truncate the oldest retained message if needed.
  let total = 0;
  const selected = [];
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const size = Buffer.byteLength(window[i].content);
    if (total + size > maxBytes && selected.length > 0) break;
    selected.unshift(window[i]);
    total += size;
  }
  if (total > maxBytes && selected.length > 0) {
    const first = selected[0];
    const excess = total - maxBytes;
    selected[0] = {
      ...first,
      content: truncateUtf8(first.content, Buffer.byteLength(first.content) - excess),
    };
  }
  // The server ignores assistant-only payloads: keep the latest user message.
  if (selected.length > 0 && !selected.some((m) => m.role === "user")) {
    const latestUser = [...messages].reverse().find((m) => m.role === "user");
    if (latestUser) {
      selected.unshift({ ...latestUser, content: truncateUtf8(latestUser.content, maxBytes) });
    }
  }
  return selected;
}

function main() {
  if (!sessionId) return { messages: [] };
  const home = process.env.KIMI_CODE_HOME || path.join(os.homedir(), ".kimi-code");
  const file = findWireFile(home, sessionId);
  if (!file) return { messages: [] };
  return { messages: selectWindow(parseWire(file)) };
}

try {
  process.stdout.write(JSON.stringify(main()));
} catch {
  process.stdout.write('{"messages":[]}');
}
