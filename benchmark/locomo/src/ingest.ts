import type { DialogTurn, LoCoMoSample } from './types.js'

import { readFile, writeFile } from 'node:fs/promises'

import { runWithConcurrency } from './concurrency.js'
import { createMemory, deleteMemory, getAgentId, ingestMessages, searchMemories, shouldClearSessionFirst } from './mem9.js'
import type { IngestMessage } from './mem9.js'

export type IngestMode = 'raw' | 'messages'

interface OrderedSession { dateLabel: string | null, turns: DialogTurn[], sessionNo: number }

const getOrderedSessions = (sample: LoCoMoSample): OrderedSession[] => {
  const sessionNos: number[] = []
  for (const key of Object.keys(sample.conversation)) {
    const match = key.match(/^session_(\d+)$/)
    if (match && Array.isArray(sample.conversation[key])) {
      sessionNos.push(Number(match[1]))
    }
  }
  sessionNos.sort((a, b) => a - b)
  return sessionNos.map(sn => {
    const turns = sample.conversation[`session_${sn}`] as DialogTurn[]
    const dateLabelRaw = sample.conversation[`session_${sn}_date_time`]
    return {
      dateLabel: typeof dateLabelRaw === 'string' ? dateLabelRaw : null,
      turns,
      sessionNo: sn,
    }
  })
}

const clearExistingSessionMemories = async (tenantId: string, sessionId: string): Promise<void> => {
  const limit = 200
  while (true) {
    const memories = await searchMemories(tenantId, { session_id: sessionId, agent_id: getAgentId(), limit, offset: 0 })
    if (memories.length === 0) break
    for (const memory of memories) {
      if (memory.id) await deleteMemory(tenantId, memory.id)
    }
  }
}

const formatContent = (sampleId: string, sessionNo: number, turnIndex: number, dateLabel: null | string, turn: DialogTurn): string => {
  const prefix = [
    `[sample:${sampleId}]`,
    `[session:${sessionNo}]`,
    `[turn:${turnIndex + 1}]`,
    turn.dia_id ? `[dia:${turn.dia_id}]` : '',
    dateLabel ? `[date:${dateLabel}]` : '',
    `[speaker:${turn.speaker}]`,
  ].filter(Boolean).join(' ')
  return `${prefix} ${turn.text}`.trim()
}

const speakerToRole = (speaker: string): 'user' | 'assistant' => {
  const lower = speaker.toLowerCase()
  if (lower.includes('1') || lower === 'user') return 'user'
  return 'assistant'
}

const ingestSampleMessages = async (tenantId: string, sample: LoCoMoSample): Promise<string> => {
  const sessionId = sample.sample_id
  if (shouldClearSessionFirst()) {
    await clearExistingSessionMemories(tenantId, sessionId)
  }

  const sessions = getOrderedSessions(sample)
  console.log(`[${sample.sample_id}] Ingesting via messages pipeline...`)

  for (const session of sessions) {
    const messages: IngestMessage[] = []
    for (const turn of session.turns) {
      if (turn.text.trim().length === 0) continue
      const datePrefix = session.dateLabel ? `[${session.dateLabel}] ` : ''
      messages.push({
        role: speakerToRole(turn.speaker),
        content: `${datePrefix}${turn.text}`,
      })
    }
    if (messages.length > 0) {
      await ingestMessages(tenantId, messages, sessionId)
      console.log(`[${sample.sample_id}] Sent session ${session.sessionNo} (${messages.length} messages)`)
    }
  }

  console.log(`[${sample.sample_id}] Ingestion complete`)
  return sessionId
}

const ingestSampleRaw = async (tenantId: string, sample: LoCoMoSample, ingestConcurrency: number): Promise<string> => {
  const sessionId = sample.sample_id
  if (shouldClearSessionFirst()) {
    await clearExistingSessionMemories(tenantId, sessionId)
  }

  const sessions = getOrderedSessions(sample)
  let total = 0
  for (const session of sessions) total += session.turns.filter(turn => turn.text.trim().length > 0).length
  let done = 0
  let lastPct = -1

  console.log(`[${sample.sample_id}] Ingesting ${total} turns (raw) with concurrency=${ingestConcurrency}...`)

  let failed = 0
  const tasks: Array<() => Promise<void>> = []
  for (const session of sessions) {
    for (let i = 0; i < session.turns.length; i++) {
      const turn = session.turns[i]
      if (turn == null || turn.text.trim().length === 0) continue
      tasks.push(async () => {
        try {
          await createMemory(tenantId, {
            content: formatContent(sample.sample_id, session.sessionNo, i, session.dateLabel, turn),
            agent_id: getAgentId(),
            session_id: sessionId,
            tags: ['benchmark', 'locomo'],
            metadata: {
              sample_id: sample.sample_id,
              session_no: session.sessionNo,
              turn_index: i,
              date_time: session.dateLabel,
              dia_id: turn.dia_id,
              speaker: turn.speaker,
            },
          })
        } catch (err) {
          failed += 1
          console.error(`[${sample.sample_id}] Failed to ingest session ${session.sessionNo} turn ${i}: ${err instanceof Error ? err.message : err}`)
        }
        done += 1
        const pct = Math.floor((done / Math.max(total, 1)) * 100)
        if (pct >= lastPct + 20) {
          console.log(`[${sample.sample_id}] Ingesting ${pct}%`)
          lastPct = pct
        }
      })
    }
  }

  await runWithConcurrency(tasks, ingestConcurrency)

  if (failed > 0) {
    console.warn(`[${sample.sample_id}] Ingestion complete with ${failed}/${total} failed turns`)
  } else {
    console.log(`[${sample.sample_id}] Ingestion complete`)
  }
  return sessionId
}

export const ingestSample = async (tenantId: string, sample: LoCoMoSample, mode: IngestMode = 'raw', ingestConcurrency = 1): Promise<string> => {
  if (mode === 'messages') {
    return await ingestSampleMessages(tenantId, sample)
  }
  return await ingestSampleRaw(tenantId, sample, ingestConcurrency)
}

export const loadConversationIds = async (path: string): Promise<Record<string, string>> => {
  try {
    const content = await readFile(path, 'utf-8')
    return JSON.parse(content) as Record<string, string>
  } catch {
    return {}
  }
}

export const saveConversationIds = async (path: string, ids: Record<string, string>): Promise<void> => {
  await writeFile(path, JSON.stringify(ids, null, 2))
}
