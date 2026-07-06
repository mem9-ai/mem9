#!/usr/bin/env node
// quota-error.mjs — Format mem9 runtime quota denial payloads for hooks.

import { readFileSync } from "node:fs";

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

function normalizeStatus(value) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 100 || number > 599) {
    return null;
  }
  return number;
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

function isPostQuotaRateLimited(quotaDenied) {
  return quotaDenied.status === 429 ||
    quotaDenied.quotaGateReason === "postQuotaRateLimitExceeded";
}

function quotaReason(quotaDenied) {
  if (isPostQuotaRateLimited(quotaDenied)) {
    return "this API key has reached the temporary request limit for this memory feature";
  }
  if (quotaDenied.providerActionCode === "claimApiKey") {
    return "the included usage quota for this API key has been used up";
  }
  if (quotaDenied.providerActionCode === "increaseSpendingLimit") {
    return "the configured spending limit would be exceeded";
  }
  if (quotaDenied.providerActionCode === "enableOnDemand") {
    return "the included usage quota has been used up and on-demand usage is not enabled";
  }
  if (quotaDenied.providerActionCode === "upgradePlan") {
    return "the included usage quota for this mem9 account has been used up";
  }
  if (quotaDenied.providerActionCode === "resolveAccountState") {
    return "the current account or billing state blocks runtime memory access";
  }
  return "the runtime quota check blocked this request";
}

function quotaNoticeSubject(quotaDenied, operation) {
  if (quotaDenied.meter === "memory_write_requests") {
    return {
      headline: "Mem9 memory saving is temporarily unavailable",
      userState: "mem9 cannot save new memories right now",
    };
  }
  if (quotaDenied.meter === "memory_recall_requests") {
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

function actionInstruction(quotaDenied) {
  if (!quotaDenied.actionUrl) {
    if (isPostQuotaRateLimited(quotaDenied)) {
      return "Tell them that the quota/rate-limit check blocked this request and to retry later or open the mem9 console to review account and billing settings.";
    }
    return "Ask them to open the mem9 console to resolve the account or billing state.";
  }

  switch (quotaDenied.providerActionCode) {
    case "claimApiKey":
      return `Ask them to open this link to sign in or create a mem9 account and claim this API key: ${quotaDenied.actionUrl}. After claiming the key, they can upgrade their plan or set up billing to get more usage. Include the link exactly as written.`;
    case "upgradePlan":
      return `Ask them to open this link to upgrade their mem9 plan and get more included usage: ${quotaDenied.actionUrl}. Include the link exactly as written.`;
    case "increaseSpendingLimit":
      return `Ask them to open this link to increase the mem9 spending limit or adjust billing settings: ${quotaDenied.actionUrl}. Include the link exactly as written.`;
    case "enableOnDemand":
      return `Ask them to open this link to enable billing or on-demand usage for mem9: ${quotaDenied.actionUrl}. Include the link exactly as written.`;
    case "resolveAccountState":
      return `Ask them to open this mem9 link to resolve the account or billing state: ${quotaDenied.actionUrl}. Include the link exactly as written.`;
    default:
      return `Ask them to open this mem9 link to resolve the account or billing state: ${quotaDenied.actionUrl}. Include the link exactly as written.`;
  }
}

function parseQuotaDenied(payload, status) {
  if (!isRecord(payload)) {
    return null;
  }

  const details = isRecord(payload.details) ? payload.details : {};
  if (normalizeString(details.errorCategory) !== "runtime_quota_denied") {
    return null;
  }
  const runtimeQuota = isRecord(details.runtimeQuota) ? details.runtimeQuota : {};

  const recommendedAction = isRecord(runtimeQuota.recommendedAction)
    ? runtimeQuota.recommendedAction
    : {};
  const providerActionCode = normalizeString(recommendedAction.providerActionCode);
  const actionUrl = normalizeString(recommendedAction.url);
  return {
    status,
    code: "runtime_quota_denied",
    message: normalizeString(payload.error) || "Runtime usage quota denied.",
    meter: normalizeString(runtimeQuota.meter),
    quotaGateReason: quotaGateReason(runtimeQuota),
    retryAfterSeconds: retryAfterSeconds(runtimeQuota),
    providerActionCode,
    actionUrl,
  };
}

function readPayload() {
  const raw = readFileSync(0, "utf8");
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const command = process.argv[2] || "notice";
const operation = process.argv[3] || "mem9 request";
const status = normalizeStatus(process.argv[4]);
const quotaDenied = parseQuotaDenied(readPayload(), status);

if (!quotaDenied) {
  process.exit(1);
}

if (command === "code") {
  process.stdout.write(quotaDenied.code);
  process.exit(0);
}

const subject = quotaNoticeSubject(quotaDenied, operation);
process.stdout.write(`${subject.headline} because ${quotaReason(quotaDenied)}. In your reply, briefly tell the user that ${subject.userState}. ${actionInstruction(quotaDenied)}`);
