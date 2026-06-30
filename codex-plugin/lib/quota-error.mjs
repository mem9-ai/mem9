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

function quotaReason(denied) {
  const actionType = normalizeString(denied.recommendedAction?.type);
  if (actionType === "claimApiKey") {
    return "the included usage quota for this API key has been used up";
  }
  if (actionType === "increaseSpendingLimit" || denied.code === "spending_limit_exceeded") {
    return "the configured spending limit would be exceeded";
  }
  if (actionType === "enableOnDemand") {
    return "the included usage quota has been used up and on-demand usage is not enabled";
  }
  if (actionType === "upgradePlan" || denied.code === "quota_exhausted") {
    return "the included usage quota for this mem9 account has been used up";
  }
  return "the runtime quota check blocked this request";
}

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

function actionInstruction(action) {
  const actionType = normalizeString(action?.type);
  const actionUrl = normalizeString(action?.url);
  if (!actionUrl) {
    return "Ask them to open the mem9 console to resolve the account or billing state.";
  }

  switch (actionType) {
    case "claimApiKey":
      return `Ask them to open this link to sign in or create a mem9 account and claim this API key: ${actionUrl}. After claiming the key, they can upgrade their plan or set up billing to get more usage. Include the link exactly as written.`;
    case "upgradePlan":
      return `Ask them to open this link to upgrade their mem9 plan and get more included usage: ${actionUrl}. Include the link exactly as written.`;
    case "increaseSpendingLimit":
      return `Ask them to open this link to increase the mem9 spending limit or adjust billing settings: ${actionUrl}. Include the link exactly as written.`;
    case "enableOnDemand":
      return `Ask them to open this link to enable billing or on-demand usage for mem9: ${actionUrl}. Include the link exactly as written.`;
    case "resolveAccountState":
      return `Ask them to open this mem9 link to resolve the account or billing state: ${actionUrl}. Include the link exactly as written.`;
    default:
      return `Ask them to open this mem9 link to resolve the account or billing state: ${actionUrl}. Include the link exactly as written.`;
  }
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
    meter: normalizeString(details.meter),
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

  const subject = quotaNoticeSubject(denied, operation);
  return `${subject.headline} because ${quotaReason(denied)}. In your reply, briefly tell the user that ${subject.userState}. ${actionInstruction(denied.recommendedAction)}`;
}
