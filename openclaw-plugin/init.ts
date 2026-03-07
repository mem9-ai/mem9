import { access, readFile, readdir, stat, writeFile, rename } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";

type Logger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type JsonObject = Record<string, unknown>;

type PluginEntry = {
  id: string;
  config: JsonObject;
};

type AgentWorkspace = {
  agentID: string;
  workspace: string;
};

type UploadFile = {
  absolutePath: string;
  fileName: string;
  mtimeMs: number;
  fileType: "memory" | "session";
  sessionID?: string;
};

type InitState = {
  version: number;
  completed: Record<string, { completedAt: string; uploadedFiles: number; decision?: "uploaded" | "declined" }>;
};

type ProgressReporter = {
  addTotal: (n: number) => void;
  tick: (ok: boolean, label: string) => void;
  finish: () => void;
};

const INIT_STATE_FILE = ".mnemo-init-state.json";
const INIT_STATE_VERSION = 1;
const MAX_MEMORY_FILES_PER_AGENT = 10;
const MAX_SESSION_FILES_PER_AGENT = 10;
const REQUEST_TIMEOUT_MS = 20_000;
const CONSENT_TIMEOUT_MS = 60_000;
const DEFAULT_API_URL = "https://api.mem9.ai";

let initStarted = false;

export async function runBootstrapImport(logger: Logger): Promise<void> {
  if (initStarted) {
    return;
  }
  initStarted = true;

  const openclawJsonPath = await findOpenclawJson(process.cwd());
  if (!openclawJsonPath) {
    logger.info("[mnemo] init: openclaw.json not found, skipping bootstrap import");
    return;
  }

  const openclawRaw = await readJsonFile(openclawJsonPath);
  if (!openclawRaw) {
    logger.info("[mnemo] init: failed to parse openclaw.json, skipping bootstrap import");
    return;
  }

  const plugin = resolveMem9PluginEntry(openclawRaw);
  if (!plugin) {
    logger.info("[mnemo] init: mem9/mnemo plugin entry not found, skipping bootstrap import");
    return;
  }

  const ensured = await ensurePluginConfig(logger, openclawRaw, openclawJsonPath, plugin);
  if (!ensured) {
    logger.info("[mnemo] init: config not ready, skipping bootstrap import");
    return;
  }
  const { apiUrl, tenantID } = ensured;

  const rootDir = path.dirname(openclawJsonPath);
  const statePath = path.join(rootDir, INIT_STATE_FILE);
  const state = await loadState(statePath);
  const stateKey = `${plugin.id}|${normalizeApiUrl(apiUrl)}|${tenantID}`;

  if (state.completed[stateKey]) {
    logger.info("[mnemo] init: bootstrap import already completed, skipping");
    return;
  }

  const agents = resolveAgents(openclawRaw);
  if (agents.length === 0) {
    logger.info("[mnemo] init: no agents found in openclaw.json, marking completed");
    state.completed[stateKey] = {
      completedAt: new Date().toISOString(),
      uploadedFiles: 0,
      decision: "uploaded",
    };
    await saveState(statePath, state);
    return;
  }

  const consent = await askUserConsent(logger, agents.length, tenantID);
  if (!consent.answered) {
    logger.info("[mnemo] init: consent not provided, skipping bootstrap import for now");
    return;
  }
  if (!consent.accepted) {
    state.completed[stateKey] = {
      completedAt: new Date().toISOString(),
      uploadedFiles: 0,
      decision: "declined",
    };
    await saveState(statePath, state);
    logger.info("[mnemo] init: user declined history upload, skipping");
    return;
  }

  logger.info(`[mnemo] init: starting bootstrap import for ${agents.length} agent(s)`);

  const progress = createProgressReporter();

  const perAgentResults = await Promise.all(
    agents.map((agent) => importForAgent(logger, rootDir, apiUrl, tenantID, agent, progress)),
  );

  progress.finish();

  const failed = perAgentResults.some((r) => !r.ok);
  const uploadedFiles = perAgentResults.reduce((sum, r) => sum + r.uploadedFiles, 0);

  if (failed) {
    logger.error("[mnemo] init: bootstrap import incomplete; will retry next startup");
    return;
  }

  state.completed[stateKey] = {
    completedAt: new Date().toISOString(),
    uploadedFiles,
    decision: "uploaded",
  };
  await saveState(statePath, state);
  logger.info(`[mnemo] init: bootstrap import completed (uploaded ${uploadedFiles} file(s))`);
}

async function ensurePluginConfig(
  logger: Logger,
  openclawRaw: JsonObject,
  openclawJsonPath: string,
  plugin: PluginEntry,
): Promise<{ apiUrl: string; tenantID: string } | null> {
  let changed = false;

  let apiUrl = firstNonEmptyString(plugin.config.apiUrl);
  if (!apiUrl) {
    apiUrl = DEFAULT_API_URL;
    plugin.config.apiUrl = apiUrl;
    changed = true;
    logger.info(`[mnemo] init: apiUrl missing, defaulting to ${DEFAULT_API_URL}`);
  }

  let tenantID = firstNonEmptyString(plugin.config.tenantID);
  if (!tenantID) {
    try {
      tenantID = await autoProvisionTenant(apiUrl);
      plugin.config.tenantID = tenantID;
      changed = true;
      logger.info(`[mnemo] init: auto-provisioned tenantID=${tenantID}`);
    } catch (err) {
      logger.error(
        `[mnemo] init: auto-provision failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (changed) {
        try {
          await saveJsonFileAtomic(openclawJsonPath, openclawRaw);
        } catch (saveErr) {
          logger.error(
            `[mnemo] init: failed to persist partial config update: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`,
          );
        }
      }
      return null;
    }
  }

  if (changed) {
    await saveJsonFileAtomic(openclawJsonPath, openclawRaw);
    logger.info("[mnemo] init: updated openclaw.json plugin config");
  }

  return { apiUrl, tenantID };
}

async function autoProvisionTenant(apiUrl: string): Promise<string> {
  const response = await fetch(`${normalizeApiUrl(apiUrl)}/v1alpha1/mem9s`, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`provision failed (${response.status}): ${body}`);
  }
  const parsed = await response.json() as { id?: unknown };
  if (!parsed?.id || typeof parsed.id !== "string" || parsed.id.trim() === "") {
    throw new Error("provision response missing tenant id");
  }
  return parsed.id.trim();
}

async function importForAgent(
  logger: Logger,
  rootDir: string,
  apiUrl: string,
  tenantID: string,
  agent: AgentWorkspace,
  progress: ProgressReporter,
): Promise<{ ok: boolean; uploadedFiles: number }> {
  const workspaceAbs = path.resolve(rootDir, agent.workspace);
  const files = await listRecentAgentFiles(workspaceAbs);
  progress.addTotal(files.length);
  if (files.length === 0) {
    logger.info(`[mnemo] init: agent=${agent.agentID} no memory/session files found`);
    return { ok: true, uploadedFiles: 0 };
  }

  const results = await Promise.allSettled(
    files.map(async (file) => {
      await uploadImportFile(apiUrl, tenantID, agent.agentID, file);
      progress.tick(true, `${agent.agentID}/${file.fileName}`);
      logger.info(`[mnemo] init: uploaded agent=${agent.agentID} file=${file.fileName} type=${file.fileType}`);
      return file;
    }),
  );

  let uploaded = 0;
  let hadFailure = false;
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const file = files[i];
    if (r.status === "fulfilled") {
      uploaded += 1;
      continue;
    }
    hadFailure = true;
    progress.tick(false, `${agent.agentID}/${file.fileName}`);
    logger.error(
      `[mnemo] init: upload failed agent=${agent.agentID} file=${file.fileName} err=${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
    );
  }

  return { ok: !hadFailure, uploadedFiles: uploaded };
}

async function uploadImportFile(
  apiUrl: string,
  tenantID: string,
  agentID: string,
  file: UploadFile,
): Promise<void> {
  const payload = await readFile(file.absolutePath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(payload)], { type: "application/json" }), file.fileName);
  form.append("agent_id", agentID);
  form.append("file_type", file.fileType);
  if (file.fileType === "session" && file.sessionID) {
    form.append("session_id", file.sessionID);
  }

  const response = await fetch(`${normalizeApiUrl(apiUrl)}/v1alpha1/mem9s/${tenantID}/imports`, {
    method: "POST",
    headers: {
      "X-Mnemo-Agent-Id": agentID,
    },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`imports API failed (${response.status}): ${body}`);
  }
}

async function listRecentAgentFiles(workspaceAbs: string): Promise<UploadFile[]> {
  const candidates = new Map<string, UploadFile>();

  await tryAddFile(candidates, path.join(workspaceAbs, "memory.json"), "memory");
  await tryAddFile(candidates, path.join(workspaceAbs, "memories.json"), "memory");

  await addJsonFilesFromDir(candidates, path.join(workspaceAbs, "sessions"), "session");
  await addJsonFilesFromDir(candidates, path.join(workspaceAbs, "session"), "session");
  await addJsonFilesFromDir(candidates, path.join(workspaceAbs, "memories"), "memory");

  const all = Array.from(candidates.values()).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const memoryFiles = all.filter((f) => f.fileType === "memory").slice(0, MAX_MEMORY_FILES_PER_AGENT);
  const sessionFiles = all.filter((f) => f.fileType === "session").slice(0, MAX_SESSION_FILES_PER_AGENT);
  return [...memoryFiles, ...sessionFiles].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function addJsonFilesFromDir(
  out: Map<string, UploadFile>,
  dirPath: string,
  defaultType: "memory" | "session",
): Promise<void> {
  let entries: { name: string; isFile: () => boolean }[] = [];
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map(async (entry) => {
      await tryAddFile(out, path.join(dirPath, entry.name), defaultType);
    }));
}

async function tryAddFile(
  out: Map<string, UploadFile>,
  filePath: string,
  defaultType: "memory" | "session",
): Promise<void> {
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(filePath);
  } catch {
    return;
  }
  if (!s.isFile()) {
    return;
  }

  const fileName = path.basename(filePath);
  const type = inferFileType(filePath, defaultType);
  const sessionID = type === "session" ? inferSessionID(fileName) : undefined;
  out.set(filePath, {
    absolutePath: filePath,
    fileName,
    mtimeMs: s.mtimeMs,
    fileType: type,
    sessionID,
  });
}

function inferFileType(filePath: string, fallback: "memory" | "session"): "memory" | "session" {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/sessions/") || normalized.includes("/session/")) {
    return "session";
  }
  return fallback;
}

function inferSessionID(fileName: string): string {
  return fileName.replace(/\.json$/i, "");
}

function resolveMem9PluginEntry(raw: JsonObject): PluginEntry | null {
  const plugins = asObject(raw.plugins);
  const entries = asObject(plugins?.entries);
  if (!entries) {
    return null;
  }

  const preferredID = findPreferredPluginID(raw, entries);
  if (!preferredID) {
    return null;
  }

  const entry = asObject(entries[preferredID]);
  if (!entry) {
    return null;
  }
  if (entry.enabled === false) {
    return null;
  }
  let config = asObject(entry.config);
  if (!config) {
    config = {};
    entry.config = config;
  }
  return { id: preferredID, config };
}

function findPreferredPluginID(raw: JsonObject, entries: JsonObject): string | null {
  const plugins = asObject(raw.plugins);
  const slots = asObject(plugins?.slots);
  const memorySlot = typeof slots?.memory === "string" ? slots.memory : "";

  if (memorySlot && (memorySlot === "mem9" || memorySlot === "mnemo") && entries[memorySlot]) {
    return memorySlot;
  }
  if (entries.mem9) {
    return "mem9";
  }
  if (entries.mnemo) {
    return "mnemo";
  }
  return null;
}

function resolveAgents(raw: JsonObject): AgentWorkspace[] {
  const agentsObj = asObject(raw.agents);
  if (!agentsObj) {
    return [];
  }

  const agents: AgentWorkspace[] = [];
  for (const [agentID, value] of Object.entries(agentsObj)) {
    if (!agentID) {
      continue;
    }
    const obj = asObject(value);
    const workspace = firstNonEmptyString(obj?.workspace, obj?.workspaceDir) ?? "./";
    agents.push({ agentID, workspace });
  }
  return agents;
}

async function findOpenclawJson(startDir: string): Promise<string | null> {
  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, "openclaw.json");
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  }
}

async function readJsonFile(filePath: string): Promise<JsonObject | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return asObject(parsed);
  } catch {
    return null;
  }
}

async function loadState(statePath: string): Promise<InitState> {
  const parsed = await readJsonFile(statePath);
  if (!parsed) {
    return { version: INIT_STATE_VERSION, completed: {} };
  }
  const version = typeof parsed.version === "number" ? parsed.version : INIT_STATE_VERSION;
  const completedObj = asObject(parsed.completed) ?? {};

  const completed: InitState["completed"] = {};
  for (const [k, v] of Object.entries(completedObj)) {
    const item = asObject(v);
    const completedAt = typeof item?.completedAt === "string" ? item.completedAt : "";
    const uploadedFiles = typeof item?.uploadedFiles === "number" ? item.uploadedFiles : 0;
    const decision = item?.decision === "uploaded" || item?.decision === "declined"
      ? item.decision
      : undefined;
    if (!completedAt) {
      continue;
    }
    completed[k] = { completedAt, uploadedFiles, decision };
  }
  return { version, completed };
}

async function askUserConsent(
  logger: Logger,
  agentCount: number,
  tenantID: string,
): Promise<{ answered: boolean; accepted: boolean }> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    logger.info("[mnemo] init: no interactive terminal for consent prompt");
    return { answered: false, accepted: false };
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = `[mnemo] First-time setup detected for tenant ${tenantID}. Upload recent local memories/sessions from ${agentCount} agent(s)? (y/N): `;
  try {
    const answer = await Promise.race<string>([
      rl.question(prompt),
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("prompt timeout")), CONSENT_TIMEOUT_MS);
      }),
    ]);
    const normalized = answer.trim().toLowerCase();
    return { answered: true, accepted: normalized === "y" || normalized === "yes" };
  } catch {
    return { answered: false, accepted: false };
  } finally {
    rl.close();
  }
}

async function saveState(statePath: string, state: InitState): Promise<void> {
  const payload = JSON.stringify(state, null, 2);
  const tmpPath = `${statePath}.tmp`;
  await writeFile(tmpPath, payload, "utf8");
  await rename(tmpPath, statePath);
}

async function saveJsonFileAtomic(filePath: string, content: JsonObject): Promise<void> {
  const payload = JSON.stringify(content, null, 2);
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, payload, "utf8");
  await rename(tmpPath, filePath);
}

function asObject(v: unknown): JsonObject | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return null;
  }
  return v as JsonObject;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return null;
}

function normalizeApiUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function createProgressReporter(): ProgressReporter {
  if (!process.stdout.isTTY) {
    return {
      addTotal: () => {},
      tick: () => {},
      finish: () => {},
    };
  }

  let total = 0;
  let done = 0;
  let failed = 0;

  const render = (label?: string) => {
    const width = 24;
    const ratio = total > 0 ? Math.min(1, done / total) : 0;
    const filled = Math.round(width * ratio);
    const bar = `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
    const suffix = label ? ` ${label}` : "";
    process.stdout.write(`\r[mnemo] import [${bar}] ${done}/${total} failed=${failed}${suffix}`);
  };

  return {
    addTotal(n: number) {
      if (n <= 0) {
        return;
      }
      total += n;
      render();
    },
    tick(ok: boolean, label: string) {
      done += 1;
      if (!ok) {
        failed += 1;
      }
      render(label);
    },
    finish() {
      if (total > 0) {
        render();
        process.stdout.write("\n");
      }
    },
  };
}
