// @ts-check

import { buildMem9Url, mem9FetchJson, mem9Headers } from "./http.mjs";

const WARNING_PERCENT = 80;
const URGENT_PERCENT = 95;

/**
 * @typedef {{
 *   baseUrl: string,
 *   apiKey: string,
 *   agentId: string,
 *   defaultTimeoutMs: number,
 * }} RuntimeStateRuntime
 */

/**
 * @typedef {{
 *   providerActionCode?: string,
 *   severity?: string,
 *   type?: string,
 *   url?: string,
 * }} RuntimeRecommendedAction
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
function text(value) {
  return typeof value === "string" ? value.trim() : "";
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
 * @param {unknown} input
 * @returns {RuntimeRecommendedAction | null}
 */
function normalizeAction(input) {
  const action = isRecord(input) ? input : {};
  const providerActionCode = text(action.providerActionCode);
  const severity = text(action.severity);
  const type = text(action.type);
  const url = text(action.url);

  if (!providerActionCode && !severity && !type && !url) {
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
 * @param {RuntimeRecommendedAction | null | undefined} action
 * @returns {string}
 */
function actionInstruction(action) {
  const providerActionCode = text(action?.providerActionCode);
  const url = text(action?.url);

  if (!url) {
    return providerActionCode
      ? " Ask them to open the mem9 console to resolve the account or billing state."
      : "";
  }

  if (providerActionCode === "claimApiKey") {
    return ` Ask them to open this link to sign in or create a mem9 account and claim this API key: ${url}. Include the link exactly as written.`;
  }
  if (providerActionCode === "upgradePlan") {
    return ` Ask them to open this link to upgrade their mem9 plan and get more included usage: ${url}. Include the link exactly as written.`;
  }
  if (providerActionCode === "increaseSpendingLimit") {
    return ` Ask them to open this link to increase the mem9 spending limit or adjust billing settings: ${url}. Include the link exactly as written.`;
  }
  if (providerActionCode === "enableOnDemand") {
    return ` Ask them to open this link to enable billing or on-demand usage for mem9: ${url}. Include the link exactly as written.`;
  }
  return ` Ask them to open this mem9 link to resolve the account or billing state: ${url}. Include the link exactly as written.`;
}

/**
 * @param {Record<string, unknown>} budget
 * @returns {{percent: number | null, remaining: number | null, capacity: number | null}}
 */
function budgetNumbers(budget) {
  const usage = isRecord(budget.usage) ? budget.usage : {};
  const capacity = isRecord(budget.capacity) ? budget.capacity : {};
  const capacityValue = text(capacity.type) === "limited"
    ? numberValue(capacity.value)
    : null;

  return {
    percent: numberValue(usage.percent),
    remaining: numberValue(usage.remaining),
    capacity: capacityValue != null && capacityValue > 0 ? capacityValue : null,
  };
}

/**
 * @param {unknown} runtimeState
 * @returns {string}
 */
export function formatRuntimeStateNotice(runtimeState) {
  if (!isRecord(runtimeState)) {
    return "";
  }

  const action = normalizeAction(runtimeState.recommendedAction);
  /** @type {{priority: number, message: string, action?: RuntimeRecommendedAction | null}[]} */
  const candidates = [];
  const mem9ApiKey = isRecord(runtimeState.mem9ApiKey) ? runtimeState.mem9ApiKey : {};

  if (text(mem9ApiKey.status) === "inactive") {
    candidates.push({
      priority: 65,
      action,
      message: "Mem9 API key is inactive. In your reply, briefly tell the user to rerun mem9 setup or create a new mem9 API key before memory access can continue.",
    });
  }

  if (action && (text(action.severity) || text(action.url))) {
    candidates.push({
      priority: action.severity === "blocking" ? 50 : 20,
      action,
      message: "Mem9 has a runtime account action available. In your reply, briefly tell the user that mem9 needs account or billing attention.",
    });
  }

  const meters = Array.isArray(runtimeState.meters) ? runtimeState.meters : [];
  for (const rawMeter of meters) {
    if (!isRecord(rawMeter)) {
      continue;
    }

    const feature = meterLabel(text(rawMeter.meter));
    const gate = isRecord(rawMeter.quotaGateResult) ? rawMeter.quotaGateResult : {};
    const outcome = text(gate.outcome);
    const mode = text(gate.mode);

    if (outcome === "blocked") {
      candidates.push({
        priority: 60,
        action,
        message: `${feature} is blocked by runtime quota. In your reply, briefly tell the user that ${feature} needs attention before memory access can continue.`,
      });
    } else if (outcome === "rateLimited") {
      candidates.push({
        priority: 55,
        action,
        message: `${feature} has reached its temporary runtime rate limit. In your reply, briefly tell the user that ${feature} needs a retry later.`,
      });
    } else if (mode === "onDemand" || mode === "postQuota") {
      candidates.push({
        priority: 40,
        action,
        message: `${feature} is in constrained mode and using ${modeLabel(mode)}. In your reply, briefly tell the user that ${feature} is running in constrained mode.`,
      });
    }

    const budgets = Array.isArray(rawMeter.budgets) ? rawMeter.budgets : [];
    for (const rawBudget of budgets) {
      if (!isRecord(rawBudget)) {
        continue;
      }

      const label = budgetLabel(text(rawBudget.type));
      const state = text(rawBudget.state);
      const numbers = budgetNumbers(rawBudget);
      const absoluteUrgent = numbers.capacity != null
        && numbers.remaining != null
        && numbers.remaining <= Math.max(5, numbers.capacity * 0.02);

      if (state === "exhausted") {
        candidates.push({
          priority: 45,
          action,
          message: `${feature} has exhausted its ${label}. In your reply, briefly tell the user that ${feature} is in constrained mode.`,
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
          message: `${feature} ${usage}. In your reply, briefly tell the user that ${feature} is almost out of runtime quota.`,
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
          message: `${feature} ${usage}. In your reply, briefly tell the user that ${feature} is nearing its runtime quota.`,
        });
      }
    }
  }

  candidates.sort((left, right) => right.priority - left.priority);
  const selected = candidates[0];
  return selected
    ? `${selected.message}${actionInstruction(selected.action)}`
    : "";
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
export function buildRuntimeStateUrl(baseUrl) {
  return buildMem9Url(baseUrl, "v1alpha2/mem9s/runtime-state").toString();
}

/**
 * @param {{
 *   runtime: RuntimeStateRuntime,
 *   fetchState?: (url: string, options: {timeoutMs: number}) => Promise<unknown>,
 *   debug?: (stage: string, fields?: Record<string, string | number | boolean | null | undefined>) => void,
 * }} input
 * @returns {Promise<string>}
 */
export async function resolveRuntimeStateNotice(input) {
  const debug = input.debug ?? (() => {});
  if (!input.runtime.apiKey) {
    debug("runtime_state_skipped_missing_api_key");
    return "";
  }

  const fetchState = input.fetchState ?? ((url, options) =>
    mem9FetchJson(url, {
      method: "GET",
      headers: mem9Headers(input.runtime.apiKey, input.runtime.agentId),
      timeoutMs: options.timeoutMs,
    }));

  try {
    debug("runtime_state_request", {
      timeoutMs: input.runtime.defaultTimeoutMs,
    });
    const state = await fetchState(
      buildRuntimeStateUrl(input.runtime.baseUrl),
      { timeoutMs: input.runtime.defaultTimeoutMs },
    );
    const notice = formatRuntimeStateNotice(state);
    debug("runtime_state_response", {
      hasNotice: Boolean(notice),
    });
    return notice;
  } catch (error) {
    debug("runtime_state_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}
