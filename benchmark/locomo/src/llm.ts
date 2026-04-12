import type { QACategory } from './types.js'

import { env } from 'node:process'

const SYSTEM_PROMPT = 'You are a helpful assistant answering questions about a person based on their conversation history stored in memory.'

const apiKey = (): string => {
  const value = env.OPENAI_API_KEY ?? ''
  if (value.length === 0) throw new Error('OPENAI_API_KEY not set')
  return value
}

const baseUrl = (): string => (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')

const buildPrompt = (context: string, question: string, category: QACategory): string => {
  const contextSection = context.length > 0 ? `Conversation memories:\n${context}\n\n` : ''
  if (category === 5) {
    return `${contextSection}Answer the following question using only the memories above. If this topic is not mentioned anywhere in the memories, respond with exactly: "No information available"\n\nQuestion: ${question}\nShort answer:`
  }
  return `${contextSection}Answer the following question based on the memories above.\n- Answer in a short phrase (under 10 words)\n- Use exact words from the memories when possible\n- If the question asks for a named thing (place, game, title, object, person, company), answer with the canonical name only, not a description\n- If the question asks for a country/state/city, answer with that level only, not an extra parenthetical explanation\n- If the question asks yes/no, answer with exactly "Yes" or "No"\n- Memories include timestamps; use them to resolve relative time expressions when possible\n\nQuestion: ${question}\nShort answer:`
}

interface ChatMessage { role: 'system' | 'user' | 'assistant', content: string }

const chat = async (messages: ChatMessage[], model: string, maxTokens: number): Promise<string> => {
  const response = await fetch(`${baseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      messages,
    }),
  })

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${response.statusText} ${await response.text()}`)
  }

  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  return json.choices?.[0]?.message?.content?.trim() ?? ''
}

export const generateAnswer = async (context: string, question: string, category: QACategory, model = 'gpt-4o-mini'): Promise<string> => {
  const raw = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildPrompt(context, question, category) },
  ], model, 200)
  return postprocessAnswer(question, raw)
}

const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim()

const isYesNoQuestion = (question: string): boolean => {
  const lower = question.toLowerCase()
  return lower.includes('yes or no') ||
    lower.startsWith('is ') ||
    lower.startsWith('are ') ||
    lower.startsWith('was ') ||
    lower.startsWith('were ') ||
    lower.startsWith('does ') ||
    lower.startsWith('do ') ||
    lower.startsWith('did ') ||
    lower.startsWith('would ') ||
    lower.startsWith('could ') ||
    lower.startsWith('should ') ||
    lower.startsWith('can ')
}

const isNamedAnswerQuestion = (question: string): boolean => {
  const lower = question.toLowerCase()
  return lower.includes('what state') ||
    lower.includes('what country') ||
    lower.includes('which country') ||
    lower.includes('which state') ||
    lower.includes('what city') ||
    lower.includes('which city') ||
    lower.includes('what game') ||
    lower.includes('which game') ||
    lower.includes('what card game') ||
    lower.includes('what title') ||
    lower.includes('which title') ||
    lower.includes('what object') ||
    lower.includes('which object') ||
    lower.includes('what name') ||
    lower.includes('which name') ||
    lower.includes('which composer') ||
    lower.includes('what composer') ||
    lower.includes('what company') ||
    lower.includes('which company')
}

const postprocessAnswer = (question: string, prediction: string): string => {
  const trimmed = normalizeWhitespace(prediction)
  if (trimmed.length === 0) return trimmed

  if (isYesNoQuestion(question)) {
    const lower = trimmed.toLowerCase()
    if (lower.startsWith('yes')) return 'Yes'
    if (lower.startsWith('no')) return 'No'
  }

  let canonical = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim()
  if (isNamedAnswerQuestion(question)) {
    canonical = canonical.split(/[;,]/)[0]?.trim() ?? canonical
  }

  return normalizeWhitespace(canonical)
}

export const llmJudge = async (prediction: string, goldAnswer: number | string, question: string, model: string): Promise<number> => {
  const prompt = `Question: ${question}\nGold answer: ${String(goldAnswer)}\nPredicted answer: ${prediction}\n\nIs the predicted answer correct? Guidelines:\n- Accept semantically equivalent answers\n- Accept if a relative time expression in the prediction matches the specific date in the gold\n- Accept if the prediction captures the key fact even if phrased differently\n- For adversarial questions, only accept if prediction also signals no information\n\nRespond with exactly one word: CORRECT or WRONG`
  const text = await chat([{ role: 'user', content: prompt }], model, 10)
  return text.toUpperCase().startsWith('CORRECT') ? 1 : 0
}
