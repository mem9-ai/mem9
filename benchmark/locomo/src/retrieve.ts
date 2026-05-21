import type { MnemoMemory } from './types.js'

import { getAgentId, getRetrievalLimit, searchMemories } from './mem9.js'

export interface RetrievalResult {
  context: string
  diaIds: string[]
}

export const getContext = async (tenantId: string, sessionId: string, question: string): Promise<RetrievalResult> => {
  const memories = await searchMemories(tenantId, {
    q: question,
    session_id: sessionId,
    agent_id: getAgentId(),
    limit: getRetrievalLimit(),
  })

  const context = memories
    .map((memory, index) => {
      const scoreLabel = typeof memory.score === 'number' ? ` score=${memory.score.toFixed(4)}` : ''
      return `#${index + 1}${scoreLabel}\n${memory.content}`
    })
    .join('\n\n')

  const diaIds = extractDiaIds(memories)

  return { context, diaIds }
}

const extractDiaIds = (memories: MnemoMemory[]): string[] => {
  const ids = new Set<string>()
  for (const m of memories) {
    // Check metadata for dia_id
    const meta = m.metadata
    if (meta != null && typeof meta === 'object') {
      const diaId = (meta as Record<string, unknown>).dia_id
      if (typeof diaId === 'string' && diaId.length > 0) ids.add(diaId)
    }
    // Also try to extract from content prefix [dia:D1:3]
    const matches = m.content.matchAll(/\[dia:([^\]]+)\]/g)
    for (const match of matches) {
      if (match[1]) ids.add(match[1])
    }
  }
  return [...ids]
}

export const computeEvidenceRecall = (retrievedDiaIds: string[], goldEvidence: string[]): number | null => {
  if (goldEvidence.length === 0) return null
  if (retrievedDiaIds.length === 0) return 0
  const retrieved = new Set(retrievedDiaIds)
  let hits = 0
  for (const ev of goldEvidence) {
    if (retrieved.has(ev)) hits++
  }
  return hits / goldEvidence.length
}
