// @ts-check

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { writeJsonAtomic } from "./config.mjs";
import { Mem9HttpError, buildMem9Url, mem9FetchJson, mem9Headers } from "./http.mjs";

const SCHEMA_VERSION = 1;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 50;
const WARNING_PERCENT = 80;
const URGENT_PERCENT = 95;

/**
 * @typedef {{
 *   providerActionCode?: string,
 *   severity?: string,
 *   type?: string,
 *   url?: string,
 * }} RuntimeRecommendedAction
 */

/**
 * @typedef {{
 *   status: number | null,
 *   code: string,
 *   message: string,
 *   meter: string,
 *   details: Record<string, unknown>,
 *   quotaGateReason: string,
 *   retryAfterSeconds: number | null,
 *   recommendedAction: RuntimeRecommendedAction | null,
 * }} RuntimeQuotaDenied
 */

/**
 * @typedef {{
 *   baseUrl: string,
 *   apiKey: string,
 *   defaultTimeoutMs?: number,
 * }} RuntimeStateTarget
 */

/**
 * @typedef {Record<string, { seenHashes: string[], updatedAt: string }>} NoticeSessionsMap
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizePositiveInteger(value) {
  const num = typeof value === "number" ? value : Number.NaN;
  if (!Number.isInteger(num) || num <= 0) {
    return null;
  }
  return num;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * @param {number} value
 * @returns {string}
 */
function compactNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function payloadFromUnknown(value) {
  if (value instanceof Mem9HttpError) {
    return value.data;
  }
  if (isRecord(value) && isRecord(value.data)) {
    return value.data;
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function statusFromUnknown(value) {
  if (value instanceof Mem9HttpError && typeof value.status === "number") {
    return value.status;
  }
  if (isRecord(value) && typeof value.status === "number") {
    return value.status;
  }
  return null;
}

/**
 * @param {unknown} input
 * @returns {RuntimeRecommendedAction | null}
 */
function normalizeRecommendedAction(input) {
  const current = isRecord(input) ? input : {};
  const providerActionCode = normalizeString(current.providerActionCode);
  const severity = normalizeString(current.severity);
  const type = normalizeString(current.type);
  const url = normalizeString(current.url);

  if (!type && !providerActionCode && !severity && !url) {
    return null;
  }

  return {
    ...(providerActionCode ? { providerActionCode } : {}),
    ...(severity ? { severity } : {}),
    ...(type ? { type } : {}),
    ...(url ? { url } : {}),
  };
}

/**
 * @param {Record<string, unknown>} runtimeQuota
 * @returns {string}
 */
function quotaGateReason(runtimeQuota) {
  const gate = isRecord(runtimeQuota.quotaGateResult) ? runtimeQuota.quotaGateResult : {};
  return normalizeString(gate.reason);
}

/**
 * @param {Record<string, unknown>} runtimeQuota
 * @returns {number | null}
 */
function extractRetryAfterSeconds(runtimeQuota) {
  const direct = normalizePositiveInteger(runtimeQuota.retryAfterSeconds);
  if (direct != null) {
    return direct;
  }

  const gate = isRecord(runtimeQuota.quotaGateResult) ? runtimeQuota.quotaGateResult : {};
  const postQuota = isRecord(gate.postQuotaRateLimit) ? gate.postQuotaRateLimit : {};
  return normalizePositiveInteger(postQuota.retryAfterSeconds);
}

/**
 * @param {RuntimeQuotaDenied} denied
 * @returns {boolean}
 */
function isPostQuotaRateLimited(denied) {
  return denied.status === 429 || denied.quotaGateReason === "postQuotaRateLimitExceeded";
}

/**
 * @param {RuntimeQuotaDenied} denied
 * @returns {string}
 */
function quotaReason(denied) {
  if (isPostQuotaRateLimited(denied)) {
    return "this API key has reached the temporary request limit for this memory feature";
  }

  const providerActionCode = normalizeString(denied.recommendedAction?.providerActionCode);
  switch (providerActionCode) {
    case "claimApiKey":
      return "the included usage quota for this API key has been used up";
    case "increaseSpendingLimit":
      return "the configured spending limit would be exceeded";
    case "enableOnDemand":
      return "the included usage quota has been used up and on-demand usage is not enabled";
    case "upgradePlan":
      return "the included usage quota for this mem9 account has been used up";
    case "resolveAccountState":
      return "the current account or billing state blocks runtime memory access";
    default:
      return "the runtime quota check blocked this request";
  }
}

/**
 * @param {RuntimeQuotaDenied} denied
 * @param {string} operation
 * @returns {{ headline: string, userState: string }}
 */
function quotaNoticeSubject(denied, operation) {
  const meter = normalizeString(denied.meter);
  if (meter === "memory_write_requests") {
    return {
      headline: "Mem9 memory saving is temporarily unavailable",
      userState: "mem9 cannot save new memories right now",
    };
  }
  if (meter === "memory_recall_requests") {
    return {
      headline: "Mem9 recall is temporarily unavailable",
      userState: "mem9 cannot recall memories right now",
    };
  }

  const operationText = normalizeString(operation).toLowerCase();
  if (/\b(ingest|save|store|write)\b/.test(operationText)) {
    return {
      headline: "Mem9 memory saving is temporarily unavailable",
      userState: "mem9 cannot save new memories right now",
    };
  }
  if (/\b(recall|search)\b/.test(operationText)) {
    return {
      headline: "Mem9 recall is temporarily unavailable",
      userState: "mem9 cannot recall memories right now",
    };
  }

  return {
    headline: "Mem9 memory is temporarily unavailable",
    userState: "mem9 cannot complete the memory request right now",
  };
}

/**
 * @param {RuntimeRecommendedAction | null | undefined} action
 * @param {boolean} rateLimited
 * @returns {string}
 */
function formatActionGuidance(action, rateLimited) {
  const providerActionCode = normalizeString(action?.providerActionCode);
  const actionUrl = normalizeString(action?.url);

  if (!actionUrl) {
    if (rateLimited) {
      return "Tell them that the quota/rate-limit check blocked this request and to retry later or open the mem9 console to review account and billing settings.";
    }
    if (!providerActionCode && !rateLimited) {
      return "";
    }
    return "Ask them to open the mem9 console to resolve the account or billing state.";
  }

  switch (providerActionCode) {
    case "claimApiKey":
      return `Ask them to open this link to sign in or create a mem9 account and claim this API key: ${actionUrl}. After claiming the key, they can upgrade their plan or set up billing to get more usage. Include the link exactly as written.`;
    case "upgradePlan":
      return `Ask them to open this link to upgrade their mem9 plan and get more included usage: ${actionUrl}. Include the link exactly as written.`;
    case "increaseSpendingLimit":
      return `Ask them to open this link to increase the mem9 spending limit or adjust billing settings: ${actionUrl}. Include the link exactly as written.`;
    case "enableOnDemand":
      return `Ask them to open this link to enable billing or on-demand usage for mem9: ${actionUrl}. Include the link exactly as written.`;
    case "resolveAccountState":
    default:
      return `Ask them to open this mem9 link to resolve the account or billing state: ${actionUrl}. Include the link exactly as written.`;
  }
}

/**
 * Parses a mem9 HTTP error or JSON payload into a structured runtime quota denial.
 *
 * @param {unknown} error
 * @returns {RuntimeQuotaDenied | null}
 */
export function parseRuntimeQuotaDenied(error) {
  const payload = payloadFromUnknown(error);
  if (!isRecord(payload)) {
    return null;
  }

  const details = isRecord(payload.details) ? payload.details : {};
  if (normalizeString(details.errorCategory) !== "runtime_quota_denied") {
    return null;
  }

  const runtimeQuota = isRecord(details.runtimeQuota) ? details.runtimeQuota : {};
  const message = normalizeString(payload.error) || "Runtime usage quota denied.";

  return {
    status: statusFromUnknown(error),
    code: "runtime_quota_denied",
    message,
    meter: normalizeString(runtimeQuota.meter),
    details,
    quotaGateReason: quotaGateReason(runtimeQuota),
    retryAfterSeconds: extractRetryAfterSeconds(runtimeQuota),
    recommendedAction: normalizeRecommendedAction(runtimeQuota.recommendedAction),
  };
}

/**
 * Formats a user-facing notice string for a runtime quota denial error.
 *
 * @param {unknown} error
 * @param {string} [operation]
 * @returns {string}
 */
export function formatRuntimeQuotaNotice(error, operation = "mem9 request") {
  const denied = parseRuntimeQuotaDenied(error);
  if (!denied) {
    return "";
  }

  const subject = quotaNoticeSubject(denied, operation);
  const guidance =
    formatActionGuidance(denied.recommendedAction, isPostQuotaRateLimited(denied))
    || "Ask them to open the mem9 console to resolve the account or billing state.";
  return `${subject.headline} because ${quotaReason(denied)}. In your reply, briefly tell the user that ${subject.userState}. ${guidance}`;
}

/**
 * @param {string} meter
 * @returns {string}
 */
function meterLabel(meter) {
  if (meter === "memory_recall_requests") {
    return "mem9 recall";
  }
  if (meter === "memory_write_requests") {
    return "mem9 memory saving";
  }
  return "mem9 memory";
}

/**
 * @param {string} budgetType
 * @returns {string}
 */
function budgetLabel(budgetType) {
  if (budgetType === "includedQuota") {
    return "included quota";
  }
  if (budgetType === "spendingLimit") {
    return "spending limit";
  }
  if (budgetType === "credits") {
    return "credit balance";
  }
  return "runtime quota";
}

/**
 * @param {string} mode
 * @returns {string}
 */
function modeLabel(mode) {
  if (mode === "onDemand") {
    return "on-demand usage";
  }
  if (mode === "postQuota") {
    return "the post-quota request lane";
  }
  return "provider-managed runtime";
}

/**
 * @param {string} detail
 * @returns {string}
 */
function warningDetailMessage(detail) {
  return `${detail}. In your reply, include this exact mem9 warning detail: ${detail}.`;
}

/**
 * @param {Record<string, unknown>} budget
 * @returns {{ percent: number | null, remaining: number | null, capacity: number | null }}
 */
function budgetNumbers(budget) {
  const usage = isRecord(budget.usage) ? budget.usage : {};
  const capacity = isRecord(budget.capacity) ? budget.capacity : {};
  const capacityValue = normalizeString(capacity.type) === "limited"
    ? numberValue(capacity.value)
    : null;

  return {
    percent: numberValue(usage.percent),
    remaining: numberValue(usage.remaining),
    capacity: capacityValue != null && capacityValue > 0 ? capacityValue : null,
  };
}

/**
 * Formats the highest-priority warning/action notice from `/runtime-state`.
 *
 * @param {unknown} runtimeState
 * @returns {string}
 */
export function formatRuntimeStateNotice(runtimeState) {
  if (!isRecord(runtimeState)) {
    return "";
  }

  const action = normalizeRecommendedAction(runtimeState.recommendedAction);
  /** @type {{ priority: number, message: string, action: RuntimeRecommendedAction | null }[]} */
  const candidates = [];
  const mem9ApiKey = isRecord(runtimeState.mem9ApiKey) ? runtimeState.mem9ApiKey : {};

  if (normalizeString(mem9ApiKey.status) === "inactive") {
    candidates.push({
      priority: 65,
      action,
      message: warningDetailMessage(
        "Mem9 API key is inactive; rerun mem9 setup or create a new mem9 API key before memory access can continue",
      ),
    });
  }

  if (action && (normalizeString(action.severity) || normalizeString(action.url))) {
    candidates.push({
      priority: action.severity === "blocking" ? 50 : 20,
      action,
      message: warningDetailMessage("Mem9 needs account or billing attention"),
    });
  }

  const meters = Array.isArray(runtimeState.meters) ? runtimeState.meters : [];
  for (const rawMeter of meters) {
    if (!isRecord(rawMeter)) {
      continue;
    }

    const feature = meterLabel(normalizeString(rawMeter.meter));
    const gate = isRecord(rawMeter.quotaGateResult) ? rawMeter.quotaGateResult : {};
    const outcome = normalizeString(gate.outcome);
    const mode = normalizeString(gate.mode);

    if (outcome === "blocked") {
      candidates.push({
        priority: 60,
        action,
        message: warningDetailMessage(
          `${feature} is blocked by runtime quota and needs attention before memory access can continue`,
        ),
      });
    } else if (outcome === "rateLimited") {
      candidates.push({
        priority: 55,
        action,
        message: warningDetailMessage(
          `${feature} has reached its temporary runtime rate limit and needs a retry later`,
        ),
      });
    } else if (mode === "onDemand" || mode === "postQuota") {
      candidates.push({
        priority: 40,
        action,
        message: warningDetailMessage(
          `${feature} is in constrained mode and using ${modeLabel(mode)}`,
        ),
      });
    }

    const budgets = Array.isArray(rawMeter.budgets) ? rawMeter.budgets : [];
    for (const rawBudget of budgets) {
      if (!isRecord(rawBudget)) {
        continue;
      }

      const label = budgetLabel(normalizeString(rawBudget.type));
      const state = normalizeString(rawBudget.state);
      const numbers = budgetNumbers(rawBudget);
      const absoluteUrgent =
        numbers.capacity != null
        && numbers.remaining != null
        && numbers.remaining <= Math.max(5, numbers.capacity * 0.02);

      if (state === "exhausted") {
        candidates.push({
          priority: 45,
          action,
          message: warningDetailMessage(
            `${feature} has exhausted its ${label} and is in constrained mode`,
          ),
        });
      } else if (
        (numbers.percent != null && numbers.percent >= URGENT_PERCENT)
        || absoluteUrgent
      ) {
        const usage = numbers.remaining != null
          ? `has ${compactNumber(numbers.remaining)} units remaining in its ${label}`
          : `is at ${compactNumber(numbers.percent ?? URGENT_PERCENT)}% of its ${label}`;
        candidates.push({
          priority: 35,
          action,
          message: warningDetailMessage(
            `${feature} ${usage} and is almost out of runtime quota`,
          ),
        });
      } else if (
        state === "warning"
        || (numbers.percent != null && numbers.percent >= WARNING_PERCENT)
      ) {
        const usage = numbers.percent != null
          ? `is at ${compactNumber(numbers.percent)}% of its ${label}`
          : `is nearing its ${label}`;
        candidates.push({
          priority: 25,
          action,
          message: warningDetailMessage(`${feature} ${usage} and is nearing its runtime quota`),
        });
      }
    }
  }

  candidates.sort((left, right) => right.priority - left.priority);
  const selected = candidates[0];
  if (!selected) {
    return "";
  }

  const guidance = formatActionGuidance(selected.action, false);
  return guidance ? `${selected.message} ${guidance}` : selected.message;
}

/**
 * Builds the public `/runtime-state` endpoint URL.
 *
 * @param {string} baseUrl
 * @returns {string}
 */
export function buildRuntimeStateUrl(baseUrl) {
  return buildMem9Url(baseUrl, "v1alpha2/mem9s/runtime-state").toString();
}

/**
 * Fail-soft fetches `/runtime-state` and formats any active notice.
 *
 * @param {{
 *   runtime?: RuntimeStateTarget | null,
 *   fetchState?: (url: string, options: { timeoutMs: number }) => Promise<unknown>,
 *   debug?: (stage: string, fields?: Record<string, string | number | boolean | null | undefined>) => void,
 * }} input
 * @returns {Promise<string>}
 */
export async function resolveRuntimeStateNotice({
  runtime,
  fetchState,
  debug = () => {},
} = {}) {
  if (!runtime?.apiKey) {
    debug("runtime_state_skipped_missing_api_key");
    return "";
  }

  const timeoutMs =
    typeof runtime.defaultTimeoutMs === "number"
    && Number.isFinite(runtime.defaultTimeoutMs)
    && runtime.defaultTimeoutMs > 0
      ? Math.floor(runtime.defaultTimeoutMs)
      : 8_000;

  const fetcher = fetchState ?? ((url, options) =>
    mem9FetchJson(url, {
      method: "GET",
      headers: mem9Headers(runtime.apiKey),
      timeoutMs: options.timeoutMs,
    }));

  try {
    debug("runtime_state_request", { timeoutMs });
    const state = await fetcher(buildRuntimeStateUrl(runtime.baseUrl), { timeoutMs });
    const notice = formatRuntimeStateNotice(state);
    debug("runtime_state_response", { hasNotice: Boolean(notice) });
    return notice;
  } catch (error) {
    debug("runtime_state_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

/**
 * Formats an error into an MCP tool error payload.
 *
 * @param {unknown} error
 * @returns {Record<string, unknown>}
 */
export function toolErrorPayload(error) {
  const denied = parseRuntimeQuotaDenied(error);
  if (denied) {
    const actionUrl = normalizeString(denied.recommendedAction?.url);
    return {
      ok: false,
      error: denied.message,
      ...(denied.status != null ? { status_code: denied.status } : {}),
      code: denied.code,
      quota: {
        code: denied.code,
        message: denied.message,
        ...(denied.retryAfterSeconds != null ? { retryAfterSeconds: denied.retryAfterSeconds } : {}),
        ...(denied.recommendedAction ? { recommendedAction: denied.recommendedAction } : {}),
      },
      ...(actionUrl ? { action_url: actionUrl } : {}),
    };
  }

  if (error instanceof Mem9HttpError && typeof error.status === "number") {
    return {
      ok: false,
      error: error.message,
      status_code: error.status,
    };
  }

  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Computes the SHA-256 deduplication key for a notice message.
 *
 * @param {string} message
 * @returns {string}
 */
export function noticeHash(message) {
  return `sha256:${createHash("sha256").update(message).digest("hex")}`;
}

/**
 * @param {string} filePath
 * @returns {{ schemaVersion: number, sessions: NoticeSessionsMap }}
 */
function readNoticeState(filePath) {
  if (!existsSync(filePath)) {
    return { schemaVersion: SCHEMA_VERSION, sessions: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const rawSessions = isRecord(parsed?.sessions) ? parsed.sessions : {};
    /** @type {NoticeSessionsMap} */
    const sessions = {};

    for (const [sessionId, rawSession] of Object.entries(rawSessions)) {
      if (!isRecord(rawSession)) {
        continue;
      }
      const rawHashes = Array.isArray(rawSession.seenHashes)
        ? rawSession.seenHashes
        : Array.isArray(rawSession.seenMessages)
          ? rawSession.seenMessages
          : [];
      sessions[sessionId] = {
        seenHashes: rawHashes.filter((item) => typeof item === "string"),
        updatedAt: typeof rawSession.updatedAt === "string" ? rawSession.updatedAt : "",
      };
    }

    return { schemaVersion: SCHEMA_VERSION, sessions };
  } catch {
    return { schemaVersion: SCHEMA_VERSION, sessions: {} };
  }
}

/**
 * @param {NoticeSessionsMap} sessions
 * @param {string} currentSessionId
 * @param {Date} now
 * @returns {NoticeSessionsMap}
 */
function pruneNoticeSessions(sessions, currentSessionId, now) {
  const cutoff = now.getTime() - RETENTION_MS;
  /** @type {Array<{ id: string, session: { seenHashes: string[], updatedAt: string }, ts: number, order: number }>} */
  const entries = [];
  let order = 0;

  for (const [id, session] of Object.entries(sessions)) {
    const updated = Date.parse(session.updatedAt);
    if (!Number.isFinite(updated) || updated < cutoff) {
      continue;
    }
    entries.push({ id, session, ts: updated, order });
    order += 1;
  }

  entries.sort((left, right) => {
    if (right.ts !== left.ts) {
      return right.ts - left.ts;
    }
    if (left.id === currentSessionId) {
      return -1;
    }
    if (right.id === currentSessionId) {
      return 1;
    }
    return right.order - left.order;
  });

  /** @type {NoticeSessionsMap} */
  const pruned = {};
  for (const entry of entries.slice(0, MAX_SESSIONS)) {
    pruned[entry.id] = entry.session;
  }
  return pruned;
}

/**
 * Claims a runtime notice for `sessionId` using per-session SHA-256 deduplication
 * persisted to `stateFile` (retaining at most 50 recent sessions).
 *
 * @param {{
 *   stateFile?: string,
 *   sessionId?: string,
 *   sessionID?: string,
 *   message?: string,
 *   now?: Date,
 * }} input
 * @returns {boolean}
 */
export function claimRuntimeNotice(input) {
  const message = normalizeString(input?.message);
  if (!message) {
    return false;
  }

  const sessionId = normalizeString(input?.sessionId ?? input?.sessionID);
  const stateFile = normalizeString(input?.stateFile);
  if (!sessionId || !stateFile) {
    return true;
  }

  const digest = noticeHash(message);

  try {
    const now = input?.now ?? new Date();
    const state = readNoticeState(stateFile);
    const existing = state.sessions[sessionId] ?? { seenHashes: [], updatedAt: "" };
    const alreadySeen = existing.seenHashes.includes(digest);

    if (!alreadySeen) {
      existing.seenHashes.push(digest);
    }
    existing.updatedAt = now.toISOString();

    // Re-insert so insertion order reflects recency for same-ms tie-breaking.
    delete state.sessions[sessionId];
    state.sessions[sessionId] = existing;
    state.sessions = pruneNoticeSessions(state.sessions, sessionId, now);

    writeJsonAtomic(stateFile, state, { mode: 0o600 });
    return !alreadySeen;
  } catch {
    return true;
  }
}
