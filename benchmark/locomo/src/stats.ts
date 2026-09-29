/* eslint-disable no-console */
import type { BenchmarkStats, QACategory, QAResult } from './types.js'

const CATEGORIES: QACategory[] = [1, 2, 3, 4, 5]
const CATEGORY_NAMES: Record<QACategory, string> = {
  1: 'multi-hop',
  2: 'single-hop',
  3: 'temporal',
  4: 'open-domain',
  5: 'adversarial',
}

const avg = (scores: number[]): number =>
  scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0

export const computeStats = (results: QAResult[]): BenchmarkStats => {
  const byCategory = Object.fromEntries(CATEGORIES.map(c => [c, [] as number[]])) as Record<QACategory, number[]>
  const byCategoryLlm = Object.fromEntries(CATEGORIES.map(c => [c, [] as number[]])) as Record<QACategory, number[]>
  const byCategoryEvidence = Object.fromEntries(CATEGORIES.map(c => [c, [] as number[]])) as Record<QACategory, number[]>

  for (const r of results) {
    byCategory[r.category].push(r.score)
    if (r.llm_judge_score != null) byCategoryLlm[r.category].push(r.llm_judge_score)
    if (r.evidence_recall != null) byCategoryEvidence[r.category].push(r.evidence_recall)
  }

  const allLlmScores = results.filter(r => r.llm_judge_score != null).map(r => r.llm_judge_score as number)
  const allEvidenceScores = results.filter(r => r.evidence_recall != null).map(r => r.evidence_recall as number)

  const catAvgs = CATEGORIES.map(c => byCategory[c].length > 0 ? avg(byCategory[c]) : null)
  const catLlmAvgs = CATEGORIES.map(c => byCategoryLlm[c].length > 0 ? avg(byCategoryLlm[c]) : null)

  const validCatAvgs = catAvgs.filter((v): v is number => v != null)
  const validCatLlmAvgs = catLlmAvgs.filter((v): v is number => v != null)

  return {
    by_category: Object.fromEntries(CATEGORIES.map(c => [c, avg(byCategory[c])])) as Record<QACategory, number>,
    by_category_count: Object.fromEntries(CATEGORIES.map(c => [c, byCategory[c].length])) as Record<QACategory, number>,
    by_category_llm: Object.fromEntries(CATEGORIES.map(c => [c, byCategoryLlm[c].length > 0 ? avg(byCategoryLlm[c]) : null])) as Record<QACategory, number | null>,
    by_category_llm_count: Object.fromEntries(CATEGORIES.map(c => [c, byCategoryLlm[c].length])) as Record<QACategory, number>,
    by_category_evidence_recall: Object.fromEntries(CATEGORIES.map(c => [c, byCategoryEvidence[c].length > 0 ? avg(byCategoryEvidence[c]) : null])) as Record<QACategory, number | null>,
    overall: avg(results.map(r => r.score)),
    overall_macro: validCatAvgs.length > 0 ? avg(validCatAvgs) : 0,
    overall_llm: allLlmScores.length > 0 ? avg(allLlmScores) : null,
    overall_llm_macro: validCatLlmAvgs.length > 0 ? avg(validCatLlmAvgs) : null,
    overall_llm_count: allLlmScores.length,
    overall_evidence_recall: allEvidenceScores.length > 0 ? avg(allEvidenceScores) : null,
    total: results.length,
  }
}

const fmtLlm = (v: number | null): string => v != null ? `${(v * 100).toFixed(2)}%` : 'N/A'

export const printStats = (stats: BenchmarkStats): void => {
  console.log('\n── Results ──────────────────────────────────')
  console.log(`Overall F1 (micro): ${(stats.overall * 100).toFixed(2)}%  (n=${stats.total})`)
  console.log(`Overall F1 (macro): ${(stats.overall_macro * 100).toFixed(2)}%`)
  console.log(`Overall LLM (micro): ${fmtLlm(stats.overall_llm)}${stats.overall_llm_count > 0 ? `  (n=${stats.overall_llm_count})` : ''}`)
  console.log(`Overall LLM (macro): ${fmtLlm(stats.overall_llm_macro)}`)
  if (stats.overall_evidence_recall != null) {
    console.log(`Overall Evidence Recall: ${(stats.overall_evidence_recall * 100).toFixed(2)}%`)
  }
  console.log()
  for (const c of CATEGORIES) {
    const f1 = stats.by_category[c]
    const llm = stats.by_category_llm[c]
    const er = stats.by_category_evidence_recall[c]
    const count = stats.by_category_count[c]
    const llmCount = stats.by_category_llm_count[c]
    if (count > 0) {
      const llmCountStr = llmCount > 0 ? `  llm_n=${llmCount}` : ''
      const erStr = er != null ? `  ER=${(er * 100).toFixed(1)}%` : ''
      console.log(`  Cat ${c} (${CATEGORY_NAMES[c].padEnd(12)}):  F1=${(f1 * 100).toFixed(2)}%  LLM=${fmtLlm(llm)}${erStr}  (n=${count}${llmCountStr})`)
    }
  }
  console.log('──────────────────────────────────────────────\n')
}
