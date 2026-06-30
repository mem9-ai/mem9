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

const actionText = quotaDenied.actionUrl
  ? ` User action required: ${actionLabel(quotaDenied.actionType)}: ${quotaDenied.actionUrl}`
  : "";
const replyInstruction = quotaDenied.actionUrl
  ? ` In your reply, briefly tell the user mem9 memory is paused and include this URL exactly: ${quotaDenied.actionUrl}`
  : " In your reply, briefly tell the user mem9 memory is paused.";
process.stdout.write(`[mem9] ${operation}: ${sentence(quotaDenied.message)}${actionText}${replyInstruction}`);
