import type { QACategory } from './types.js'

const ARTICLES = new Set(['a', 'an', 'and', 'the'])

const normalizeAnswer = (s: number | string): string =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !ARTICLES.has(w))
    .join(' ')

const tokenF1 = (prediction: string, groundTruth: string): number => {
  const predTokens = normalizeAnswer(prediction).split(' ').filter(token => token.length > 0)
  const goldTokens = normalizeAnswer(groundTruth).split(' ').filter(token => token.length > 0)

  if (predTokens.length === 0 && goldTokens.length === 0) return 1
  if (predTokens.length === 0 || goldTokens.length === 0) return 0

  const goldCount = new Map<string, number>()
  for (const t of goldTokens) goldCount.set(t, (goldCount.get(t) ?? 0) + 1)

  let numSame = 0
  for (const t of predTokens) {
    const cnt = goldCount.get(t) ?? 0
    if (cnt > 0) {
      numSame++
      goldCount.set(t, cnt - 1)
    }
  }

  if (numSame === 0) return 0
  const precision = numSame / predTokens.length
  const recall = numSame / goldTokens.length
  return (2 * precision * recall) / (precision + recall)
}

const scoreCategory1 = (prediction: string, goldAnswer: string): number => {
  const subAnswers = goldAnswer.split(',').map(s => s.trim()).filter(Boolean)
  if (subAnswers.length === 0) return 0
  const scores = subAnswers.map(sub => tokenF1(prediction, sub))
  return scores.reduce((a, b) => a + b, 0) / scores.length
}

const scoreCategory3 = (prediction: string, goldAnswer: string): number => {
  const gold = goldAnswer.split(';')[0]?.trim() ?? goldAnswer
  return tokenF1(prediction, gold)
}

const scoreCategory5 = (prediction: string): number => {
  const lower = prediction.toLowerCase()
  return lower.includes('no information') || lower.includes('not mentioned') ? 1 : 0
}

export const scoreAnswer = (prediction: string, goldAnswer: number | string, category: QACategory): number => {
  const gold = String(goldAnswer)
  switch (category) {
    case 1: return scoreCategory1(prediction, gold)
    case 2:
    case 4: return tokenF1(prediction, gold)
    case 3: return scoreCategory3(prediction, gold)
    case 5: return scoreCategory5(prediction)
  }
}
