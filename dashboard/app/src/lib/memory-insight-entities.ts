import type { Memory } from "@/types/memory";

export type MemoryInsightEntityKind =
  | "named_term"
  | "metric"
  | "person_like"
  | "fallback";

export interface MemoryInsightEntityHit {
  kind: MemoryInsightEntityKind;
  label: string;
  normalizedLabel: string;
  index: number;
}

const ENTITY_KIND_ORDER: Record<MemoryInsightEntityKind, number> = {
  named_term: 0,
  metric: 1,
  person_like: 2,
  fallback: 3,
};

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function addEntityHit(
  target: Map<string, MemoryInsightEntityHit>,
  label: string,
  kind: MemoryInsightEntityKind,
  index: number,
): void {
  const trimmed = label.trim();
  if (!trimmed) {
    return;
  }

  const normalizedLabel = normalizeLabel(trimmed);
  if (!normalizedLabel) {
    return;
  }

  const key = `${kind}:${normalizedLabel}`;
  if (!target.has(key)) {
    target.set(key, {
      kind,
      label: trimmed,
      normalizedLabel,
      index,
    });
  }
}

export function extractMemoryInsightEntities(
  memory: Memory,
): MemoryInsightEntityHit[] {
  const hits = new Map<string, MemoryInsightEntityHit>();
  const source = memory.content;

  for (const match of source.matchAll(/`([^`]+)`/g)) {
    addEntityHit(hits, match[1] ?? "", "named_term", match.index ?? 0);
  }

  for (const match of source.matchAll(/"([^"]{2,120})"/g)) {
    const value = match[1] ?? "";
    if (value.split(/\s+/).length >= 2) {
      addEntityHit(hits, value, "named_term", match.index ?? 0);
    }
  }

  for (const match of source.matchAll(
    /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s`"'<>]*)?/gi,
  )) {
    addEntityHit(hits, match[0] ?? "", "named_term", match.index ?? 0);
  }

  for (const match of source.matchAll(
    /\b(?:@[a-z0-9-]+\/)?[a-z0-9]+(?:[-_/][a-z0-9]+)+\b/gi,
  )) {
    addEntityHit(hits, match[0] ?? "", "named_term", match.index ?? 0);
  }

  for (const match of source.matchAll(/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g)) {
    addEntityHit(hits, match[0] ?? "", "named_term", match.index ?? 0);
  }

  for (const match of source.matchAll(
    /\b\d+(?:\.\d+)?(?:%|ms|s|m|h|d|w|mo|y|kb|mb|gb|tb|x)(?!\w)/gi,
  )) {
    addEntityHit(hits, match[0] ?? "", "metric", match.index ?? 0);
  }

  for (const match of source.matchAll(/\bv?\d+\.\d+(?:\.\d+)?\b/gi)) {
    addEntityHit(hits, match[0] ?? "", "metric", match.index ?? 0);
  }

  for (const match of source.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
    addEntityHit(hits, match[0] ?? "", "metric", match.index ?? 0);
  }

  for (const match of source.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g)) {
    addEntityHit(hits, match[0] ?? "", "metric", match.index ?? 0);
  }

  for (const match of source.matchAll(/@[a-z0-9._-]{2,}/gi)) {
    addEntityHit(hits, match[0] ?? "", "person_like", match.index ?? 0);
  }

  for (const match of source.matchAll(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g)) {
    addEntityHit(hits, match[0] ?? "", "person_like", match.index ?? 0);
  }

  return [...hits.values()].sort(
    (left, right) =>
      left.index - right.index ||
      ENTITY_KIND_ORDER[left.kind] - ENTITY_KIND_ORDER[right.kind] ||
      left.label.localeCompare(right.label, "en"),
  );
}
