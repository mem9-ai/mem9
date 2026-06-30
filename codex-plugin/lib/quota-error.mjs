// @ts-nocheck

import { Mem9HttpError } from "./http.mjs";

const QUOTA_CODES = new Set([
  "quota_exhausted",
  "spending_limit_exceeded",
  "runtime_quota_denied",
]);

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function payloadFromUnknown(value) {
  if (value instanceof Mem9HttpError) {
    return value.data;
  }

  if (isRecord(value) && isRecord(value.data)) {
    return value.data;
  }

  return value;
}

function statusFromUnknown(value) {
  if (value instanceof Mem9HttpError && typeof value.status === "number") {
    return value.status;
  }

  if (isRecord(value) && typeof value.status === "number") {
    return value.status;
  }

  return null;
}

function normalizeRecommendedAction(details) {
  const current = isRecord(details.recommendedAction)
    ? details.recommendedAction
    : {};
  const type = normalizeString(current.type ?? details.upgradeAction);
  const bindingState = normalizeString(current.bindingState ?? details.bindingState);
  const url = normalizeString(current.url ?? details.upgradeUrl);

  if (!type && !bindingState && !url) {
    return null;
  }

  return {
    ...(bindingState ? { bindingState } : {}),
    ...(type ? { type } : {}),
    ...(url ? { url } : {}),
  };
}

function actionLabel(type) {
  switch (type) {
    case "claimApiKey":
      return "Claim this API key";
    case "upgradePlan":
      return "Upgrade your plan";
    case "increaseSpendingLimit":
      return "Increase your spending limit";
    case "enableOnDemand":
      return "Enable on-demand usage";
    case "resolveAccountState":
      return "Resolve account state";
    default:
      return "Open mem9 console";
  }
}

function sentence(message) {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

export function parseRuntimeQuotaDenied(value) {
  const payload = payloadFromUnknown(value);
  if (!isRecord(payload)) {
    return null;
  }

  const details = isRecord(payload.details) ? payload.details : {};
  const code = normalizeString(payload.code);
  const mem9Code = normalizeString(details.mem9Code ?? details.mem9_code ?? payload.mem9_code);
  if (mem9Code !== "runtime_quota_denied" && !QUOTA_CODES.has(code)) {
    return null;
  }

  const message = normalizeString(payload.message) || "runtime usage quota denied";
  return {
    status: statusFromUnknown(value),
    code: code || "runtime_quota_denied",
    message,
    details,
    recommendedAction: normalizeRecommendedAction(details),
  };
}

export function runtimeQuotaDeniedSummary(value) {
  const denied = parseRuntimeQuotaDenied(value);
  if (!denied) {
    return null;
  }

  return {
    status: "quota_denied",
    code: denied.code,
    message: denied.message,
    ...(denied.recommendedAction ? { recommendedAction: denied.recommendedAction } : {}),
  };
}

export function formatRuntimeQuotaNotice(value, operation = "mem9 request") {
  const denied = parseRuntimeQuotaDenied(value);
  if (!denied) {
    return "";
  }

  const action = denied.recommendedAction;
  const actionUrl = normalizeString(action?.url);
  const actionText = actionUrl
    ? ` ${actionLabel(normalizeString(action?.type))}: ${actionUrl}`
    : "";
  return `[mem9] ${operation}: ${sentence(denied.message)}${actionText}`;
}
