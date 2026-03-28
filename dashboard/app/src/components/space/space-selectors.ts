import { formatInsightCategoryLabel } from "@/lib/memory-insight";
import {
  getCombinedTagsForMemory,
  type DerivedTagOrigin,
  type LocalDerivedSignalIndex,
} from "@/lib/memory-derived-signals";
import { normalizeTagSignal } from "@/lib/tag-signals";
import type { AnalysisCategory } from "@/types/analysis";
import type {
  Memory,
  MemoryStats,
} from "@/types/memory";
import type { TimelineSelection } from "@/types/time-range";
import type { OverviewMemorySelectionSource } from "@/components/space/memory-overview-tabs";
import type { MemoryTagResolver } from "@/lib/memory-filters";
import type { TFunction } from "i18next";

export function formatAnalysisCategoryLabel(
  t: TFunction,
  category: AnalysisCategory,
): string {
  return formatInsightCategoryLabel(category, t);
}

export function buildStats(memories: Memory[]): MemoryStats {
  return {
    total: memories.length,
    pinned: memories.filter((memory) => memory.memory_type === "pinned").length,
    insight: memories.filter((memory) => memory.memory_type === "insight").length,
  };
}

export function createTagResolver(
  signalIndex: LocalDerivedSignalIndex,
): MemoryTagResolver {
  return (memory) => getCombinedTagsForMemory(memory, signalIndex);
}

export interface TagSummary {
  tag: string;
  count: number;
  origin?: DerivedTagOrigin;
}

export function buildTagOptions(
  memories: Memory[],
  signalIndex: LocalDerivedSignalIndex,
): TagSummary[] {
  const counts = new Map<string, TagSummary>();

  for (const memory of memories) {
    for (const tag of getCombinedTagsForMemory(memory, signalIndex)) {
      const normalized = normalizeTagSignal(tag);
      if (!normalized) {
        continue;
      }

      const current = counts.get(normalized);
      if (current) {
        current.count += 1;
        continue;
      }

      counts.set(normalized, {
        tag,
        count: 1,
        origin: signalIndex.tagSourceByValue.get(normalized),
      });
    }
  }

  return [...counts.values()]
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.tag.localeCompare(right.tag, "en"),
    )
    .slice(0, 24);
}

export function formatTimelineLabel(
  selection: TimelineSelection,
  locale: string,
): string {
  const fromDate = new Date(selection.from);
  const toDate = new Date(selection.to);
  const duration = toDate.getTime() - fromDate.getTime();
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });

  if (duration < 86_400_000) {
    const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const timeFormatter = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    });
    const fromDay = dateFormatter.format(fromDate);
    const toDay = dateFormatter.format(toDate);

    return fromDay === toDay
      ? `${fromDay}, ${timeFormatter.format(fromDate)} - ${timeFormatter.format(toDate)}`
      : `${dateTimeFormatter.format(fromDate)} - ${dateTimeFormatter.format(toDate)}`;
  }

  const from = dateFormatter.format(fromDate);
  const to = dateFormatter.format(toDate);
  return from === to ? from : `${from} - ${to}`;
}

export function shouldCompactMemoryOverview(
  selected: Memory | null,
  isDesktopViewport: boolean,
  selectedDetailMode: "panel" | "sheet",
): boolean {
  return selected !== null && isDesktopViewport && selectedDetailMode === "panel";
}

export function resolveSelectedDetailMode(
  isDesktopViewport: boolean,
  source: OverviewMemorySelectionSource,
): "panel" | "sheet" {
  return !isDesktopViewport || source === "insight" ? "sheet" : "panel";
}

export function getActiveFilterCount(input: {
  type?: string;
  facet?: string;
  q?: string;
  tag?: string;
  analysisCategory?: string;
  hasTimelineSelection: boolean;
}): number {
  return (
    (input.type ? 1 : 0) +
    (input.facet ? 1 : 0) +
    (input.q ? 1 : 0) +
    (input.tag ? 1 : 0) +
    (input.analysisCategory ? 1 : 0) +
    (input.hasTimelineSelection ? 1 : 0)
  );
}

export function getPageShellClass(
  enableAnalysis: boolean,
  hasSelectedMemory: boolean,
): string {
  return enableAnalysis || hasSelectedMemory
    ? "max-w-[1560px]"
    : "max-w-3xl";
}

export function selectDisplayedMemories(input: {
  analysisCategory?: AnalysisCategory;
  tag?: string;
  timelineSelection?: TimelineSelection;
  memories: Memory[];
  analysisFilteredMemories: Memory[];
  tagFilteredMemories: Memory[];
  timelineFilteredMemories: Memory[];
  localVisibleCount: number;
}): {
  usingLocalFilteredList: boolean;
  baseDisplayedMemories: Memory[];
  displayedMemories: Memory[];
} {
  const usingLocalTagList = !input.analysisCategory && !!input.tag;
  const usingLocalTimelineList =
    !input.analysisCategory && !input.tag && !!input.timelineSelection;
  const usingLocalFilteredList =
    !!input.analysisCategory || usingLocalTagList || usingLocalTimelineList;
  const baseDisplayedMemories = input.analysisCategory
    ? input.analysisFilteredMemories
    : usingLocalTagList
    ? input.tagFilteredMemories
    : usingLocalTimelineList
    ? input.timelineFilteredMemories
    : input.memories;

  return {
    usingLocalFilteredList,
    baseDisplayedMemories,
    displayedMemories: usingLocalFilteredList
      ? baseDisplayedMemories.slice(0, input.localVisibleCount)
      : input.memories,
  };
}
