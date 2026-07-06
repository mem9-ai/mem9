export class Mem9HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly data: unknown,
  ) {
    super(message);
    this.name = "Mem9HttpError";
  }
}

export interface RuntimeRecommendedAction {
  providerActionCode?: string;
  severity?: string;
  type?: string;
  url?: string;
}

export interface RuntimeQuotaDenied {
  status: number | null;
  code: string;
  message: string;
  meter?: string;
  quotaGateReason?: string;
  retryAfterSeconds?: number;
  recommendedAction?: RuntimeRecommendedAction;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function parseJsonOrUndefined(text: string): unknown {
  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function messageFromErrorBody(status: number, body: string, data: unknown): string {
  if (isRecord(data)) {
    const message = normalizeString(data.message);
    if (message) {
      return message;
    }

    const error = normalizeString(data.error);
    if (error) {
      return error;
    }
  }

  const text = body.trim();
  return text || `HTTP ${status}`;
}

function normalizeRecommendedAction(runtimeQuota: Record<string, unknown>): RuntimeRecommendedAction | null {
  const nested = isRecord(runtimeQuota.recommendedAction) ? runtimeQuota.recommendedAction : {};
  const providerActionCode = normalizeString(nested.providerActionCode);
  const severity = normalizeString(nested.severity);
  const type = normalizeString(nested.type);
  const url = normalizeString(nested.url);

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

function quotaGateReason(runtimeQuota: Record<string, unknown>): string {
  const quotaGateResult = isRecord(runtimeQuota.quotaGateResult) ? runtimeQuota.quotaGateResult : {};
  return normalizeString(quotaGateResult.reason);
}

function retryAfterSeconds(runtimeQuota: Record<string, unknown>): number | null {
  const direct = normalizePositiveInteger(runtimeQuota.retryAfterSeconds);
  if (direct !== null) {
    return direct;
  }

  const quotaGateResult = isRecord(runtimeQuota.quotaGateResult) ? runtimeQuota.quotaGateResult : {};
  const postQuotaRateLimit = isRecord(quotaGateResult.postQuotaRateLimit) ? quotaGateResult.postQuotaRateLimit : {};
  return normalizePositiveInteger(postQuotaRateLimit.retryAfterSeconds);
}

function isPostQuotaRateLimited(denied: RuntimeQuotaDenied): boolean {
  return denied.status === 429 ||
    denied.quotaGateReason === "postQuotaRateLimitExceeded";
}

function quotaReason(denied: RuntimeQuotaDenied): string {
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

function quotaNoticeSubject(denied: RuntimeQuotaDenied, operation: string): { headline: string; userState: string } {
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

function actionUrlForDenied(denied: RuntimeQuotaDenied): string {
  return normalizeString(denied.recommendedAction?.url);
}

function actionInstruction(denied: RuntimeQuotaDenied): string {
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

export function parseRuntimeQuotaDenied(value: unknown): RuntimeQuotaDenied | null {
  const payload = value instanceof Mem9HttpError ? value.data : value;
  if (!isRecord(payload)) {
    return null;
  }

  const details = isRecord(payload.details) ? payload.details : {};
  if (normalizeString(details.errorCategory) !== "runtime_quota_denied") {
    return null;
  }
  const runtimeQuota = isRecord(details.runtimeQuota) ? details.runtimeQuota : {};

  const recommendedAction = normalizeRecommendedAction(runtimeQuota);
  const retryAfter = retryAfterSeconds(runtimeQuota);
  const reason = quotaGateReason(runtimeQuota);
  return {
    status: value instanceof Mem9HttpError ? value.status : null,
    code: "runtime_quota_denied",
    message: normalizeString(payload.error) || "Runtime usage quota denied.",
    ...(normalizeString(runtimeQuota.meter) ? { meter: normalizeString(runtimeQuota.meter) } : {}),
    ...(reason ? { quotaGateReason: reason } : {}),
    ...(retryAfter !== null ? { retryAfterSeconds: retryAfter } : {}),
    ...(recommendedAction ? { recommendedAction } : {}),
  };
}

export function formatRuntimeQuotaNotice(value: unknown, operation: string): string {
  const denied = parseRuntimeQuotaDenied(value);
  if (!denied) {
    return "";
  }

  const subject = quotaNoticeSubject(denied, operation);
  return `${subject.headline} because ${quotaReason(denied)}. In your reply, briefly tell the user that ${subject.userState}. ${actionInstruction(denied)}`;
}

export function toolErrorPayload(error: unknown): Record<string, unknown> {
  const denied = parseRuntimeQuotaDenied(error);
  if (denied) {
    const actionUrl = actionUrlForDenied(denied);
    return {
      ok: false,
      error: denied.message,
      status_code: denied.status,
      code: denied.code,
      quota: {
        code: denied.code,
        message: denied.message,
        ...(denied.retryAfterSeconds !== undefined ? { retryAfterSeconds: denied.retryAfterSeconds } : {}),
        ...(denied.recommendedAction ? { recommendedAction: denied.recommendedAction } : {}),
      },
      ...(actionUrl ? { action_url: actionUrl } : {}),
    };
  }

  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}
