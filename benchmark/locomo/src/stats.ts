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

  for (const r of results) {
    byCategory[r.category].push(r.score)
    byCategoryLlm[r.category].push(r.llm_judge_score)
  }

  return {
    by_category: Object.fromEntries(CATEGORIES.map(c => [c, avg(byCategory[c])])) as Record<QACategory, number>,
    by_category_count: Object.fromEntries(CATEGORIES.map(c => [c, byCategory[c].length])) as Record<QACategory, number>,
    by_category_llm: Object.fromEntries(CATEGORIES.map(c => [c, avg(byCategoryLlm[c])])) as Record<QACategory, number>,
    overall: avg(results.map(r => r.score)),
    overall_llm: avg(results.map(r => r.llm_judge_score)),
    total: results.length,
  }
}

export const printStats = (stats: BenchmarkStats): void => {
  console.log('\n── Results ──────────────────────────────────')
  console.log(`Overall F1:   ${(stats.overall * 100).toFixed(2)}%  (n=${stats.total})`)
  console.log(`Overall LLM:  ${(stats.overall_llm * 100).toFixed(2)}%`)
  console.log()
  for (const c of CATEGORIES) {
    const f1 = stats.by_category[c]
    const llm = stats.by_category_llm[c]
    const count = stats.by_category_count[c]
    if (count > 0) {
      console.log(`  Cat ${c} (${CATEGORY_NAMES[c].padEnd(12)}):  F1=${(f1 * 100).toFixed(2)}%  LLM=${(llm * 100).toFixed(2)}%  (n=${count})`)
    }
  }
  console.log('──────────────────────────────────────────────\n')
}
