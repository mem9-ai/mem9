import { formatRuntimeStateNotice } from "./runtime-state.ts";

export function normalizeNoticeMessage(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function responseMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const typed = payload as { message?: unknown; runtimeState?: unknown };
  return normalizeNoticeMessage(typed.message)
    || normalizeNoticeMessage(formatRuntimeStateNotice(typed.runtimeState));
}

export function responseMessageFields(payload: unknown): { message?: string } {
  const message = responseMessage(payload);
  return message ? { message } : {};
}
