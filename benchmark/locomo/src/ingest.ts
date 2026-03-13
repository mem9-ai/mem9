import type { DialogTurn, LoCoMoSample } from './types.js'

import { readFile, writeFile } from 'node:fs/promises'

import { Spinner } from 'picospinner'

import { createMemory, deleteMemory, getAgentId, searchMemories, shouldClearSessionFirst } from './mem9.js'

interface OrderedSession { dateLabel: string | null, turns: DialogTurn[], sessionNo: number }

const getOrderedSessions = (sample: LoCoMoSample): OrderedSession[] => {
  const sessions: OrderedSession[] = []
  for (let sn = 1; sn <= 100; sn++) {
    const turns = sample.conversation[`session_${sn}`]
    if (!Array.isArray(turns)) break
    const dateLabelRaw = sample.conversation[`session_${sn}_date_time`]
    sessions.push({
      dateLabel: typeof dateLabelRaw === 'string' ? dateLabelRaw : null,
      turns,
      sessionNo: sn,
    })
  }
  return sessions
}

const clearExistingSessionMemories = async (sessionId: string): Promise<void> => {
  const limit = 200
  let offset = 0
  while (true) {
    const memories = await searchMemories({ session_id: sessionId, agent_id: getAgentId(), limit, offset })
    if (memories.length === 0) break
    for (const memory of memories) {
      if (memory.id) await deleteMemory(memory.id)
    }
    if (memories.length < limit) break
    offset += limit
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

const sleep = async (ms: number): Promise<void> => await new Promise(resolve => setTimeout(resolve, ms))

const waitForSessionMemories = async (sessionId: string, expectedCount: number): Promise<void> => {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const memories = await searchMemories({ session_id: sessionId, agent_id: getAgentId(), limit: expectedCount })
    if (memories.length >= expectedCount) return
    await sleep(1000)
  }
  throw new Error(`Timed out waiting for mem9 writes for session ${sessionId}`)
}

const ingestSample = async (sample: LoCoMoSample): Promise<string> => {
  const sessionId = sample.sample_id
  if (shouldClearSessionFirst()) {
    await clearExistingSessionMemories(sessionId)
  }

  const sessions = getOrderedSessions(sample)
  let total = 0
  for (const session of sessions) total += session.turns.filter(turn => turn.text.trim().length > 0).length
  let done = 0
  let lastPct = -1

  const spinner = new Spinner(`Ingesting sample ${sample.sample_id}`)
  spinner.start()

  for (const session of sessions) {
    for (let i = 0; i < session.turns.length; i++) {
      const turn = session.turns[i]
      if (turn == null || turn.text.trim().length === 0) continue
      await createMemory({
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
      done += 1
      const pct = Math.floor((done / Math.max(total, 1)) * 100)
      if (pct >= lastPct + 20) {
        spinner.setText(`Ingesting sample ${sample.sample_id} ${pct}%`)
        lastPct = pct
      }
    }
  }

  spinner.setText(`Waiting for mem9 writes for sample ${sample.sample_id}`)
  await waitForSessionMemories(sessionId, total)
  spinner.succeed(`Ingested sample ${sample.sample_id}`)
  return sessionId
}

export const ingestAll = async (samples: LoCoMoSample[]): Promise<Record<string, string>> => {
  const ids: Record<string, string> = {}
  for (const sample of samples) ids[sample.sample_id] = await ingestSample(sample)
  return ids
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
