import type { MnemoMemory } from './types.js'

import { env } from 'node:process'

import { fetchWithRetry } from './fetch.js'

const getEnv = (name: string, fallback?: string): string => {
  const value = env[name] ?? fallback ?? ''
  if (value.length === 0) throw new Error(`${name} not set`)
  return value
}

export const getBaseUrl = (): string => getEnv('MEM9_BASE_URL', 'https://api.mem9.ai').replace(/\/$/, '')

export const provisionSpace = async (): Promise<string> => {
  const response = await fetchWithRetry(`${getBaseUrl()}/v1alpha1/mem9s`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Failed to provision mem9 space: ${response.status} ${response.statusText} ${await response.text()}`)
  }
  const json = await response.json() as { id: string }
  if (!json.id) throw new Error('Provisioned space response missing id')
  return json.id
}
export const getAgentId = (): string => env.MEM9_AGENT_ID ?? 'locomo-bench'
export const getRetrievalLimit = (): number => {
  const value = Number.parseInt(env.MEM9_RETRIEVAL_LIMIT ?? '20', 10)
  return Number.isFinite(value) && value > 0 ? value : 20
}
export const shouldClearSessionFirst = (): boolean => (env.MEM9_CLEAR_SESSION_FIRST ?? '0') === '1'

const tenantPath = (tenantId: string, path: string): string => `${getBaseUrl()}/v1alpha1/mem9s/${encodeURIComponent(tenantId)}${path}`

const defaultHeaders = (): HeadersInit => ({
  'Content-Type': 'application/json',
  'X-Mnemo-Agent-Id': getAgentId(),
})

export interface IngestMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export const ingestMessages = async (tenantId: string, messages: IngestMessage[], sessionId: string): Promise<void> => {
  const response = await fetchWithRetry(tenantPath(tenantId, '/memories'), {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify({
      messages,
      session_id: sessionId,
      agent_id: getAgentId(),
      mode: 'smart',
      sync: true,
    }),
  })
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`ingestMessages failed (expected 200/202, got ${response.status}): ${response.statusText} ${await response.text()}`)
  }
}

export const createMemory = async (tenantId: string, body: Record<string, unknown>): Promise<MnemoMemory> => {
  const response = await fetchWithRetry(tenantPath(tenantId, '/memories'), {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify({ ...body, sync: true }),
  })
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`createMemory failed (expected 200/202, got ${response.status}): ${response.statusText} ${await response.text()}`)
  }
  if (response.status === 202) {
    return { id: '', content: String(body.content ?? '') }
  }
  const text = await response.text()
  if (text.trim().length === 0) return { id: '', content: String(body.content ?? '') }
  return JSON.parse(text) as MnemoMemory
}

export const searchMemories = async (tenantId: string, params: Record<string, string | number | undefined>): Promise<MnemoMemory[]> => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value != null && String(value).length > 0) query.set(key, String(value))
  }
  const url = `${tenantPath(tenantId, '/memories')}?${query.toString()}`
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { 'X-Mnemo-Agent-Id': getAgentId() },
  })
  if (!response.ok) {
    throw new Error(`searchMemories failed: ${response.status} ${response.statusText} ${await response.text()}`)
  }
  const json = await response.json() as { memories?: MnemoMemory[] }
  return json.memories ?? []
}

export const deleteMemory = async (tenantId: string, id: string): Promise<void> => {
  const response = await fetchWithRetry(tenantPath(tenantId, `/memories/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: { 'X-Mnemo-Agent-Id': getAgentId() },
  })
  if (!response.ok && response.status !== 204) {
    throw new Error(`deleteMemory failed: ${response.status} ${response.statusText} ${await response.text()}`)
  }
}
