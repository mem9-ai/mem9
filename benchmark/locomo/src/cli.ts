import type { BenchmarkOutput, LoCoMoSample, QAResult } from './types.js'

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { env, exit } from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { Spinner } from 'picospinner'

import { llmJudge, generateAnswer } from './llm.js'
import { scoreAnswer } from './evaluation.js'
import { ingestAll, loadConversationIds, saveConversationIds } from './ingest.js'
import { getBaseUrl, getTenantId } from './mem9.js'
import { getContext } from './retrieve.js'
import { computeStats, printStats } from './stats.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface Args {
  concurrency: number
  dataFile: string
  outFile: string
  sampleIds: null | string[]
  skipIngest: boolean
  useLlmJudge: boolean
}

const parseCliArgs = (): Args => {
  const { values } = parseArgs({
    options: {
      'concurrency': { default: '4', short: 'c', type: 'string' },
      'data-file': { short: 'd', type: 'string' },
      'out-file': { short: 'o', type: 'string' },
      'sample-ids': { short: 's', type: 'string' },
      'skip-ingest': { default: false, type: 'boolean' },
      'use-llm-judge': { default: false, type: 'boolean' },
    },
  })

  const concurrency = Number.parseInt(values.concurrency, 10)
  const sampleIdStr = values['sample-ids'] ?? ''

  return {
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 4,
    dataFile: values['data-file'] ?? resolve(__dirname, '../data/locomo10.json'),
    outFile: values['out-file'] ?? resolve(__dirname, `../results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    sampleIds: sampleIdStr.length > 0 ? sampleIdStr.split(',').map(s => s.trim()) : null,
    skipIngest: values['skip-ingest'],
    useLlmJudge: values['use-llm-judge'],
  }
}

const runWithConcurrency = async (tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> => {
  if (tasks.length === 0) return
  const limit = Math.max(1, Math.floor(concurrency))
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex
      nextIndex += 1
      if (i >= tasks.length) return
      await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => await worker()))
}

const main = async () => {
  const model = env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini'
  if ((env.OPENAI_API_KEY ?? '').length === 0) {
    console.error('Error: OPENAI_API_KEY not set.')
    exit(1)
  }

  const args = parseCliArgs()
  console.log('LoCoMo Benchmark for mem9')
  console.log(`  data:    ${args.dataFile}`)
  console.log(`  out:     ${args.outFile}`)
  console.log(`  model:   ${model}`)
  console.log(`  baseUrl: ${getBaseUrl()}`)
  console.log(`  tenant:  ${getTenantId()}`)
  console.log(`  concurrency: ${args.concurrency}`)
  console.log(`  llmJudge: ${args.useLlmJudge ? 'on' : 'off'}`)
  console.log()

  const raw = await readFile(args.dataFile, 'utf-8')
  const allSamples = JSON.parse(raw) as LoCoMoSample[]
  const samples = args.sampleIds != null ? allSamples.filter(s => args.sampleIds!.includes(s.sample_id)) : allSamples
  console.log(`Loaded ${samples.length} sample(s).`)

  const idsFile = resolve(__dirname, '../data/conversation_ids.json')
  let conversationIds: Record<string, string>
  if (!args.skipIngest) {
    console.log('\n── Step 1: Ingesting conversations ──')
    conversationIds = await ingestAll(samples)
    await saveConversationIds(idsFile, conversationIds)
    console.log('Ingestion complete.')
  } else {
    console.log('Skipping ingestion (--skip-ingest).')
    conversationIds = await loadConversationIds(idsFile)
  }

  console.log('\n── Step 2: Evaluating QA ──')
  const results: QAResult[] = []

  for (const sample of samples) {
    const sessionId = conversationIds[sample.sample_id]
    if (!sessionId) {
      console.warn(`  No session_id for sample ${sample.sample_id}, skipping.`)
      continue
    }

    const qaCount = sample.qa.length
    console.log(`  Sample ${sample.sample_id}: ${qaCount} questions`)

    const prefetchSpinner = new Spinner(`Prefetching ${qaCount} contexts`)
    prefetchSpinner.start()
    const contexts: string[] = Array.from({ length: qaCount }, () => '')
    const contextTasks = sample.qa.map((qa, index) => async () => { contexts[index] = await getContext(sessionId, qa.question) })
    await runWithConcurrency(contextTasks, args.concurrency)
    prefetchSpinner.succeed(`Prefetched ${qaCount} contexts`)

    const buffered: Array<null | { context: string, llmScore: number, prediction: string, qa: (typeof sample.qa)[number], score: number }> = Array.from({ length: qaCount }, () => null)
    let nextToPrint = 0

    const flush = () => {
      while (nextToPrint < qaCount && buffered[nextToPrint] != null) {
        const { context, llmScore, prediction, qa, score } = buffered[nextToPrint]!
        console.log(`    [${nextToPrint + 1}/${qaCount}] generating... f1=${score.toFixed(2)}`)
        results.push({
          category: qa.category,
          context_retrieved: context,
          evidence: qa.evidence,
          gold_answer: String(qa.answer),
          llm_judge_score: llmScore,
          prediction,
          question: qa.question,
          sample_id: sample.sample_id,
          score,
        })
        buffered[nextToPrint] = null
        nextToPrint += 1
      }
    }

    const tasks = sample.qa.map((qa, index) => async () => {
      const context = contexts[index] ?? ''
      const prediction = await generateAnswer(context, qa.question, qa.category, model)
      const score = scoreAnswer(prediction, qa.answer, qa.category)
      const llmScore = args.useLlmJudge && qa.category !== 5 ? await llmJudge(prediction, qa.answer, qa.question, model) : 0
      buffered[index] = { context, llmScore, prediction, qa, score }
      flush()
    })

    await runWithConcurrency(tasks, args.concurrency)
    flush()
  }

  const stats = computeStats(results)
  printStats(stats)
  const output: BenchmarkOutput = {
    meta: {
      base_url: getBaseUrl(),
      data_file: args.dataFile,
      model,
      tenant_id: getTenantId(),
      timestamp: new Date().toISOString(),
    },
    results,
    stats,
  }
  await mkdir(dirname(args.outFile), { recursive: true })
  await writeFile(args.outFile, JSON.stringify(output, null, 2))
  console.log(`Results written to: ${args.outFile}`)
}

main().catch((err) => {
  console.error(err)
  exit(1)
})
