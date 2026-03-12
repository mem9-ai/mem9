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
  return `${contextSection}Answer the following question based on the memories above.\n- Answer in a short phrase (under 10 words)\n- Use exact words from the memories when possible\n- Memories include timestamps; use them to resolve relative time expressions when possible\n\nQuestion: ${question}\nShort answer:`
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
  return await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildPrompt(context, question, category) },
  ], model, 200)
}

export const llmJudge = async (prediction: string, goldAnswer: number | string, question: string, model: string): Promise<number> => {
  const prompt = `Question: ${question}\nGold answer: ${String(goldAnswer)}\nPredicted answer: ${prediction}\n\nIs the predicted answer correct? Guidelines:\n- Accept semantically equivalent answers\n- Accept if a relative time expression in the prediction matches the specific date in the gold\n- Accept if the prediction captures the key fact even if phrased differently\n- For adversarial questions, only accept if prediction also signals no information\n\nRespond with exactly one word: CORRECT or WRONG`
  const text = await chat([{ role: 'user', content: prompt }], model, 10)
  return text.toUpperCase().startsWith('CORRECT') ? 1 : 0
}
