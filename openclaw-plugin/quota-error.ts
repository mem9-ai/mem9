const QUOTA_CODES = new Set([
  "quota_exhausted",
  "spending_limit_exceeded",
  "runtime_quota_denied",
]);

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
  bindingState?: string;
  type?: string;
  url?: string;
}

export interface RuntimeQuotaDenied {
  status: number | null;
  code: string;
  message: string;
  recommendedAction?: RuntimeRecommendedAction;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function normalizeRecommendedAction(details: Record<string, unknown>): RuntimeRecommendedAction | null {
  const nested = isRecord(details.recommendedAction) ? details.recommendedAction : {};
  const bindingState = normalizeString(nested.bindingState ?? details.bindingState);
  const type = normalizeString(nested.type ?? details.upgradeAction);
  const url = normalizeString(nested.url ?? details.upgradeUrl);

  if (!bindingState && !type && !url) {
    return null;
  }

  return {
    ...(bindingState ? { bindingState } : {}),
    ...(type ? { type } : {}),
    ...(url ? { url } : {}),
  };
}

function actionLabel(type: string): string {
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

function sentence(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

export function parseRuntimeQuotaDenied(value: unknown): RuntimeQuotaDenied | null {
  const payload = value instanceof Mem9HttpError ? value.data : value;
  if (!isRecord(payload)) {
    return null;
  }

  const details = isRecord(payload.details) ? payload.details : {};
  const code = normalizeString(payload.code);
  const mem9Code = normalizeString(details.mem9Code ?? details.mem9_code ?? payload.mem9_code);
  if (mem9Code !== "runtime_quota_denied" && !QUOTA_CODES.has(code)) {
    return null;
  }

  const recommendedAction = normalizeRecommendedAction(details);
  return {
    status: value instanceof Mem9HttpError ? value.status : null,
    code: code || "runtime_quota_denied",
    message: normalizeString(payload.message) || "runtime usage quota denied",
    ...(recommendedAction ? { recommendedAction } : {}),
  };
}

export function formatRuntimeQuotaNotice(value: unknown, operation: string): string {
  const denied = parseRuntimeQuotaDenied(value);
  if (!denied) {
    return "";
  }

  const actionUrl = normalizeString(denied.recommendedAction?.url);
  const actionText = actionUrl
    ? ` User action required: ${actionLabel(normalizeString(denied.recommendedAction?.type))}: ${actionUrl}`
    : "";
  const replyInstruction = actionUrl
    ? ` In your reply, briefly tell the user mem9 memory is paused and include this URL exactly: ${actionUrl}`
    : " In your reply, briefly tell the user mem9 memory is paused.";
  return `[mem9] ${operation}: ${sentence(denied.message)}${actionText}${replyInstruction}`;
}

export function toolErrorPayload(error: unknown): Record<string, unknown> {
  const denied = parseRuntimeQuotaDenied(error);
  if (denied) {
    return {
      ok: false,
      error: denied.message,
      status_code: denied.status,
      code: denied.code,
      quota: {
        code: denied.code,
        message: denied.message,
        ...(denied.recommendedAction ? { recommendedAction: denied.recommendedAction } : {}),
      },
      ...(denied.recommendedAction?.url ? { action_url: denied.recommendedAction.url } : {}),
    };
  }

  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}
