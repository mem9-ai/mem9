#!/usr/bin/env node
// quota-error.mjs — Format mem9 runtime quota denial payloads for hooks.

import { readFileSync } from "node:fs";

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

function quotaReason(quotaDenied) {
  if (quotaDenied.actionType === "claimApiKey") {
    return "the included usage quota for this API key has been used up";
  }
  if (quotaDenied.actionType === "increaseSpendingLimit" || quotaDenied.code === "spending_limit_exceeded") {
    return "the configured spending limit would be exceeded";
  }
  if (quotaDenied.actionType === "enableOnDemand") {
    return "the included usage quota has been used up and on-demand usage is not enabled";
  }
  if (quotaDenied.actionType === "upgradePlan" || quotaDenied.code === "quota_exhausted") {
    return "the included usage quota for this mem9 account has been used up";
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
    return "Ask them to open the mem9 console to resolve the account or billing state.";
  }

  switch (quotaDenied.actionType) {
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

function parseQuotaDenied(payload) {
  if (!isRecord(payload)) {
    return null;
  }

  const details = isRecord(payload.details) ? payload.details : {};
  const code = normalizeString(payload.code);
  const mem9Code = normalizeString(details.mem9Code ?? details.mem9_code ?? payload.mem9_code);
  if (mem9Code !== "runtime_quota_denied" && !QUOTA_CODES.has(code)) {
    return null;
  }

  const recommendedAction = isRecord(details.recommendedAction)
    ? details.recommendedAction
    : {};
  const actionType = normalizeString(recommendedAction.type ?? details.upgradeAction);
  const actionUrl = normalizeString(recommendedAction.url ?? details.upgradeUrl);
  return {
    code: code || "runtime_quota_denied",
    message: normalizeString(payload.message) || "runtime usage quota denied",
    meter: normalizeString(details.meter),
    actionType,
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
const quotaDenied = parseQuotaDenied(readPayload());

if (!quotaDenied) {
  process.exit(1);
}

if (command === "code") {
  process.stdout.write(quotaDenied.code);
  process.exit(0);
}

const subject = quotaNoticeSubject(quotaDenied, operation);
process.stdout.write(`${subject.headline} because ${quotaReason(quotaDenied)}. In your reply, briefly tell the user that ${subject.userState}. ${actionInstruction(quotaDenied)}`);
