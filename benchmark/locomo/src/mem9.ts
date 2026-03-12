import type { MnemoMemory } from './types.js'

import { env } from 'node:process'

const getEnv = (name: string, fallback?: string): string => {
  const value = env[name] ?? fallback ?? ''
  if (value.length === 0) throw new Error(`${name} not set`)
  return value
}

export const getBaseUrl = (): string => getEnv('MEM9_BASE_URL', 'https://api.mem9.ai').replace(/\/$/, '')
export const getTenantId = (): string => getEnv('MEM9_TENANT_ID')
export const getAgentId = (): string => env.MEM9_AGENT_ID ?? 'locomo-bench'
export const getRetrievalLimit = (): number => {
  const value = Number.parseInt(env.MEM9_RETRIEVAL_LIMIT ?? '10', 10)
  return Number.isFinite(value) && value > 0 ? value : 10
}
export const shouldClearSessionFirst = (): boolean => (env.MEM9_CLEAR_SESSION_FIRST ?? '0') === '1'

const tenantPath = (path: string): string => `${getBaseUrl()}/v1alpha1/mem9s/${encodeURIComponent(getTenantId())}${path}`

const defaultHeaders = (): HeadersInit => ({
  'Content-Type': 'application/json',
  'X-Mnemo-Agent-Id': getAgentId(),
})

export const createMemory = async (body: Record<string, unknown>): Promise<MnemoMemory> => {
  const response = await fetch(tenantPath('/memories'), {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify(body),
  })
  if (!response.ok && response.status !== 202) {
    throw new Error(`createMemory failed: ${response.status} ${response.statusText} ${await response.text()}`)
  }
  const text = await response.text()
  if (text.trim().length === 0) return { id: '', content: String(body.content ?? '') }
  return JSON.parse(text) as MnemoMemory
}

export const searchMemories = async (params: Record<string, string | number | undefined>): Promise<MnemoMemory[]> => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value != null && String(value).length > 0) query.set(key, String(value))
  }
  const response = await fetch(`${tenantPath('/memories')}?${query.toString()}`, {
    method: 'GET',
    headers: { 'X-Mnemo-Agent-Id': getAgentId() },
  })
  if (!response.ok) {
    throw new Error(`searchMemories failed: ${response.status} ${response.statusText} ${await response.text()}`)
  }
  const json = await response.json() as { memories?: MnemoMemory[] }
  return json.memories ?? []
}

export const deleteMemory = async (id: string): Promise<void> => {
  const response = await fetch(tenantPath(`/memories/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: { 'X-Mnemo-Agent-Id': getAgentId() },
  })
  if (!response.ok && response.status !== 204) {
    throw new Error(`deleteMemory failed: ${response.status} ${response.statusText} ${await response.text()}`)
  }
}
