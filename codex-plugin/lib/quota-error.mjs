// @ts-nocheck

import { Mem9HttpError } from "./http.mjs";

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveInteger(value) {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }
  return number;
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

function normalizeRecommendedAction(runtimeQuota) {
  const current = isRecord(runtimeQuota.recommendedAction)
    ? runtimeQuota.recommendedAction
    : {};
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

function quotaGateReason(runtimeQuota) {
  const quotaGateResult = isRecord(runtimeQuota.quotaGateResult)
    ? runtimeQuota.quotaGateResult
    : {};
  return normalizeString(quotaGateResult.reason);
}

function retryAfterSeconds(runtimeQuota) {
  const direct = normalizePositiveInteger(runtimeQuota.retryAfterSeconds);
  if (direct != null) {
    return direct;
  }

  const quotaGateResult = isRecord(runtimeQuota.quotaGateResult)
    ? runtimeQuota.quotaGateResult
    : {};
  const postQuotaRateLimit = isRecord(quotaGateResult.postQuotaRateLimit)
    ? quotaGateResult.postQuotaRateLimit
    : {};
  return normalizePositiveInteger(postQuotaRateLimit.retryAfterSeconds);
}

function isPostQuotaRateLimited(denied) {
  return denied.status === 429 ||
    denied.quotaGateReason === "postQuotaRateLimitExceeded";
}

function quotaReason(denied) {
  if (isPostQuotaRateLimited(denied)) {
    return "this API key has reached the temporary request limit for this memory feature";
  }
  const providerActionCode = normalizeString(denied.recommendedAction?.providerActionCode);
  if (providerActionCode === "claimApiKey") {
    return "the included usage quota for this API key has been used up";
  }
  if (providerActionCode === "increaseSpendingLimit") {
    return "the configured spending limit would be exceeded";
  }
  if (providerActionCode === "enableOnDemand") {
    return "the included usage quota has been used up and on-demand usage is not enabled";
  }
  if (providerActionCode === "upgradePlan") {
    return "the included usage quota for this mem9 account has been used up";
  }
  if (providerActionCode === "resolveAccountState") {
    return "the current account or billing state blocks runtime memory access";
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

function actionUrlForDenied(denied) {
  return normalizeString(denied.recommendedAction?.url);
}

function actionInstruction(denied) {
  const action = denied.recommendedAction;
  const providerActionCode = normalizeString(action?.providerActionCode);
  const actionUrl = actionUrlForDenied(denied);
  if (!actionUrl) {
    if (isPostQuotaRateLimited(denied)) {
      return "Tell them that the quota/rate-limit check blocked this request and to retry later or open the mem9 console to review account and billing settings.";
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
  if (normalizeString(details.errorCategory) !== "runtime_quota_denied") {
    return null;
  }
  const runtimeQuota = isRecord(details.runtimeQuota) ? details.runtimeQuota : {};

  const message = normalizeString(payload.error) || "Runtime usage quota denied.";
  return {
    status: statusFromUnknown(value),
    code: "runtime_quota_denied",
    message,
    meter: normalizeString(runtimeQuota.meter),
    details,
    quotaGateReason: quotaGateReason(runtimeQuota),
    retryAfterSeconds: retryAfterSeconds(runtimeQuota),
    recommendedAction: normalizeRecommendedAction(runtimeQuota),
  };
}

export function runtimeQuotaDeniedSummary(value) {
  const denied = parseRuntimeQuotaDenied(value);
  if (!denied) {
    return null;
  }
  const actionUrl = actionUrlForDenied(denied);

  return {
    status: "quota_denied",
    code: denied.code,
    message: denied.message,
    ...(denied.retryAfterSeconds != null ? { retryAfterSeconds: denied.retryAfterSeconds } : {}),
    ...(denied.recommendedAction ? { recommendedAction: denied.recommendedAction } : {}),
    ...(actionUrl ? { actionUrl } : {}),
  };
}

export function formatRuntimeQuotaNotice(value, operation = "mem9 request") {
  const denied = parseRuntimeQuotaDenied(value);
  if (!denied) {
    return "";
  }

  const subject = quotaNoticeSubject(denied, operation);
  return `${subject.headline} because ${quotaReason(denied)}. In your reply, briefly tell the user that ${subject.userState}. ${actionInstruction(denied)}`;
}
