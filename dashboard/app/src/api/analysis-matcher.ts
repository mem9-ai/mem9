import type {
  AnalysisCategory,
  AnalysisCategoryCard,
  MemoryAnalysisMatch,
  TaxonomyResponse,
  TaxonomyRuleDefinition,
} from "@/types/analysis";
import type { Memory } from "@/types/memory";

function normalizeText(memory: Memory): string {
  const tags = memory.tags.map((tag) => `#${tag}`).join(" ");
  return `${memory.content} ${tags}`.toLowerCase();
}

function matchesRule(text: string, rule: TaxonomyRuleDefinition): boolean {
  const pattern = rule.pattern.trim();
  if (!pattern) return false;

  if (rule.matchType === "regex") {
    try {
      return new RegExp(pattern, "iu").test(text);
    } catch {
      return false;
    }
  }

  return text.includes(pattern.toLowerCase());
}

export function matchMemoriesToTaxonomy(
  memories: Memory[],
  taxonomy: TaxonomyResponse,
): MemoryAnalysisMatch[] {
  const rules = taxonomy.rules.filter((rule) => rule.enabled);

  return memories
    .map<MemoryAnalysisMatch | null>((memory) => {
      const text = normalizeText(memory);
      const categoryScores: Partial<Record<AnalysisCategory, number>> = {};

      for (const rule of rules) {
        if (!matchesRule(text, rule)) continue;
        categoryScores[rule.category] =
          (categoryScores[rule.category] ?? 0) + rule.weight;
      }

      const categories = Object.entries(categoryScores)
        .filter(([, score]) => typeof score === "number" && score > 0)
        .sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0))
        .map(([category]) => category as AnalysisCategory);

      if (categories.length === 0) return null;

      return {
        memoryId: memory.id,
        categories,
        categoryScores,
      };
    })
    .filter((match): match is MemoryAnalysisMatch => match !== null);
}

export function buildAnalysisCardsFromMatches(
  matches: MemoryAnalysisMatch[],
  totalMemories: number,
): AnalysisCategoryCard[] {
  const counts: Partial<Record<AnalysisCategory, number>> = {};

  for (const match of matches) {
    for (const category of match.categories) {
      counts[category] = (counts[category] ?? 0) + 1;
    }
  }

  return Object.entries(counts)
    .map(([category, count]) => ({
      category: category as AnalysisCategory,
      count: count ?? 0,
      confidence:
        totalMemories === 0 ? 0 : Number(((count ?? 0) / totalMemories).toFixed(2)),
    }))
    .sort((left, right) => right.count - left.count);
}

export function createAnalysisMatchMap(
  matches: MemoryAnalysisMatch[],
): Map<string, MemoryAnalysisMatch> {
  return new Map(matches.map((match) => [match.memoryId, match]));
}
