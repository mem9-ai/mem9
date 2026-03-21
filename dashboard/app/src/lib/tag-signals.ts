const LOW_SIGNAL_AGGREGATION_TAGS = new Set([
  "clawd",
  "import",
  "local-memory",
  "local_memory",
  "md",
  "json",
]);

export function normalizeTagSignal(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isLowSignalAggregationTag(value: string): boolean {
  return LOW_SIGNAL_AGGREGATION_TAGS.has(normalizeTagSignal(value));
}

export function filterLowSignalAggregationTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const filtered: string[] = [];

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed || isLowSignalAggregationTag(trimmed)) {
      continue;
    }

    const normalized = normalizeTagSignal(trimmed);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    filtered.push(trimmed);
  }

  return filtered;
}
